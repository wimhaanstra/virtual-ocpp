import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargerConnections, chargingSessions, logs } from './db/schema.js';

const RECENT_LIMIT = 50;
const RECENT_LOG_LIMIT = 100;

const ChargerScopedQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

export function registerVisibilityRoutes(app: FastifyInstance, db: Database) {
  const listConnections = async (request: FastifyRequest, reply: FastifyReply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ChargerScopedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_charger_query', details: parsed.error.flatten() });
    }

    const query = db.select().from(chargerConnections);
    const rows = parsed.data.chargerId
      ? query.where(eq(chargerConnections.chargerId, parsed.data.chargerId)).orderBy(desc(chargerConnections.connectedAt)).limit(RECENT_LIMIT).all()
      : query.orderBy(desc(chargerConnections.connectedAt)).limit(RECENT_LIMIT).all();

    return rows.map(toPublicChargerConnection);
  };

  app.get('/api/charger-connections', listConnections);

  app.get('/api/sessions', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ChargerScopedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_sessions_query', details: parsed.error.flatten() });
    }

    const query = db.select().from(chargingSessions);
    const rows = parsed.data.chargerId
      ? query.where(eq(chargingSessions.chargerId, parsed.data.chargerId)).orderBy(desc(chargingSessions.startedAt)).limit(RECENT_LIMIT).all()
      : query.orderBy(desc(chargingSessions.startedAt)).limit(RECENT_LIMIT).all();

    return rows.map(toPublicChargingSession);
  });

  app.get('/api/logs', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ChargerScopedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_logs_query', details: parsed.error.flatten() });
    }

    const query = db.select().from(logs);
    const rows = parsed.data.chargerId
      ? query.where(eq(logs.chargerId, parsed.data.chargerId)).orderBy(desc(logs.createdAt)).limit(RECENT_LOG_LIMIT).all()
      : query.orderBy(desc(logs.createdAt)).limit(RECENT_LOG_LIMIT).all();

    return rows.map(toPublicLog);
  });
}

function toPublicChargerConnection(connection: typeof chargerConnections.$inferSelect) {
  return {
    id: connection.id,
    chargerId: connection.chargerId,
    connectedAt: connection.connectedAt.toISOString(),
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
    active: connection.disconnectedAt === null
  };
}

function toPublicChargingSession(session: typeof chargingSessions.$inferSelect) {
  return {
    id: session.id,
    chargerId: session.chargerId,
    connectorId: session.connectorId,
    transactionId: session.transactionId,
    idTag: session.idTag,
    startedAt: session.startedAt.toISOString(),
    stoppedAt: session.stoppedAt?.toISOString() ?? null,
    startMeterWh: session.startMeterWh ?? null,
    stopMeterWh: session.stopMeterWh ?? null,
    stopReason: session.stopReason,
    status: session.status,
    active: session.status === 'active'
  };
}

function toPublicLog(entry: typeof logs.$inferSelect) {
  return {
    id: entry.id,
    level: entry.level,
    category: entry.category,
    message: entry.message,
    chargerId: entry.chargerId,
    transactionId: entry.transactionId,
    createdAt: entry.createdAt.toISOString(),
    hasMetadata: Boolean(entry.metadata),
    context: extractSafeLogContext(entry.metadata)
  };
}

function extractSafeLogContext(metadata: string | null) {
  if (!metadata) return null;

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const context: Record<string, string> = {};

    for (const key of ['proxyTargetId', 'method', 'status']) {
      const value = parsed[key];
      if (typeof value === 'string') {
        context[key] = value;
      }
    }

    return Object.keys(context).length > 0 ? context : null;
  } catch {
    return null;
  }
}
