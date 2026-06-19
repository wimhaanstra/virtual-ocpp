import { desc, and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargerConnections, chargers, logs } from './db/schema.js';

const ListChargersQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

const UpdateChargerSchema = z.object({
  label: z.string().trim().min(1).max(120).nullable().optional(),
  enabled: z.boolean().optional()
});

export function registerChargerRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/chargers', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ListChargersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_charger_query', details: parsed.error.flatten() });
    }

    const rows = db
      .select()
      .from(chargers)
      .orderBy(desc(chargers.lastSeenAt))
      .all()
      .filter((row) => {
        if (parsed.data.chargerId && row.id !== parsed.data.chargerId) return false;
        return true;
      });

    return rows.map((charger) => {
      const activeConnection = db
        .select()
        .from(chargerConnections)
        .where(and(eq(chargerConnections.chargerId, charger.id), isNull(chargerConnections.disconnectedAt)))
        .orderBy(desc(chargerConnections.connectedAt))
        .limit(1)
        .get();

      return {
        id: charger.id,
        label: charger.label,
        enabled: charger.enabled,
        firstSeenAt: charger.firstSeenAt.toISOString(),
        lastSeenAt: charger.lastSeenAt.toISOString(),
        lastBootAt: charger.lastBootAt?.toISOString() ?? null,
        chargePointVendor: charger.chargePointVendor,
        chargePointModel: charger.chargePointModel,
        firmwareVersion: charger.firmwareVersion,
        active: Boolean(activeConnection),
        activeConnectionId: activeConnection?.id ?? null,
        connectedAt: activeConnection?.connectedAt.toISOString() ?? null,
        disconnectedAt: activeConnection?.disconnectedAt?.toISOString() ?? null,
        createdAt: charger.createdAt.toISOString(),
        updatedAt: charger.updatedAt.toISOString()
      };
    });
  });

  app.patch<{ Params: { id: string } }>('/api/chargers/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = UpdateChargerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_charger', details: body.error.flatten() });
    }

    const existing = db.select().from(chargers).where(eq(chargers.id, request.params.id)).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'charger_not_found' });
    }

    const update = {
      label: body.data.label === undefined ? existing.label : body.data.label,
      enabled: body.data.enabled ?? existing.enabled,
      updatedAt: new Date()
    };

    db.update(chargers).set(update).where(eq(chargers.id, request.params.id)).run();

    db.insert(logs).values({
      id: randomUUID(),
      level: 'info',
      category: 'charger',
      message: 'charger updated',
      chargerId: request.params.id,
      metadata: JSON.stringify({
        enabled: update.enabled,
        label: update.label
      }),
      createdAt: new Date()
    }).run();

    return {
      id: request.params.id,
      label: update.label,
      enabled: update.enabled,
      firstSeenAt: existing.firstSeenAt.toISOString(),
      lastSeenAt: existing.lastSeenAt.toISOString(),
      lastBootAt: existing.lastBootAt?.toISOString() ?? null,
      chargePointVendor: existing.chargePointVendor,
      chargePointModel: existing.chargePointModel,
      firmwareVersion: existing.firmwareVersion,
      createdAt: existing.createdAt.toISOString(),
      updatedAt: update.updatedAt.toISOString()
    };
  });
}
