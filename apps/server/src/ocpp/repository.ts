import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { CommunicationJournalService } from '../communication-journal.js';
import type { LiveUpdateBus } from '../live-updates.js';
import {
  chargerConnections,
  chargers,
  chargingSessions,
  meterGapEvents,
  meterSamples,
  proxySessionMappings,
  tagChargerAccess,
  tags
} from '../db/schema.js';
import { recordLogEntry } from '../log-writer.js';
import type { StopTransactionRequest } from './types.js';

export class OcppRepository {
  constructor(
    private readonly db: Database,
    private readonly communicationJournal?: CommunicationJournalService,
    private readonly liveUpdates?: LiveUpdateBus
  ) {}

  recordLog(input: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    category: string;
    message: string;
    chargerId?: string;
    transactionId?: number;
    metadata?: Record<string, unknown>;
  }) {
    recordLogEntry(this.db, this.liveUpdates, input);
  }

  recordConnected(chargerId: string) {
    this.upsertChargerSeen(chargerId);
    const connectionId = randomUUID();
    const connectedAt = new Date();
    const openConnections = this.db
      .select()
      .from(chargerConnections)
      .where(and(eq(chargerConnections.chargerId, chargerId), isNull(chargerConnections.disconnectedAt)))
      .all();

    this.db
      .update(chargerConnections)
      .set({ disconnectedAt: connectedAt })
      .where(and(eq(chargerConnections.chargerId, chargerId), isNull(chargerConnections.disconnectedAt)))
      .run();

    for (const connection of openConnections) {
      this.liveUpdates?.publish({
        type: 'charger.disconnected',
        chargerId,
        connectionId: connection.id,
        disconnectedAt: connectedAt.toISOString()
      });
    }

    this.db.insert(chargerConnections).values({
      id: connectionId,
      chargerId,
      connectedAt
    }).run();

    this.recordLog({
      category: 'charger',
      message: 'charger connected',
      chargerId
    });

    this.liveUpdates?.publish({
      type: 'charger.connected',
      chargerId,
      connectionId,
      connectedAt: connectedAt.toISOString()
    });

    this.communicationJournal?.recordChargerConnection(chargerId);
    this.publishChargerState(chargerId);

    return connectionId;
  }

  recordBootNotification(
    chargerId: string,
    input: {
      chargePointVendor?: string;
      chargePointModel?: string;
      firmwareVersion?: string;
    }
  ) {
    const now = new Date();
    this.upsertChargerSeen(chargerId, now);
    this.db
      .update(chargers)
      .set({
        lastBootAt: now,
        lastSeenAt: now,
        chargePointVendor: input.chargePointVendor ?? null,
        chargePointModel: input.chargePointModel ?? null,
        firmwareVersion: input.firmwareVersion ?? null,
        updatedAt: now
      })
      .where(eq(chargers.id, chargerId))
      .run();
    this.publishChargerState(chargerId);
  }

  recordSeen(chargerId: string) {
    this.upsertChargerSeen(chargerId);
    this.liveUpdates?.publish({
      type: 'charger.updated',
      chargerId,
      updatedAt: new Date().toISOString(),
      reason: 'seen'
    });
  }

  recordDisconnected(chargerId: string, connectionId?: string) {
    const now = new Date();
    const openConnections = connectionId
      ? []
      : this.db
          .select()
          .from(chargerConnections)
          .where(and(eq(chargerConnections.chargerId, chargerId), isNull(chargerConnections.disconnectedAt)))
          .all();
    const result = connectionId
      ? this.db
          .update(chargerConnections)
          .set({ disconnectedAt: now })
          .where(and(eq(chargerConnections.id, connectionId), isNull(chargerConnections.disconnectedAt)))
          .run()
      : this.db
          .update(chargerConnections)
          .set({ disconnectedAt: now })
          .where(and(eq(chargerConnections.chargerId, chargerId), isNull(chargerConnections.disconnectedAt)))
          .run();

    if (result.changes === 0) return;

    this.recordLog({
      category: 'charger',
      message: 'charger disconnected',
      chargerId
    });

    this.communicationJournal?.recordChargerDisconnect(chargerId);
    if (connectionId) {
      this.liveUpdates?.publish({
        type: 'charger.disconnected',
        chargerId,
        connectionId,
        disconnectedAt: now.toISOString()
      });
    } else {
      for (const connection of openConnections) {
        this.liveUpdates?.publish({
          type: 'charger.disconnected',
          chargerId,
          connectionId: connection.id,
          disconnectedAt: now.toISOString()
        });
      }
    }
    this.publishChargerState(chargerId);
  }

  isTagAllowed(chargerId: string, idTag: string | undefined) {
    if (!idTag) return false;

    const tag = this.db.select().from(tags).where(eq(tags.uuid, idTag)).limit(1).get();
    if (tag?.enabled !== true) return false;

    const access = this.db
      .select()
      .from(tagChargerAccess)
      .where(and(eq(tagChargerAccess.tagId, tag.id), eq(tagChargerAccess.chargerId, chargerId)))
      .limit(1)
      .get();
    return access?.enabled === true;
  }

  createSession(input: {
    chargerId: string;
    connectorId: number;
    transactionId: number;
    idTag?: string;
    startedAt: Date;
    meterStart?: number;
  }) {
    this.closeActiveSessionsForConnector(input.chargerId, input.connectorId, input.startedAt, 'ReplacedByNewTransaction');
    const sessionId = randomUUID();

    this.db.insert(chargingSessions).values({
      id: sessionId,
      chargerId: input.chargerId,
      connectorId: input.connectorId,
      transactionId: input.transactionId,
      idTag: input.idTag,
      startedAt: input.startedAt,
      startMeterWh: input.meterStart,
      status: 'active'
    }).run();

    this.recordLog({
      category: 'session',
      message: 'charging session started',
      chargerId: input.chargerId,
      transactionId: input.transactionId,
      metadata: {
        connectorId: input.connectorId,
        hasTag: Boolean(input.idTag)
      }
    });
    this.liveUpdates?.publish({
      type: 'session.created',
      chargerId: input.chargerId,
      sessionId,
      transactionId: input.transactionId,
      connectorId: input.connectorId,
      startedAt: input.startedAt.toISOString()
    });

    return sessionId;
  }

  detectMeterGapForSession(input: {
    chargerId: string;
    connectorId: number;
    newSessionId: string;
    startedAt: Date;
    meterStart?: number;
    thresholdWh: number;
  }) {
    if (typeof input.meterStart !== 'number') return null;
    if (input.thresholdWh <= 0) return null;

    const previousSession = this.db
      .select()
      .from(chargingSessions)
      .where(and(eq(chargingSessions.chargerId, input.chargerId), eq(chargingSessions.connectorId, input.connectorId), eq(chargingSessions.status, 'stopped')))
      .orderBy(desc(chargingSessions.stoppedAt))
      .all()
      .find((session) => typeof session.stopMeterWh === 'number');

    if (!previousSession || typeof previousSession.stopMeterWh !== 'number') return null;

    const result = this.createMeterGapEventIfNeeded({
      chargerId: input.chargerId,
      connectorId: input.connectorId,
      previousSession,
      newSessionId: input.newSessionId,
      newStartedAt: input.startedAt,
      newMeterStartWh: input.meterStart,
      thresholdWh: input.thresholdWh
    });
    return result.created ? result.id : null;
  }

  scanMeterGaps(input: { chargerId: string; thresholdWh: number }) {
    if (input.thresholdWh <= 0) {
      return { created: 0, existing: 0, ignored: 0 };
    }

    const rows = this.db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.chargerId, input.chargerId))
      .orderBy(chargingSessions.connectorId, chargingSessions.startedAt)
      .all();
    const byConnector = new Map<number, typeof rows>();
    for (const session of rows) {
      const sessions = byConnector.get(session.connectorId) ?? [];
      sessions.push(session);
      byConnector.set(session.connectorId, sessions);
    }

    const totals = { created: 0, existing: 0, ignored: 0 };
    for (const [connectorId, sessions] of byConnector.entries()) {
      let previousStoppedSession: typeof sessions[number] | null = null;
      for (const session of sessions) {
        if (typeof session.startMeterWh === 'number' && previousStoppedSession?.stopMeterWh !== null && previousStoppedSession?.stopMeterWh !== undefined) {
          const result = this.createMeterGapEventIfNeeded({
            chargerId: input.chargerId,
            connectorId,
            previousSession: previousStoppedSession,
            newSessionId: session.id,
            newStartedAt: session.startedAt,
            newMeterStartWh: session.startMeterWh,
            thresholdWh: input.thresholdWh
          });
          totals[result.created ? 'created' : result.existing ? 'existing' : 'ignored'] += 1;
        } else if (previousStoppedSession) {
          totals.ignored += 1;
        }

        if (session.status === 'stopped' && typeof session.stopMeterWh === 'number') {
          previousStoppedSession = session;
        }
      }
    }

    this.liveUpdates?.publish('sessions', input.chargerId);
    return totals;
  }

  getActiveSessionsForConnector(chargerId: string, connectorId: number) {
    return this.db
      .select()
      .from(chargingSessions)
      .where(and(eq(chargingSessions.chargerId, chargerId), eq(chargingSessions.connectorId, connectorId), eq(chargingSessions.status, 'active')))
      .all();
  }

  findDuplicateActiveStartCandidate(input: {
    chargerId: string;
    connectorId: number;
    idTag?: string;
    startedAt: Date;
    meterStart?: number;
  }) {
    const candidates = this.getActiveSessionsForConnector(input.chargerId, input.connectorId);
    return candidates.find((session) => (
      session.startedAt.getTime() === input.startedAt.getTime() &&
      (session.idTag ?? null) === (input.idTag ?? null) &&
      (session.startMeterWh ?? null) === (input.meterStart ?? null)
    )) ?? null;
  }

  findRecoverableStopTransactionSession(input: {
    chargerId: string;
    stoppedAt: Date;
    meterStop?: number;
  }) {
    const activeSessions = this.db
      .select()
      .from(chargingSessions)
      .where(and(eq(chargingSessions.chargerId, input.chargerId), eq(chargingSessions.status, 'active')))
      .all();
    const candidates = activeSessions.filter((session) => isRecoverableStopTransactionSession(session, input.stoppedAt, input.meterStop));

    return {
      session: candidates.length === 1 ? candidates[0] : null,
      candidateCount: candidates.length
    };
  }

  buildReplacementStopTransaction(session: typeof chargingSessions.$inferSelect, stoppedAt: Date): StopTransactionRequest {
    const latestEnergy = this.findLatestEnergySampleForSession(session);
    const meterStop = latestEnergy?.meterWh ?? session.startMeterWh ?? undefined;
    const payload: StopTransactionRequest = {
      transactionId: session.transactionId,
      timestamp: (latestEnergy?.sampledAt ?? stoppedAt).toISOString(),
      reason: 'Other'
    };

    if (typeof session.idTag === 'string' && session.idTag.trim()) {
      payload.idTag = session.idTag;
    }
    if (typeof meterStop === 'number') {
      payload.meterStop = Math.round(meterStop);
    }

    return payload;
  }

  stopSession(input: {
    chargerId: string;
    transactionId: number;
    stoppedAt: Date;
    meterStop?: number;
    reason?: string;
  }) {
    const session = this.db
      .select()
      .from(chargingSessions)
      .where(and(eq(chargingSessions.chargerId, input.chargerId), eq(chargingSessions.transactionId, input.transactionId)))
      .limit(1)
      .get();

    if (!session) {
      this.recordLog({
        level: 'warn',
        category: 'session',
        message: 'unmatched stop transaction ignored',
        chargerId: input.chargerId,
        transactionId: input.transactionId,
        metadata: {
          reason: input.reason ?? null,
          meterStop: input.meterStop ?? null,
          stoppedAt: input.stoppedAt.toISOString()
        }
      });
      return { status: 'not_found' as const, session: null };
    }

    if (session.status === 'stopped') {
      this.recordLog({
        level: 'warn',
        category: 'session',
        message: 'duplicate stop transaction ignored',
        chargerId: input.chargerId,
        transactionId: input.transactionId,
        metadata: {
          existingStoppedAt: session.stoppedAt?.toISOString() ?? null,
          existingMeterStop: session.stopMeterWh ?? null,
          existingReason: session.stopReason ?? null,
          duplicateStoppedAt: input.stoppedAt.toISOString(),
          duplicateMeterStop: input.meterStop ?? null,
          duplicateReason: input.reason ?? null
        }
      });
      return { status: 'duplicate' as const, session };
    }

    this.db
      .update(chargingSessions)
      .set({
        stoppedAt: input.stoppedAt,
        stopMeterWh: input.meterStop,
        stopReason: input.reason,
        status: 'stopped'
      })
      .where(and(eq(chargingSessions.chargerId, input.chargerId), eq(chargingSessions.transactionId, input.transactionId)))
      .run();

    this.recordLog({
      category: 'session',
      message: 'charging session stopped',
      chargerId: input.chargerId,
      transactionId: input.transactionId,
      metadata: {
        reason: input.reason
      }
    });
    this.liveUpdates?.publish({
      type: 'session.stopped',
      chargerId: input.chargerId,
      sessionId: session?.id ?? String(input.transactionId),
      transactionId: input.transactionId,
      connectorId: session?.connectorId ?? 0,
      stoppedAt: input.stoppedAt.toISOString(),
      reason: input.reason ?? null
    });
    return { status: 'stopped' as const, session };
  }

  recordMeterSample(input: {
    chargerId: string;
    connectorId: number;
    transactionId?: number;
    sampledAt: Date;
    value: string;
    numericValue?: number | null;
    normalizedValue?: number | null;
    normalizedUnit?: string | null;
    measurand?: string;
    unit?: string;
    context?: string;
    phase?: string;
    location?: string;
    format?: string;
  }) {
    this.db.insert(meterSamples).values({
      id: randomUUID(),
      chargerId: input.chargerId,
      connectorId: input.connectorId,
      transactionId: input.transactionId,
      sampledAt: input.sampledAt,
      value: input.value,
      numericValue: input.numericValue,
      normalizedValue: input.normalizedValue,
      normalizedUnit: input.normalizedUnit,
      measurand: input.measurand,
      unit: input.unit,
      context: input.context,
      phase: input.phase,
      location: input.location,
      format: input.format
    }).run();
    this.liveUpdates?.publishCoalesced(`meter:${input.chargerId}:${input.connectorId}`, {
      type: 'meter.sample.recorded',
      chargerId: input.chargerId,
      connectorId: input.connectorId,
      transactionId: input.transactionId ?? null,
      sampledAt: input.sampledAt.toISOString(),
      measurand: input.measurand ?? null
    });
  }

  private closeActiveSessionsForConnector(chargerId: string, connectorId: number, stoppedAt: Date, reason: string) {
    const staleSessions = this.db
      .select()
      .from(chargingSessions)
      .where(and(eq(chargingSessions.chargerId, chargerId), eq(chargingSessions.connectorId, connectorId), eq(chargingSessions.status, 'active')))
      .all();

    for (const session of staleSessions) {
      this.db
        .update(chargingSessions)
        .set({
          stoppedAt,
          stopReason: reason,
          status: 'stopped'
        })
        .where(eq(chargingSessions.id, session.id))
        .run();

      this.db
        .update(proxySessionMappings)
        .set({ stoppedAt })
        .where(
          and(
            eq(proxySessionMappings.chargerId, chargerId),
            eq(proxySessionMappings.localTransactionId, session.transactionId),
            isNull(proxySessionMappings.stoppedAt)
          )
        )
        .run();

      this.recordLog({
        level: 'warn',
        category: 'session',
        message: 'stale charging session closed',
        chargerId,
        transactionId: session.transactionId,
        metadata: {
          connectorId,
          reason
        }
      });
      this.liveUpdates?.publish({
        type: 'session.stopped',
        chargerId,
        sessionId: session.id,
        transactionId: session.transactionId,
        connectorId,
        stoppedAt: stoppedAt.toISOString(),
        reason
      });
    }
  }

  private findLatestEnergySampleForSession(session: typeof chargingSessions.$inferSelect) {
    const rows = this.db
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
        meterWh
      };
    }

    return null;
  }

  private upsertChargerSeen(chargerId: string, seenAt = new Date()) {
    const existing = this.db.select().from(chargers).where(eq(chargers.id, chargerId)).limit(1).get();
    if (existing) {
      this.db
        .update(chargers)
        .set({
          lastSeenAt: seenAt,
          updatedAt: seenAt
        })
        .where(eq(chargers.id, chargerId))
        .run();
      return;
    }

    this.db.insert(chargers).values({
      id: chargerId,
      enabled: true,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      createdAt: seenAt,
      updatedAt: seenAt
    }).run();
  }

  private publishChargerState(chargerId: string) {
    this.liveUpdates?.publish({
      type: 'charger.updated',
      chargerId,
      updatedAt: new Date().toISOString(),
      reason: 'state_changed'
    });
  }

  private createMeterGapEventIfNeeded(input: {
    chargerId: string;
    connectorId: number;
    previousSession: typeof chargingSessions.$inferSelect;
    newSessionId: string;
    newStartedAt: Date;
    newMeterStartWh: number;
    thresholdWh: number;
  }) {
    if (typeof input.previousSession.stopMeterWh !== 'number') return { created: false, existing: false, ignored: true, id: null };

    const deltaWh = input.newMeterStartWh - input.previousSession.stopMeterWh;
    if (deltaWh < input.thresholdWh) return { created: false, existing: false, ignored: true, id: null };

    const existing = this.db
      .select()
      .from(meterGapEvents)
      .where(
        and(
          eq(meterGapEvents.chargerId, input.chargerId),
          eq(meterGapEvents.connectorId, input.connectorId),
          eq(meterGapEvents.previousSessionId, input.previousSession.id),
          eq(meterGapEvents.newSessionId, input.newSessionId)
        )
      )
      .limit(1)
      .get();
    if (existing) return { created: false, existing: true, ignored: false, id: existing.id };

    const now = new Date();
    const id = randomUUID();
    this.db.insert(meterGapEvents).values({
      id,
      chargerId: input.chargerId,
      connectorId: input.connectorId,
      previousSessionId: input.previousSession.id,
      newSessionId: input.newSessionId,
      previousStoppedAt: input.previousSession.stoppedAt,
      newStartedAt: input.newStartedAt,
      previousMeterWh: input.previousSession.stopMeterWh,
      newMeterStartWh: input.newMeterStartWh,
      deltaWh,
      thresholdWh: input.thresholdWh,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }).run();

    this.recordLog({
      level: 'warn',
      category: 'session',
      message: 'meter gap detected',
      chargerId: input.chargerId,
      transactionId: this.db.select().from(chargingSessions).where(eq(chargingSessions.id, input.newSessionId)).limit(1).get()?.transactionId,
      metadata: {
        meterGapEventId: id,
        connectorId: input.connectorId,
        previousSessionId: input.previousSession.id,
        newSessionId: input.newSessionId,
        previousMeterWh: input.previousSession.stopMeterWh,
        newMeterStartWh: input.newMeterStartWh,
        deltaWh,
        thresholdWh: input.thresholdWh
      }
    });

    return { created: true, existing: false, ignored: false, id };
  }
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

function isRecoverableStopTransactionSession(
  session: typeof chargingSessions.$inferSelect,
  stoppedAt: Date,
  meterStop?: number
) {
  if (!(stoppedAt > session.startedAt)) return false;
  if (typeof meterStop !== 'number') return false;
  if (typeof session.startMeterWh === 'number' && meterStop < session.startMeterWh) return false;
  return true;
}
