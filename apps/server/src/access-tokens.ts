import { and, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createApiTokenMaterial, getTenantAuthContext, requireAdminCookie } from './auth.js';
import type { Database } from './db/client.js';
import { apiTokens } from './db/schema.js';

const TokenScopeSchema = z.enum(['read_only', 'read_write']);

const CreateApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope: TokenScopeSchema,
  expiresAt: z.string().datetime().nullable().optional()
});

const RotateApiTokenSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional()
});

export function registerAccessTokenRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/access-tokens', async (request, reply) => {
    if (await requireAdminCookie(request, reply, db)) return;
    const auth = getTenantAuthContext(request);
    if (!auth || auth.role === 'viewer') return reply.code(403).send({ error: 'insufficient_role' });

    return db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.tenantId, auth.tenantId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt))
      .all()
      .map((row) => serializeApiToken(row));
  });

  app.post('/api/access-tokens', async (request, reply) => {
    if (await requireAdminCookie(request, reply, db)) return;
    const auth = getTenantAuthContext(request);
    if (!auth || auth.role === 'viewer') return reply.code(403).send({ error: 'insufficient_role' });

    const parsed = CreateApiTokenSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_api_token', details: parsed.error.flatten() });
    }

    const now = new Date();
    const id = randomUUID();
    const tokenMaterial = createApiTokenMaterial(id);
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      return reply.code(400).send({ error: 'api_token_expiry_in_past' });
    }

    const row = {
      id,
      tenantId: auth.tenantId,
      userId: auth.userId,
      name: parsed.data.name,
      scope: parsed.data.scope,
      tokenHash: tokenMaterial.tokenHash,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      revokedAt: null,
      lastUsedAt: null
    };

    db.insert(apiTokens).values(row).run();

    return reply.code(201).send({
      ...serializeApiToken(row),
      token: tokenMaterial.token
    });
  });

  app.post<{ Params: { id: string } }>('/api/access-tokens/:id/revoke', async (request, reply) => {
    if (await requireAdminCookie(request, reply, db)) return;
    const auth = getTenantAuthContext(request);
    if (!auth || auth.role === 'viewer') return reply.code(403).send({ error: 'insufficient_role' });

    const existing = db.select().from(apiTokens).where(and(eq(apiTokens.tenantId, auth.tenantId), eq(apiTokens.id, request.params.id))).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'api_token_not_found' });
    }

    const updatedAt = new Date();
    const revokedAt = existing.revokedAt ?? updatedAt;
    db.update(apiTokens)
      .set({ revokedAt, updatedAt })
      .where(eq(apiTokens.id, request.params.id))
      .run();

    return serializeApiToken({ ...existing, revokedAt, updatedAt });
  });

  app.delete<{ Params: { id: string } }>('/api/access-tokens/:id', async (request, reply) => {
    if (await requireAdminCookie(request, reply, db)) return;
    const auth = getTenantAuthContext(request);
    if (!auth || auth.role === 'viewer') return reply.code(403).send({ error: 'insufficient_role' });

    const existing = db.select().from(apiTokens).where(and(eq(apiTokens.tenantId, auth.tenantId), eq(apiTokens.id, request.params.id))).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'api_token_not_found' });
    }

    const updatedAt = new Date();
    const revokedAt = existing.revokedAt ?? updatedAt;
    db.update(apiTokens)
      .set({ revokedAt, updatedAt })
      .where(eq(apiTokens.id, request.params.id))
      .run();

    return {
      ok: true,
      ...serializeApiToken({ ...existing, revokedAt, updatedAt })
    };
  });

  app.post<{ Params: { id: string } }>('/api/access-tokens/:id/rotate', async (request, reply) => {
    if (await requireAdminCookie(request, reply, db)) return;
    const auth = getTenantAuthContext(request);
    if (!auth || auth.role === 'viewer') return reply.code(403).send({ error: 'insufficient_role' });

    const body = RotateApiTokenSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_api_token', details: body.error.flatten() });
    }

    const existing = db.select().from(apiTokens).where(and(eq(apiTokens.tenantId, auth.tenantId), eq(apiTokens.id, request.params.id))).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'api_token_not_found' });
    }

    const now = new Date();
    const tokenMaterial = createApiTokenMaterial(existing.id);
    const expiresAt =
      body.data.expiresAt === undefined ? existing.expiresAt : body.data.expiresAt === null ? null : new Date(body.data.expiresAt);

    db.update(apiTokens)
      .set({
        tokenHash: tokenMaterial.tokenHash,
        expiresAt,
        revokedAt: null,
        updatedAt: now
      })
      .where(eq(apiTokens.id, request.params.id))
      .run();

    return {
      ...serializeApiToken({
        ...existing,
        tokenHash: tokenMaterial.tokenHash,
        expiresAt,
        revokedAt: null,
        updatedAt: now
      }),
      token: tokenMaterial.token
    };
  });
}

function serializeApiToken(row: typeof apiTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    status: getApiTokenStatus(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null
  };
}

function getApiTokenStatus(row: typeof apiTokens.$inferSelect) {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'active';
}
