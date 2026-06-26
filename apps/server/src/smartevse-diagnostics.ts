import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargerConnections, chargingSessions, communicationJournal, meterSamples, proxySessionMappings, proxyTargets } from './db/schema.js';

const ACTIVE_CADENCE_GAP_LIMIT_MS = 15 * 60 * 1000;
const NORMAL_CADENCE_MIN_MS = 450 * 1000;
const NORMAL_CADENCE_MAX_MS = 550 * 1000;
const RECENT_JOURNAL_HOURS = 24;
const RECENT_CONNECTION_LIMIT = 60;

export function registerSmartEvseDiagnosticsRoutes(app: FastifyInstance, db: Database) {
  app.get<{ Params: { chargerId: string } }>('/api/diagnostics/smartevse/:chargerId', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const chargerId = request.params.chargerId.trim();
    if (!chargerId) {
      return reply.code(400).send({ error: 'invalid_charger_id' });
    }

    return buildSmartEvseDiagnostics(db, chargerId);
  });
}

export function buildSmartEvseDiagnostics(db: Database, chargerId: string) {
  const timestamps = db
    .select({ sampledAt: meterSamples.sampledAt })
    .from(meterSamples)
    .where(eq(meterSamples.chargerId, chargerId))
    .groupBy(meterSamples.sampledAt)
    .orderBy(meterSamples.sampledAt)
    .all()
    .map((row) => row.sampledAt);
  const gaps = timestamps.slice(1).map((sampledAt, index) => sampledAt.getTime() - timestamps[index].getTime());
  const activeCadenceGaps = gaps.filter((gap) => gap <= ACTIVE_CADENCE_GAP_LIMIT_MS);
  const normalCadenceIntervals = activeCadenceGaps.filter((gap) => gap >= NORMAL_CADENCE_MIN_MS && gap <= NORMAL_CADENCE_MAX_MS);
  const samplesByDay = db
    .select({
      day: sql<string>`date(${meterSamples.sampledAt} / 1000, 'unixepoch')`,
      sampleRows: sql<number>`count(*)`,
      meterValueTimestamps: sql<number>`count(distinct ${meterSamples.sampledAt})`,
      firstSampledAt: sql<number | Date | string>`min(${meterSamples.sampledAt})`,
      lastSampledAt: sql<number | Date | string>`max(${meterSamples.sampledAt})`
    })
    .from(meterSamples)
    .where(eq(meterSamples.chargerId, chargerId))
    .groupBy(sql`date(${meterSamples.sampledAt} / 1000, 'unixepoch')`)
    .orderBy(sql`date(${meterSamples.sampledAt} / 1000, 'unixepoch')`)
    .all();
  const activeSession = db
    .select()
    .from(chargingSessions)
    .where(and(eq(chargingSessions.chargerId, chargerId), eq(chargingSessions.status, 'active')))
    .orderBy(desc(chargingSessions.startedAt))
    .limit(1)
    .get();
  const recentJournalSince = new Date(Date.now() - RECENT_JOURNAL_HOURS * 60 * 60 * 1000);
  const journalMethods = db
    .select({
      ocppMethod: communicationJournal.ocppMethod,
      messageType: communicationJournal.messageType,
      sourceType: communicationJournal.sourceType,
      targetType: communicationJournal.targetType,
      count: sql<number>`count(*)`,
      firstSeenAt: sql<number | Date | string>`min(${communicationJournal.createdAt})`,
      lastSeenAt: sql<number | Date | string>`max(${communicationJournal.createdAt})`
    })
    .from(communicationJournal)
    .where(and(eq(communicationJournal.chargerId, chargerId), gte(communicationJournal.createdAt, recentJournalSince)))
    .groupBy(communicationJournal.ocppMethod, communicationJournal.messageType, communicationJournal.sourceType, communicationJournal.targetType)
    .orderBy(desc(sql`max(${communicationJournal.createdAt})`))
    .all();
  const connections = db
    .select()
    .from(chargerConnections)
    .where(eq(chargerConnections.chargerId, chargerId))
    .orderBy(desc(chargerConnections.connectedAt))
    .limit(RECENT_CONNECTION_LIMIT)
    .all();
  const proxyMappings = db
    .select({
      proxyTargetId: proxySessionMappings.proxyTargetId,
      proxyTargetName: proxyTargets.name,
      localTransactionId: proxySessionMappings.localTransactionId,
      externalTransactionId: proxySessionMappings.externalTransactionId,
      createdAt: proxySessionMappings.createdAt,
      stoppedAt: proxySessionMappings.stoppedAt
    })
    .from(proxySessionMappings)
    .leftJoin(proxyTargets, eq(proxyTargets.id, proxySessionMappings.proxyTargetId))
    .where(eq(proxySessionMappings.chargerId, chargerId))
    .orderBy(desc(proxySessionMappings.createdAt))
    .limit(20)
    .all();

  return {
    chargerId,
    generatedAt: new Date().toISOString(),
    meterValues: {
      sampleRows: Number(db.select({ count: sql<number>`count(*)` }).from(meterSamples).where(eq(meterSamples.chargerId, chargerId)).get()?.count ?? 0),
      meterValueTimestamps: timestamps.length,
      firstSampledAt: timestamps[0]?.toISOString() ?? null,
      lastSampledAt: timestamps.at(-1)?.toISOString() ?? null,
      cadence: {
        averageGapSeconds: averageSeconds(activeCadenceGaps),
        minGapSeconds: minSeconds(activeCadenceGaps),
        maxGapSeconds: maxSeconds(activeCadenceGaps),
        normalIntervalCount: normalCadenceIntervals.length,
        normalIntervalBandSeconds: [NORMAL_CADENCE_MIN_MS / 1000, NORMAL_CADENCE_MAX_MS / 1000]
      },
      byDay: samplesByDay.map((row) => ({
        day: row.day,
        sampleRows: Number(row.sampleRows),
        meterValueTimestamps: Number(row.meterValueTimestamps),
        firstSampledAt: toIso(row.firstSampledAt),
        lastSampledAt: toIso(row.lastSampledAt)
      }))
    },
    activeSession: activeSession
      ? {
          id: activeSession.id,
          transactionId: activeSession.transactionId,
          connectorId: activeSession.connectorId,
          idTag: activeSession.idTag,
          startedAt: activeSession.startedAt.toISOString(),
          startMeterWh: activeSession.startMeterWh,
          latestMeterSampleAt: latestSampleForSession(db, activeSession)?.toISOString() ?? null
        }
      : null,
    recentJournal: {
      since: recentJournalSince.toISOString(),
      methods: journalMethods.map((row) => ({
        ocppMethod: row.ocppMethod,
        messageType: row.messageType,
        sourceType: row.sourceType,
        targetType: row.targetType,
        count: Number(row.count),
        firstSeenAt: toIso(row.firstSeenAt),
        lastSeenAt: toIso(row.lastSeenAt)
      }))
    },
    recentConnections: connections.map((connection) => ({
      id: connection.id,
      connectedAt: connection.connectedAt.toISOString(),
      disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
      durationSeconds: connection.disconnectedAt
        ? Math.round((connection.disconnectedAt.getTime() - connection.connectedAt.getTime()) / 1000)
        : null
    })),
    proxySessionMappings: proxyMappings.map((mapping) => ({
      proxyTargetId: mapping.proxyTargetId,
      proxyTargetName: mapping.proxyTargetName ?? mapping.proxyTargetId,
      localTransactionId: mapping.localTransactionId,
      externalTransactionId: mapping.externalTransactionId,
      createdAt: mapping.createdAt.toISOString(),
      stoppedAt: mapping.stoppedAt?.toISOString() ?? null
    })),
    interpretation: buildInterpretation(timestamps, journalMethods, activeSession?.startedAt ?? null)
  };
}

function latestSampleForSession(db: Database, session: typeof chargingSessions.$inferSelect) {
  return db
    .select({ sampledAt: meterSamples.sampledAt })
    .from(meterSamples)
    .where(and(eq(meterSamples.chargerId, session.chargerId), eq(meterSamples.connectorId, session.connectorId), isNull(meterSamples.transactionId)))
    .orderBy(desc(meterSamples.sampledAt))
    .limit(1)
    .get()?.sampledAt ?? null;
}

function buildInterpretation(
  timestamps: Date[],
  journalMethods: Array<{ ocppMethod: string | null; messageType: string; sourceType: string; targetType: string }>,
  activeStartedAt: Date | null
) {
  const hasRecentMeterValues = journalMethods.some((row) => row.ocppMethod === 'MeterValues');
  const hasRecentRawFailures = journalMethods.some((row) => row.messageType === 'raw');
  const hasRecentChargerCalls = journalMethods.some((row) => row.sourceType === 'charger' && row.ocppMethod);

  return {
    lastMeterValueAt: timestamps.at(-1)?.toISOString() ?? null,
    activeSessionStartedAt: activeStartedAt?.toISOString() ?? null,
    recentJournalHasMeterValues: hasRecentMeterValues,
    recentJournalHasRawFailures: hasRecentRawFailures,
    recentJournalHasChargerCalls: hasRecentChargerCalls,
    summary:
      !hasRecentMeterValues && !hasRecentRawFailures
        ? 'No recent parsed MeterValues or malformed raw OCPP frames were journaled for this charger.'
        : hasRecentRawFailures
          ? 'Recent malformed OCPP frames were journaled for this charger.'
          : 'Recent parsed OCPP traffic was journaled for this charger.'
  };
}

function averageSeconds(values: number[]) {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length / 1000) * 10) / 10;
}

function minSeconds(values: number[]) {
  if (values.length === 0) return null;
  return Math.round(Math.min(...values) / 1000);
}

function maxSeconds(values: number[]) {
  if (values.length === 0) return null;
  return Math.round(Math.max(...values) / 1000);
}

function toIso(value: number | string | Date | null) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
