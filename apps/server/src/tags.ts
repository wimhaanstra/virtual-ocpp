import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargers, logs, tagChargerAccess, tags } from './db/schema.js';

const CreateTagSchema = z.object({
  uuid: z.string().trim().min(1).max(64),
  label: z.string().trim().max(120).optional(),
  enabled: z.boolean().default(true)
});

const UpdateTagSchema = z.object({
  uuid: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  enabled: z.boolean().optional()
});

const UpdateTagAccessSchema = z.object({
  enabled: z.boolean().default(true)
});

export function registerTagRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/tags', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const accessRows = db.select().from(tagChargerAccess).all();
    return db
      .select()
      .from(tags)
      .all()
      .map((tag) => ({
        id: tag.id,
        uuid: tag.uuid,
        label: tag.label,
        enabled: tag.enabled,
        createdAt: tag.createdAt.toISOString(),
        chargerAccess: accessRows
          .filter((access) => access.tagId === tag.id)
          .map((access) => ({
            chargerId: access.chargerId,
            enabled: access.enabled,
            updatedAt: access.updatedAt.toISOString()
          }))
      }));
  });

  app.post('/api/tags', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = CreateTagSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_tag', details: body.error.flatten() });
    }

    const now = new Date();
    const id = randomUUID();

    try {
      db.insert(tags).values({
        id,
        uuid: body.data.uuid,
        label: body.data.label || null,
        enabled: body.data.enabled,
        createdAt: now
      }).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'tag_exists' });
      }
      throw error;
    }

    recordTagLog(db, 'tag created', { tagId: id, enabled: body.data.enabled });

    return reply.code(201).send({
      id,
      uuid: body.data.uuid,
      label: body.data.label || null,
      enabled: body.data.enabled,
      createdAt: now.toISOString()
    });
  });

  app.patch<{ Params: { id: string } }>('/api/tags/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = UpdateTagSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_tag', details: body.error.flatten() });
    }

    const existing = db.select().from(tags).where(eq(tags.id, request.params.id)).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'tag_not_found' });
    }

    const update = {
      uuid: body.data.uuid ?? existing.uuid,
      label: body.data.label === undefined ? existing.label : body.data.label || null,
      enabled: body.data.enabled ?? existing.enabled
    };

    try {
      db.update(tags).set(update).where(eq(tags.id, request.params.id)).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'tag_exists' });
      }
      throw error;
    }

    recordTagLog(db, 'tag updated', { tagId: request.params.id, enabled: update.enabled });

    return {
      id: request.params.id,
      uuid: update.uuid,
      label: update.label,
      enabled: update.enabled,
      createdAt: existing.createdAt.toISOString()
    };
  });

  app.delete<{ Params: { id: string } }>('/api/tags/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const existing = db.select().from(tags).where(eq(tags.id, request.params.id)).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'tag_not_found' });
    }

    db.delete(tags).where(eq(tags.id, request.params.id)).run();
    recordTagLog(db, 'tag deleted', { tagId: request.params.id });

    return { ok: true };
  });

  app.put<{ Params: { id: string; chargerId: string } }>('/api/tags/:id/chargers/:chargerId', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = UpdateTagAccessSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_tag_access', details: body.error.flatten() });
    }

    const tag = db.select().from(tags).where(eq(tags.id, request.params.id)).limit(1).get();
    if (!tag) {
      return reply.code(404).send({ error: 'tag_not_found' });
    }

    const charger = db.select().from(chargers).where(eq(chargers.id, request.params.chargerId)).limit(1).get();
    if (!charger) {
      return reply.code(404).send({ error: 'charger_not_found' });
    }

    const now = new Date();
    const existing = db
      .select()
      .from(tagChargerAccess)
      .where(and(eq(tagChargerAccess.tagId, request.params.id), eq(tagChargerAccess.chargerId, request.params.chargerId)))
      .limit(1)
      .get();

    if (existing) {
      db.update(tagChargerAccess)
        .set({ enabled: body.data.enabled, updatedAt: now })
        .where(eq(tagChargerAccess.id, existing.id))
        .run();
      recordTagLog(db, 'tag charger access updated', {
        tagId: request.params.id,
        chargerId: request.params.chargerId,
        enabled: body.data.enabled
      });
      return {
        id: existing.id,
        tagId: request.params.id,
        chargerId: request.params.chargerId,
        enabled: body.data.enabled,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: now.toISOString()
      };
    }

    const id = randomUUID();
    db.insert(tagChargerAccess).values({
      id,
      tagId: request.params.id,
      chargerId: request.params.chargerId,
      enabled: body.data.enabled,
      createdAt: now,
      updatedAt: now
    }).run();
    recordTagLog(db, 'tag charger access granted', {
      tagId: request.params.id,
      chargerId: request.params.chargerId,
      enabled: body.data.enabled
    });

    return reply.code(201).send({
      id,
      tagId: request.params.id,
      chargerId: request.params.chargerId,
      enabled: body.data.enabled,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  });

  app.delete<{ Params: { id: string; chargerId: string } }>('/api/tags/:id/chargers/:chargerId', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const existing = db
      .select()
      .from(tagChargerAccess)
      .where(and(eq(tagChargerAccess.tagId, request.params.id), eq(tagChargerAccess.chargerId, request.params.chargerId)))
      .limit(1)
      .get();
    if (!existing) {
      return reply.code(404).send({ error: 'tag_access_not_found' });
    }

    db.delete(tagChargerAccess).where(eq(tagChargerAccess.id, existing.id)).run();
    recordTagLog(db, 'tag charger access revoked', {
      tagId: request.params.id,
      chargerId: request.params.chargerId
    });

    return { ok: true };
  });
}

function recordTagLog(db: Database, message: string, metadata: Record<string, unknown>) {
  db.insert(logs).values({
    id: randomUUID(),
    level: 'info',
    category: 'tag',
    message,
    metadata: JSON.stringify(metadata),
    createdAt: new Date()
  }).run();
}
