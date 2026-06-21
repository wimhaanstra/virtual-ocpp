import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargers, proxySessionMappings, proxyTagMappings, proxyTargets } from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';
import { recordLogEntry } from './log-writer.js';
import type { ProxyAuthorizationService } from './ocpp/proxy-service.js';

const ModeSchema = z.enum(['monitor-only', 'deny-capable']);
const OutagePolicySchema = z.enum(['fail-open', 'fail-closed']);
const TagMappingsSchema = z
  .array(
    z.object({
      localIdTag: z.string().trim().min(1).max(255),
      outboundIdTag: z.string().trim().min(1).max(255)
    })
  )
  .superRefine((mappings, context) => {
    const seen = new Set<string>();
    for (const [index, mapping] of mappings.entries()) {
      if (seen.has(mapping.localIdTag)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate local tag mapping',
          path: [index, 'localIdTag']
        });
      }
      seen.add(mapping.localIdTag);
    }
  });

const CreateProxyTargetSchema = z.object({
  chargerId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
  username: z.string().trim().min(1).nullable().optional(),
  stationId: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().default(true),
  mode: ModeSchema.default('monitor-only'),
  outagePolicy: OutagePolicySchema.default('fail-open'),
  basicAuthPassword: z.string().min(1).nullable().optional(),
  tagMappings: TagMappingsSchema.optional()
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
  basicAuthPassword: z.string().min(1).nullable().optional(),
  tagMappings: TagMappingsSchema.optional()
});

const ListProxyTargetsQuerySchema = z.object({
  chargerId: z.string().trim().min(1)
});
const ProxyHealthQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

export function registerProxyTargetRoutes(app: FastifyInstance, db: Database, proxyAuthorization?: ProxyAuthorizationService, liveUpdates?: LiveUpdateBus) {
  app.get('/api/proxy-health', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ProxyHealthQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_proxy_health_query', details: parsed.error.flatten() });
    }

    return proxyAuthorization?.getHealth(parsed.data.chargerId) ?? {
      chargerId: parsed.data.chargerId ?? null,
      summary: {
        total: 0,
        connected: 0,
        backoff: 0,
        waitingForCharger: 0,
        disabled: 0
      },
      targets: []
    };
  });

  app.get('/api/proxy-targets', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ListProxyTargetsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_proxy_target_query', details: parsed.error.flatten() });
    }

    return db.select().from(proxyTargets).where(eq(proxyTargets.chargerId, parsed.data.chargerId)).all().map((target) => toPublicProxyTarget(db, target));
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
    replaceProxyTagMappings(db, id, body.data.tagMappings ?? []);
    recordProxyLog(db, liveUpdates, 'proxy target created', {
      proxyTargetId: id,
      chargerId: target.chargerId,
      mode: target.mode,
      outagePolicy: target.outagePolicy
    });
    await proxyAuthorization?.warmUpTarget(target.chargerId, target.id);

    return reply.code(201).send(toPublicProxyTarget(db, target));
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
    const hasActiveMappings = hasActiveProxyMappings(db, existing.chargerId, existing.id);
    const disablingTarget = existing.enabled && !update.enabled;
    const enablingTarget = !existing.enabled && update.enabled;
    const hasDisruptiveUpdate = hasDisruptiveProxyTargetUpdate(existing, update);
    if (hasActiveMappings && !disablingTarget && hasDisruptiveUpdate) {
      return reply.code(409).send({ error: 'proxy_target_has_active_sessions' });
    }

    db.update(proxyTargets).set(update).where(eq(proxyTargets.id, request.params.id)).run();
    if (body.data.tagMappings !== undefined) {
      replaceProxyTagMappings(db, existing.id, body.data.tagMappings);
    }
    if (disablingTarget) {
      closeActiveProxyMappings(db, existing.chargerId, existing.id);
    }
    if (existing.chargerId && (disablingTarget || hasDisruptiveUpdate)) {
      await proxyAuthorization?.invalidateTarget(existing.chargerId, existing.id, 'proxy target connection invalidated after update');
    }
    recordProxyLog(db, liveUpdates, 'proxy target updated', {
      proxyTargetId: request.params.id,
      chargerId: existing.chargerId,
      mode: update.mode,
      outagePolicy: update.outagePolicy
    });
    if (existing.chargerId && (enablingTarget || (hasDisruptiveUpdate && update.enabled))) {
      await proxyAuthorization?.warmUpTarget(existing.chargerId, existing.id);
    }

    return toPublicProxyTarget(db, { ...existing, ...update });
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

    db.delete(proxyTagMappings).where(eq(proxyTagMappings.proxyTargetId, request.params.id)).run();
    db.delete(proxyTargets).where(eq(proxyTargets.id, request.params.id)).run();
    if (existing.chargerId) {
      await proxyAuthorization?.invalidateTarget(existing.chargerId, existing.id, 'proxy target connection invalidated after delete');
    }
    recordProxyLog(db, liveUpdates, 'proxy target deleted', { proxyTargetId: request.params.id, chargerId: existing.chargerId });

    return { ok: true };
  });
}

function toPublicProxyTarget(db: Database, target: typeof proxyTargets.$inferSelect) {
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
    tagMappings: db
      .select()
      .from(proxyTagMappings)
      .where(eq(proxyTagMappings.proxyTargetId, target.id))
      .all()
      .map((mapping) => ({
        id: mapping.id,
        localIdTag: mapping.localIdTag,
        outboundIdTag: mapping.outboundIdTag
      })),
    createdAt: target.createdAt.toISOString(),
    updatedAt: target.updatedAt.toISOString()
  };
}

function replaceProxyTagMappings(
  db: Database,
  proxyTargetId: string,
  mappings: Array<{
    localIdTag: string;
    outboundIdTag: string;
  }>
) {
  const now = new Date();
  db.delete(proxyTagMappings).where(eq(proxyTagMappings.proxyTargetId, proxyTargetId)).run();
  for (const mapping of mappings) {
    db.insert(proxyTagMappings).values({
      id: randomUUID(),
      proxyTargetId,
      localIdTag: mapping.localIdTag.trim(),
      outboundIdTag: mapping.outboundIdTag.trim(),
      createdAt: now,
      updatedAt: now
    }).run();
  }
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

function closeActiveProxyMappings(db: Database, chargerId: string | null, proxyTargetId: string) {
  if (!chargerId) return;

  db
    .update(proxySessionMappings)
    .set({ stoppedAt: new Date() })
    .where(
      and(
        eq(proxySessionMappings.chargerId, chargerId),
        eq(proxySessionMappings.proxyTargetId, proxyTargetId),
        isNull(proxySessionMappings.stoppedAt)
      )
    )
    .run();
}

function hasDisruptiveProxyTargetUpdate(existing: typeof proxyTargets.$inferSelect, update: Partial<typeof proxyTargets.$inferSelect>) {
  return (
    update.url !== existing.url ||
    update.username !== existing.username ||
    update.stationId !== existing.stationId ||
    update.basicAuthPassword !== existing.basicAuthPassword
  );
}

function recordProxyLog(db: Database, liveUpdates: LiveUpdateBus | undefined, message: string, metadata: Record<string, unknown>) {
  recordLogEntry(db, liveUpdates, {
    level: 'info',
    category: 'proxy',
    message,
    metadata
  });
}
