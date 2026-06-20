import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargers, logs, proxySessionMappings, proxyTargets } from './db/schema.js';
import type { ProxyAuthorizationService } from './ocpp/proxy-service.js';

const ModeSchema = z.enum(['monitor-only', 'deny-capable']);
const OutagePolicySchema = z.enum(['fail-open', 'fail-closed']);

const CreateProxyTargetSchema = z.object({
  chargerId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
  username: z.string().trim().min(1).nullable().optional(),
  stationId: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().default(true),
  mode: ModeSchema.default('monitor-only'),
  outagePolicy: OutagePolicySchema.default('fail-open'),
  basicAuthPassword: z.string().min(1).nullable().optional()
});

const UpdateProxyTargetSchema = z.object({
  chargerId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().url().optional(),
  username: z.string().trim().min(1).nullable().optional(),
  stationId: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
  mode: ModeSchema.optional(),
  outagePolicy: OutagePolicySchema.optional(),
  basicAuthPassword: z.string().min(1).nullable().optional()
});

const ListProxyTargetsQuerySchema = z.object({
  chargerId: z.string().trim().min(1)
});

export function registerProxyTargetRoutes(app: FastifyInstance, db: Database, proxyAuthorization?: ProxyAuthorizationService) {
  app.get('/api/proxy-targets', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ListProxyTargetsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_proxy_target_query', details: parsed.error.flatten() });
    }

    return db.select().from(proxyTargets).where(eq(proxyTargets.chargerId, parsed.data.chargerId)).all().map(toPublicProxyTarget);
  });

  app.post('/api/proxy-targets', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = CreateProxyTargetSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_proxy_target', details: body.error.flatten() });
    }

    const charger = db.select().from(chargers).where(eq(chargers.id, body.data.chargerId)).limit(1).get();
    if (!charger) {
      return reply.code(404).send({ error: 'charger_not_found' });
    }

    const id = randomUUID();
    const now = new Date();
    const target = {
      id,
      chargerId: body.data.chargerId,
      name: body.data.name,
      url: body.data.url,
      username: body.data.username || null,
      stationId: body.data.stationId || null,
      enabled: body.data.enabled,
      mode: body.data.mode,
      outagePolicy: body.data.outagePolicy,
      basicAuthPassword: body.data.basicAuthPassword || null,
      createdAt: now,
      updatedAt: now
    };

    db.insert(proxyTargets).values(target).run();
    recordProxyLog(db, 'proxy target created', {
      proxyTargetId: id,
      chargerId: target.chargerId,
      mode: target.mode,
      outagePolicy: target.outagePolicy
    });
    await proxyAuthorization?.warmUpTarget(target.chargerId, target.id);

    return reply.code(201).send(toPublicProxyTarget(target));
  });

  app.patch<{ Params: { id: string } }>('/api/proxy-targets/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = UpdateProxyTargetSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_proxy_target', details: body.error.flatten() });
    }

    const existing = db.select().from(proxyTargets).where(eq(proxyTargets.id, request.params.id)).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'proxy_target_not_found' });
    }

    if (hasActiveProxyMappings(db, existing.chargerId, existing.id)) {
      return reply.code(409).send({ error: 'proxy_target_has_active_sessions' });
    }

    const update = {
      name: body.data.name ?? existing.name,
      url: body.data.url ?? existing.url,
      username: body.data.username === undefined ? existing.username : body.data.username || null,
      stationId: body.data.stationId === undefined ? existing.stationId : body.data.stationId || null,
      enabled: body.data.enabled ?? existing.enabled,
      mode: body.data.mode ?? existing.mode,
      outagePolicy: body.data.outagePolicy ?? existing.outagePolicy,
      basicAuthPassword:
        body.data.basicAuthPassword === undefined ? existing.basicAuthPassword : body.data.basicAuthPassword || null,
      updatedAt: new Date()
    };

    db.update(proxyTargets).set(update).where(eq(proxyTargets.id, request.params.id)).run();
    if (existing.chargerId) {
      await proxyAuthorization?.invalidateTarget(existing.chargerId, existing.id, 'proxy target connection invalidated after update');
    }
    recordProxyLog(db, 'proxy target updated', {
      proxyTargetId: request.params.id,
      chargerId: existing.chargerId,
      mode: update.mode,
      outagePolicy: update.outagePolicy
    });
    if (existing.chargerId) {
      await proxyAuthorization?.warmUpTarget(existing.chargerId, existing.id);
    }

    return toPublicProxyTarget({ ...existing, ...update });
  });

  app.delete<{ Params: { id: string } }>('/api/proxy-targets/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const existing = db.select().from(proxyTargets).where(eq(proxyTargets.id, request.params.id)).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'proxy_target_not_found' });
    }

    if (hasActiveProxyMappings(db, existing.chargerId, existing.id)) {
      return reply.code(409).send({ error: 'proxy_target_has_active_sessions' });
    }

    db.delete(proxyTargets).where(eq(proxyTargets.id, request.params.id)).run();
    if (existing.chargerId) {
      await proxyAuthorization?.invalidateTarget(existing.chargerId, existing.id, 'proxy target connection invalidated after delete');
    }
    recordProxyLog(db, 'proxy target deleted', { proxyTargetId: request.params.id, chargerId: existing.chargerId });

    return { ok: true };
  });
}

function toPublicProxyTarget(target: typeof proxyTargets.$inferSelect) {
  return {
    id: target.id,
    chargerId: target.chargerId,
    name: target.name,
    url: target.url,
    hasUsername: Boolean(target.username),
    stationId: target.stationId,
    enabled: target.enabled,
    mode: target.mode,
    outagePolicy: target.outagePolicy,
    hasBasicAuthPassword: Boolean(target.basicAuthPassword),
    createdAt: target.createdAt.toISOString(),
    updatedAt: target.updatedAt.toISOString()
  };
}

function hasActiveProxyMappings(db: Database, chargerId: string | null, proxyTargetId: string) {
  if (!chargerId) return false;

  return Boolean(
    db
      .select({ id: proxySessionMappings.id })
      .from(proxySessionMappings)
      .where(
        and(
          eq(proxySessionMappings.chargerId, chargerId),
          eq(proxySessionMappings.proxyTargetId, proxyTargetId),
          isNull(proxySessionMappings.stoppedAt)
        )
      )
      .limit(1)
      .get()
  );
}

function recordProxyLog(db: Database, message: string, metadata: Record<string, unknown>) {
  db.insert(logs).values({
    id: randomUUID(),
    level: 'info',
    category: 'proxy',
    message,
    metadata: JSON.stringify(metadata),
    createdAt: new Date()
  }).run();
}
