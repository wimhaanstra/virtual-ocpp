import { randomUUID } from 'node:crypto';
import type { Database } from './db/client.js';
import { logs } from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function recordLogEntry(
  db: Database,
  liveUpdates: LiveUpdateBus | undefined,
  input: {
    level?: LogLevel;
    category: string;
    message: string;
    chargerId?: string;
    transactionId?: number;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
  }
) {
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date();

  db.insert(logs).values({
    id,
    level: input.level ?? 'info',
    category: input.category,
    message: input.message,
    chargerId: input.chargerId,
    transactionId: input.transactionId,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt
  }).run();

  liveUpdates?.publish({
    type: 'log.recorded',
    logId: id,
    level: input.level ?? 'info',
    category: input.category,
    chargerId: input.chargerId ?? null,
    transactionId: input.transactionId ?? null
  });

  return id;
}
