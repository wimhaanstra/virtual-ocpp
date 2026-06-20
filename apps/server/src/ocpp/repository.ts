import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { CommunicationJournalService } from '../communication-journal.js';
import { chargerConnections, chargers, chargingSessions, logs, meterSamples, tagChargerAccess, tags } from '../db/schema.js';

export class OcppRepository {
  constructor(
    private readonly db: Database,
    private readonly communicationJournal?: CommunicationJournalService
  ) {}

  recordLog(input: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    category: string;
    message: string;
    chargerId?: string;
    transactionId?: number;
    metadata?: Record<string, unknown>;
  }) {
    this.db.insert(logs).values({
      id: randomUUID(),
      level: input.level ?? 'info',
      category: input.category,
      message: input.message,
      chargerId: input.chargerId,
      transactionId: input.transactionId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date()
    }).run();
  }

  recordConnected(chargerId: string) {
    this.upsertChargerSeen(chargerId);
    const connectionId = randomUUID();

    this.db
      .update(chargerConnections)
      .set({ disconnectedAt: new Date() })
      .where(and(eq(chargerConnections.chargerId, chargerId), isNull(chargerConnections.disconnectedAt)))
      .run();

    this.db.insert(chargerConnections).values({
      id: connectionId,
      chargerId,
      connectedAt: new Date()
    }).run();

    this.recordLog({
      category: 'charger',
      message: 'charger connected',
      chargerId
    });

    this.communicationJournal?.recordChargerConnection(chargerId);

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
  }

  recordSeen(chargerId: string) {
    this.upsertChargerSeen(chargerId);
  }

  recordDisconnected(chargerId: string, connectionId?: string) {
    const now = new Date();
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
    this.db.insert(chargingSessions).values({
      id: randomUUID(),
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
  }

  stopSession(input: {
    chargerId: string;
    transactionId: number;
    stoppedAt: Date;
    meterStop?: number;
    reason?: string;
  }) {
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
}
