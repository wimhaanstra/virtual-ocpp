import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { communicationJournal } from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';

const PURGE_THROTTLE_MS = 10 * 60 * 1000;
const DEFAULT_LIST_WINDOW_HOURS = 24;
const REDACTED_VALUE = '[redacted]';
const SENSITIVE_KEY_PARTS = ['password', 'secret', 'token', 'authorization', 'cookie', 'credential'];

export type CommunicationDirection = 'inbound' | 'outbound';
export type CommunicationSourceType = 'charger' | 'server' | 'proxy';
export type CommunicationTargetType = 'charger' | 'server' | 'proxy';
export type CommunicationMessageType = 'call' | 'callResult' | 'callError' | 'connection' | 'disconnect';

export type CommunicationJournalEntryInput = {
  direction: CommunicationDirection;
  sourceType: CommunicationSourceType;
  sourceId: string;
  targetType: CommunicationTargetType;
  targetId: string;
  messageType: CommunicationMessageType;
  chargerId?: string | null;
  proxyTargetId?: string | null;
  ocppMethod?: string | null;
  transactionId?: number | null;
  idTag?: string | null;
  payload?: unknown;
  errorCode?: string | null;
  errorDescription?: string | null;
  correlationId?: string | null;
  createdAt?: Date;
};

export type CommunicationJournalListFilters = {
  from?: Date;
  to?: Date;
  sourceType?: CommunicationSourceType;
  sourceId?: string;
  targetType?: CommunicationTargetType;
  targetId?: string;
  chargerId?: string;
  proxyTargetId?: string;
  ocppMethod?: string;
  messageType?: CommunicationMessageType;
  transactionId?: number;
  limit?: number;
  cursor?: CommunicationJournalCursor;
};

export type CommunicationJournalPurgeFilters = Omit<CommunicationJournalListFilters, 'limit'>;

export type CommunicationJournalItem = {
  id: string;
  createdAt: string;
  direction: CommunicationDirection;
  sourceType: CommunicationSourceType;
  sourceId: string;
  targetType: CommunicationTargetType;
  targetId: string;
  chargerId: string | null;
  proxyTargetId: string | null;
  messageType: CommunicationMessageType;
  ocppMethod: string | null;
  transactionId: number | null;
  idTag: string | null;
  payload: unknown;
  errorCode: string | null;
  errorDescription: string | null;
  correlationId: string | null;
};

export type CommunicationJournalStorageSummary = {
  rowCount: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
  retentionHours: number;
};

export type CommunicationJournalCursor = {
  createdAt: Date;
  id: string;
};

export class CommunicationJournalService {
  private lastRuntimePurgeAt = 0;

  constructor(
    private readonly db: Database,
    private readonly retentionHoursProvider: () => number = () => 24,
    private readonly liveUpdates?: LiveUpdateBus
  ) {}

  getRetentionHours() {
    return this.retentionHoursProvider();
  }

  recordChargerCall(input: Omit<CommunicationJournalEntryInput, 'direction' | 'sourceType' | 'sourceId' | 'targetType' | 'targetId' | 'messageType'> & {
    chargerId: string;
    ocppMethod: string;
    payload: unknown;
    correlationId?: string | null;
  }) {
    return this.recordEntry({
      ...input,
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: input.chargerId,
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: input.chargerId
    });
  }

  recordChargerResult(input: Omit<CommunicationJournalEntryInput, 'direction' | 'sourceType' | 'sourceId' | 'targetType' | 'targetId' | 'messageType'> & {
    chargerId: string;
    ocppMethod: string;
    payload: unknown;
    correlationId?: string | null;
  }) {
    return this.recordEntry({
      ...input,
      direction: 'outbound',
      sourceType: 'server',
      sourceId: 'server',
      targetType: 'charger',
      targetId: input.chargerId,
      messageType: 'callResult',
      chargerId: input.chargerId
    });
  }

  recordChargerError(input: Omit<CommunicationJournalEntryInput, 'direction' | 'sourceType' | 'sourceId' | 'targetType' | 'targetId' | 'messageType'> & {
    chargerId: string;
    ocppMethod: string;
    payload: unknown;
    errorCode?: string | null;
    errorDescription?: string | null;
    correlationId?: string | null;
  }) {
    return this.recordEntry({
      ...input,
      direction: 'outbound',
      sourceType: 'server',
      sourceId: 'server',
      targetType: 'charger',
      targetId: input.chargerId,
      messageType: 'callError',
      chargerId: input.chargerId
    });
  }

  recordProxyCall(input: Omit<CommunicationJournalEntryInput, 'direction' | 'sourceType' | 'sourceId' | 'targetType' | 'targetId' | 'messageType'> & {
    chargerId: string;
    proxyTargetId: string;
    ocppMethod: string;
    payload: unknown;
    correlationId?: string | null;
  }) {
    return this.recordEntry({
      ...input,
      direction: 'outbound',
      sourceType: 'server',
      sourceId: 'server',
      targetType: 'proxy',
      targetId: input.proxyTargetId,
      messageType: 'call',
      chargerId: input.chargerId,
      proxyTargetId: input.proxyTargetId
    });
  }

  recordProxyResult(input: Omit<CommunicationJournalEntryInput, 'direction' | 'sourceType' | 'sourceId' | 'targetType' | 'targetId' | 'messageType'> & {
    chargerId: string;
    proxyTargetId: string;
    ocppMethod: string;
    payload: unknown;
    correlationId?: string | null;
  }) {
    return this.recordEntry({
      ...input,
      direction: 'inbound',
      sourceType: 'proxy',
      sourceId: input.proxyTargetId,
      targetType: 'server',
      targetId: 'server',
      messageType: 'callResult',
      chargerId: input.chargerId,
      proxyTargetId: input.proxyTargetId
    });
  }

  recordProxyError(input: Omit<CommunicationJournalEntryInput, 'direction' | 'sourceType' | 'sourceId' | 'targetType' | 'targetId' | 'messageType'> & {
    chargerId: string;
    proxyTargetId: string;
    ocppMethod: string;
    payload: unknown;
    errorCode?: string | null;
    errorDescription?: string | null;
    correlationId?: string | null;
  }) {
    return this.recordEntry({
      ...input,
      direction: 'inbound',
      sourceType: 'proxy',
      sourceId: input.proxyTargetId,
      targetType: 'server',
      targetId: 'server',
      messageType: 'callError',
      chargerId: input.chargerId,
      proxyTargetId: input.proxyTargetId
    });
  }

  recordChargerConnection(chargerId: string) {
    return this.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: chargerId,
      targetType: 'server',
      targetId: 'server',
      messageType: 'connection',
      chargerId,
      payload: { chargerId }
    });
  }

  recordChargerDisconnect(chargerId: string) {
    return this.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: chargerId,
      targetType: 'server',
      targetId: 'server',
      messageType: 'disconnect',
      chargerId,
      payload: { chargerId }
    });
  }

  recordEntry(input: CommunicationJournalEntryInput) {
    const createdAt = input.createdAt ?? new Date();
    const id = randomUUID();
    this.db.insert(communicationJournal).values({
      id,
      createdAt,
      direction: input.direction,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      targetType: input.targetType,
      targetId: input.targetId,
      chargerId: input.chargerId ?? null,
      proxyTargetId: input.proxyTargetId ?? null,
      messageType: input.messageType,
      ocppMethod: input.ocppMethod ?? null,
      transactionId: input.transactionId ?? null,
      idTag: input.idTag ?? null,
      payloadJson: serializePayloadJson(input.payload),
      errorCode: input.errorCode ?? null,
      errorDescription: input.errorDescription ?? null,
      correlationId: input.correlationId ?? null
    }).run();

    this.purgeIfDue(new Date());
    this.liveUpdates?.publish({
      type: 'journal.recorded',
      journalId: id,
      createdAt: createdAt.toISOString(),
      direction: input.direction,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      targetType: input.targetType,
      targetId: input.targetId,
      chargerId: input.chargerId ?? null,
      proxyTargetId: input.proxyTargetId ?? null,
      messageType: input.messageType,
      ocppMethod: input.ocppMethod ?? null,
      transactionId: input.transactionId ?? null
    });
  }

  purgeExpired(now = new Date()) {
    this.lastRuntimePurgeAt = now.getTime();
    const retentionHours = this.getRetentionHours();
    const cutoff = new Date(now.getTime() - retentionHours * 60 * 60 * 1000);
    const result = this.db.delete(communicationJournal).where(lt(communicationJournal.createdAt, cutoff)).run();
    const deletedCount = toChanges(result);
    if (deletedCount > 0) {
      this.liveUpdates?.publish({
        type: 'journal.purged',
        retentionHours,
        deletedCount
      });
    }
    return deletedCount;
  }

  purgeMatching(filters: CommunicationJournalPurgeFilters) {
    const conditions = buildFilterConditions(filters);
    if (conditions.length === 0) {
      return { deletedCount: 0, skipped: true };
    }

    const result = this.db.delete(communicationJournal).where(and(...conditions)).run();
    const deletedCount = toChanges(result);
    if (deletedCount > 0) {
      this.liveUpdates?.publish({
        type: 'journal.purged',
        retentionHours: this.getRetentionHours(),
        deletedCount
      });
    }
    return { deletedCount, skipped: false };
  }

  list(filters: CommunicationJournalListFilters = {}) {
    const from = filters.from ?? new Date(Date.now() - DEFAULT_LIST_WINDOW_HOURS * 60 * 60 * 1000);
    const to = filters.to ?? new Date();
    const limit = Math.max(1, Math.min(filters.limit ?? 100, 5000));
    const conditions = buildFilterConditions({ ...filters, from, to });
    if (filters.cursor) {
      const cursorCondition = or(
        lt(communicationJournal.createdAt, filters.cursor.createdAt),
        and(eq(communicationJournal.createdAt, filters.cursor.createdAt), lt(communicationJournal.id, filters.cursor.id))
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }

    const rows = this.db
      .select()
      .from(communicationJournal)
      .where(and(...conditions))
      .orderBy(desc(communicationJournal.createdAt), desc(communicationJournal.id))
      .limit(limit + 1)
      .all();
    const pageRows = rows.slice(0, limit);
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map(toPublicItem),
      retentionHours: this.getRetentionHours(),
      nextCursor: rows.length > limit && lastRow ? encodeCommunicationJournalCursor({ createdAt: lastRow.createdAt, id: lastRow.id }) : null,
      hasMore: rows.length > limit,
      storage: this.getStorageSummary()
    };
  }

  getStorageSummary(): CommunicationJournalStorageSummary {
    const row = this.db
      .select({
        rowCount: sql<number>`count(*)`,
        oldestCreatedAt: sql<number | string | Date | null>`min(${communicationJournal.createdAt})`,
        newestCreatedAt: sql<number | string | Date | null>`max(${communicationJournal.createdAt})`
      })
      .from(communicationJournal)
      .get();

    return {
      rowCount: Number(row?.rowCount ?? 0),
      oldestCreatedAt: toIsoDate(row?.oldestCreatedAt ?? null),
      newestCreatedAt: toIsoDate(row?.newestCreatedAt ?? null),
      retentionHours: this.getRetentionHours()
    };
  }

  private purgeIfDue(now: Date) {
    if (now.getTime() - this.lastRuntimePurgeAt < PURGE_THROTTLE_MS) {
      return;
    }
    this.purgeExpired(now);
  }
}

function toIsoDate(value: number | string | Date | null) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function encodeCommunicationJournalCursor(cursor: CommunicationJournalCursor) {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeCommunicationJournalCursor(value: string): CommunicationJournalCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || parsed.id.trim() === '') {
      return null;
    }

    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }

    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function buildFilterConditions(filters: CommunicationJournalPurgeFilters) {
  const conditions = [];

  if (filters.from) conditions.push(gte(communicationJournal.createdAt, filters.from));
  if (filters.to) conditions.push(lte(communicationJournal.createdAt, filters.to));
  if (filters.sourceType) conditions.push(eq(communicationJournal.sourceType, filters.sourceType));
  if (filters.sourceId) conditions.push(eq(communicationJournal.sourceId, filters.sourceId));
  if (filters.targetType) conditions.push(eq(communicationJournal.targetType, filters.targetType));
  if (filters.targetId) conditions.push(eq(communicationJournal.targetId, filters.targetId));
  if (filters.chargerId) conditions.push(eq(communicationJournal.chargerId, filters.chargerId));
  if (filters.proxyTargetId) conditions.push(eq(communicationJournal.proxyTargetId, filters.proxyTargetId));
  if (filters.ocppMethod) conditions.push(sql`${communicationJournal.ocppMethod} like ${`%${escapeLikePattern(filters.ocppMethod)}%`} escape '\\'`);
  if (filters.messageType) conditions.push(eq(communicationJournal.messageType, filters.messageType));
  if (typeof filters.transactionId === 'number') conditions.push(eq(communicationJournal.transactionId, filters.transactionId));

  return conditions;
}

function escapeLikePattern(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function redactCommunicationPayload(payload: unknown): unknown {
  return redactValue(payload, new WeakMap<object, unknown>());
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED_VALUE;
    const redacted: unknown[] = [];
    seen.set(value, redacted);
    for (const item of value) {
      redacted.push(redactValue(item, seen));
    }
    return redacted;
  }

  if (value instanceof Error) {
    if (seen.has(value)) return REDACTED_VALUE;
    return {
      name: value.name,
      message: value.message,
      code: (value as Error & { code?: unknown }).code
    };
  }

  if (seen.has(value)) return REDACTED_VALUE;
  const output: Record<string, unknown> = {};
  seen.set(value, output);

  for (const [key, child] of Object.entries(value)) {
    output[key] = shouldRedactKey(key) ? REDACTED_VALUE : redactValue(child, seen);
  }

  return output;
}

function shouldRedactKey(key: string) {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function serializePayloadJson(payload: unknown) {
  const redacted = redactCommunicationPayload(payload);
  const serialized = JSON.stringify(redacted);
  return serialized ?? 'null';
}

function toPublicItem(row: typeof communicationJournal.$inferSelect): CommunicationJournalItem {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    direction: row.direction as CommunicationDirection,
    sourceType: row.sourceType as CommunicationSourceType,
    sourceId: row.sourceId,
    targetType: row.targetType as CommunicationTargetType,
    targetId: row.targetId,
    chargerId: row.chargerId,
    proxyTargetId: row.proxyTargetId,
    messageType: row.messageType as CommunicationMessageType,
    ocppMethod: row.ocppMethod,
    transactionId: row.transactionId,
    idTag: row.idTag,
    payload: parsePayload(row.payloadJson),
    errorCode: row.errorCode,
    errorDescription: row.errorDescription,
    correlationId: row.correlationId
  };
}

function parsePayload(payloadJson: string) {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return {
      rawPayloadJson: payloadJson
    };
  }
}

function toChanges(result: unknown) {
  if (typeof result === 'object' && result !== null && 'changes' in result) {
    const changes = (result as { changes?: number }).changes;
    return typeof changes === 'number' ? changes : 0;
  }

  return 0;
}
