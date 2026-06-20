import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargerConnections, chargingSessions, logs, meterSamples, proxySessionMappings, proxyTargets } from './db/schema.js';
import { ChargerCommandError, type ChargerCommandService } from './ocpp/charger-command-service.js';
import type { ProxyAuthorizationService } from './ocpp/proxy-service.js';
import type { StopTransactionRequest } from './ocpp/types.js';

const RECENT_LIMIT = 50;
const RECENT_LOG_LIMIT = 100;

const ChargerScopedQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

export function registerVisibilityRoutes(
  app: FastifyInstance,
  db: Database,
  chargerCommands?: ChargerCommandService,
  proxyAuthorization?: ProxyAuthorizationService
) {
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

  app.get<{ Params: { id: string } }>('/api/sessions/:id/force-close-preview', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const session = db.select().from(chargingSessions).where(eq(chargingSessions.id, request.params.id)).limit(1).get();
    if (!session) {
      return reply.code(404).send({ error: 'session_not_found' });
    }

    return buildForceClosePreview(db, session, new Date());
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/force-close', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const session = db.select().from(chargingSessions).where(eq(chargingSessions.id, request.params.id)).limit(1).get();
    if (!session) {
      return reply.code(404).send({ error: 'session_not_found' });
    }

    if (session.status !== 'active') {
      return reply.code(409).send({ error: 'session_not_active' });
    }

    const stoppedAt = new Date();
    const preview = buildForceClosePreview(db, session, stoppedAt);
    const proxyResults = proxyAuthorization
      ? await proxyAuthorization.forceStopTransaction(session.chargerId, preview.localStopTransaction)
      : [];

    db.update(chargingSessions)
      .set({
        stoppedAt,
        stopMeterWh: preview.localStopTransaction.meterStop ?? null,
        stopReason: 'OperatorForceClosed',
        status: 'stopped'
      })
      .where(eq(chargingSessions.id, session.id))
      .run();

    db.insert(logs).values({
      id: randomUUID(),
      level: proxyResults.some((result) => result.attempted && !result.ok) ? 'warn' : 'info',
      category: 'session',
      message: 'charging session force closed',
      chargerId: session.chargerId,
      transactionId: session.transactionId,
      metadata: JSON.stringify({
        connectorId: session.connectorId,
        reason: 'OperatorForceClosed',
        meterStop: preview.localStopTransaction.meterStop ?? null,
        meterSource: preview.meterSource,
        proxyResults
      }),
      createdAt: stoppedAt
    }).run();

    return {
      ...preview,
      session: toPublicChargingSession({
        ...session,
        stoppedAt,
        stopMeterWh: preview.localStopTransaction.meterStop ?? null,
        stopReason: 'OperatorForceClosed',
        status: 'stopped'
      }),
      proxyResults
    };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/close', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const session = db.select().from(chargingSessions).where(eq(chargingSessions.id, request.params.id)).limit(1).get();
    if (!session) {
      return reply.code(404).send({ error: 'session_not_found' });
    }

    if (session.status !== 'active') {
      return toPublicChargingSession(session);
    }

    const stoppedAt = new Date();
    db.update(chargingSessions)
      .set({
        stoppedAt,
        stopReason: 'OperatorClosed',
        status: 'stopped'
      })
      .where(eq(chargingSessions.id, session.id))
      .run();

    db.update(proxySessionMappings)
      .set({ stoppedAt })
      .where(
        and(
          eq(proxySessionMappings.chargerId, session.chargerId),
          eq(proxySessionMappings.localTransactionId, session.transactionId),
          isNull(proxySessionMappings.stoppedAt)
        )
      )
      .run();

    db.insert(logs).values({
      id: randomUUID(),
      level: 'warn',
      category: 'session',
      message: 'charging session manually closed',
      chargerId: session.chargerId,
      transactionId: session.transactionId,
      metadata: JSON.stringify({
        connectorId: session.connectorId,
        reason: 'OperatorClosed'
      }),
      createdAt: stoppedAt
    }).run();

    return toPublicChargingSession({
      ...session,
      stoppedAt,
      stopReason: 'OperatorClosed',
      status: 'stopped'
    });
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/remote-stop', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const session = db.select().from(chargingSessions).where(eq(chargingSessions.id, request.params.id)).limit(1).get();
    if (!session) {
      return reply.code(404).send({ error: 'session_not_found' });
    }

    if (session.status !== 'active') {
      return reply.code(409).send({ error: 'session_not_active' });
    }

    if (!chargerCommands) {
      return reply.code(503).send({ error: 'remote_commands_unavailable' });
    }

    try {
      const result = await chargerCommands.remoteStopTransaction(session.chargerId, session.transactionId);
      recordSessionLog(db, {
        level: result.status === 'Accepted' ? 'info' : 'warn',
        message: 'remote stop transaction requested',
        chargerId: session.chargerId,
        transactionId: session.transactionId,
        metadata: {
          connectorId: session.connectorId,
          status: result.status
        }
      });
      return {
        ok: result.status === 'Accepted',
        status: result.status
      };
    } catch (error) {
      const statusCode = error instanceof ChargerCommandError && error.code === 'charger_not_connected' ? 409 : 502;
      recordSessionLog(db, {
        level: 'warn',
        message: 'remote stop transaction failed',
        chargerId: session.chargerId,
        transactionId: session.transactionId,
        metadata: {
          connectorId: session.connectorId,
          errorType: error instanceof Error ? error.name : 'unknown_error',
          errorCode: error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined
        }
      });
      return reply.code(statusCode).send({
        error: error instanceof ChargerCommandError ? error.code : 'remote_stop_failed'
      });
    }
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

function recordSessionLog(
  db: Database,
  input: {
    level: 'info' | 'warn';
    message: string;
    chargerId: string;
    transactionId: number;
    metadata: Record<string, unknown>;
  }
) {
  db.insert(logs).values({
    id: randomUUID(),
    level: input.level,
    category: 'session',
    message: input.message,
    chargerId: input.chargerId,
    transactionId: input.transactionId,
    metadata: JSON.stringify(input.metadata),
    createdAt: new Date()
  }).run();
}

function buildForceClosePreview(db: Database, session: typeof chargingSessions.$inferSelect, stoppedAt: Date) {
  const latestEnergy = findLatestEnergySampleForSession(db, session);
  const meterStop = latestEnergy?.meterWh ?? session.startMeterWh ?? undefined;
  const timestamp = (latestEnergy?.sampledAt ?? stoppedAt).toISOString();
  const reason = 'Local';
  const localStopTransaction: StopTransactionRequest = {
    transactionId: session.transactionId,
    timestamp,
    reason
  };

  if (typeof session.idTag === 'string' && session.idTag.trim()) {
    localStopTransaction.idTag = session.idTag;
  }
  if (typeof meterStop === 'number') {
    localStopTransaction.meterStop = Math.round(meterStop);
  }

  const proxyPayloads = getActiveProxyMappings(db, session).map(({ mapping, target }) => ({
    proxyTargetId: mapping.proxyTargetId,
    proxyTargetName: target?.name ?? mapping.proxyTargetId,
    proxyTargetEnabled: target?.enabled === true,
    externalTransactionId: mapping.externalTransactionId,
    payload: {
      ...localStopTransaction,
      transactionId: mapping.externalTransactionId
    }
  }));

  const warnings: string[] = [];
  if (!latestEnergy) {
    warnings.push(
      typeof session.startMeterWh === 'number'
        ? 'No stored energy meter sample was found for this session; preview falls back to the start meter.'
        : 'No stored energy meter sample or start meter was found; StopTransaction will omit meterStop.'
    );
  }
  if (proxyPayloads.some((entry) => !entry.proxyTargetEnabled)) {
    warnings.push('One or more proxy mappings point to a disabled or missing proxy target and may not be sent.');
  }

  return {
    session: toPublicChargingSession(session),
    localStopTransaction,
    meterSource: latestEnergy ? 'latest-meter-sample' : typeof session.startMeterWh === 'number' ? 'start-meter' : 'unknown',
    latestMeterSample: latestEnergy
      ? {
          sampledAt: latestEnergy.sampledAt.toISOString(),
          value: latestEnergy.value,
          meterWh: Math.round(latestEnergy.meterWh),
          measurand: latestEnergy.measurand,
          unit: latestEnergy.unit,
          transactionId: latestEnergy.transactionId
        }
      : null,
    proxyPayloads,
    warnings
  };
}

function getActiveProxyMappings(db: Database, session: typeof chargingSessions.$inferSelect) {
  return db
    .select()
    .from(proxySessionMappings)
    .where(
      and(
        eq(proxySessionMappings.chargerId, session.chargerId),
        eq(proxySessionMappings.localTransactionId, session.transactionId),
        isNull(proxySessionMappings.stoppedAt)
      )
    )
    .all()
    .map((mapping) => ({
      mapping,
      target: db.select().from(proxyTargets).where(eq(proxyTargets.id, mapping.proxyTargetId)).limit(1).get() ?? null
    }));
}

function findLatestEnergySampleForSession(db: Database, session: typeof chargingSessions.$inferSelect) {
  const rows = db
    .select()
    .from(meterSamples)
    .where(and(eq(meterSamples.chargerId, session.chargerId), eq(meterSamples.connectorId, session.connectorId)))
    .orderBy(desc(meterSamples.sampledAt))
    .all();

  for (const sample of rows) {
    if (sample.sampledAt < session.startedAt) continue;
    if (typeof sample.transactionId === 'number' && sample.transactionId !== session.transactionId) continue;
    if (!isEnergySample(sample)) continue;

    const meterWh = normalizeEnergyWh(sample);
    if (meterWh === null) continue;

    return {
      sampledAt: sample.sampledAt,
      value: sample.value,
      meterWh,
      measurand: sample.measurand ?? null,
      unit: sample.unit ?? null,
      transactionId: sample.transactionId ?? null
    };
  }

  return null;
}

function isEnergySample(sample: typeof meterSamples.$inferSelect) {
  return sample.measurand === 'Energy.Active.Import.Register' || sample.measurand === null || sample.measurand === '';
}

function normalizeEnergyWh(sample: typeof meterSamples.$inferSelect) {
  if (sample.normalizedUnit === 'Wh' && typeof sample.normalizedValue === 'number') return sample.normalizedValue;
  const value = typeof sample.normalizedValue === 'number' ? sample.normalizedValue : typeof sample.numericValue === 'number' ? sample.numericValue : Number.parseFloat(sample.value);
  if (!Number.isFinite(value)) return null;
  return sample.unit?.trim().toLowerCase() === 'kwh' ? value * 1000 : value;
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
