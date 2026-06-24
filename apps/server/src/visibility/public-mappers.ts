import type { chargerConnections, chargingSessions, logs, meterGapEvents } from '../db/schema.js';

export function toPublicChargerConnection(connection: typeof chargerConnections.$inferSelect) {
  return {
    id: connection.id,
    chargerId: connection.chargerId,
    connectedAt: connection.connectedAt.toISOString(),
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
    active: connection.disconnectedAt === null
  };
}

export function toPublicChargingSession(session: typeof chargingSessions.$inferSelect) {
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

export function toPublicMeterGapEvent(event: typeof meterGapEvents.$inferSelect) {
  return {
    id: event.id,
    chargerId: event.chargerId,
    connectorId: event.connectorId,
    previousSessionId: event.previousSessionId,
    newSessionId: event.newSessionId,
    previousStoppedAt: event.previousStoppedAt?.toISOString() ?? null,
    newStartedAt: event.newStartedAt.toISOString(),
    previousMeterWh: event.previousMeterWh,
    newMeterStartWh: event.newMeterStartWh,
    deltaWh: event.deltaWh,
    thresholdWh: event.thresholdWh,
    status: event.status,
    submissionResult: parseSubmissionResult(event.submissionResultJson),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

export function toPublicLog(entry: typeof logs.$inferSelect) {
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

function parseSubmissionResult(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
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
