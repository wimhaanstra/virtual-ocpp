import { isNull } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { chargerConnections } from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';
import { recordLogEntry } from './log-writer.js';

export function closeStaleChargerConnections(db: Database, liveUpdates?: LiveUpdateBus, stoppedAt = new Date()) {
  const openConnections = db
    .select()
    .from(chargerConnections)
    .where(isNull(chargerConnections.disconnectedAt))
    .all();

  if (openConnections.length === 0) return 0;

  db
    .update(chargerConnections)
    .set({ disconnectedAt: stoppedAt })
    .where(isNull(chargerConnections.disconnectedAt))
    .run();

  for (const connection of openConnections) {
    recordLogEntry(db, liveUpdates, {
      level: 'warn',
      category: 'charger',
      message: 'stale charger connection closed on startup',
      chargerId: connection.chargerId,
      metadata: {
        connectionId: connection.id,
        connectedAt: connection.connectedAt.toISOString()
      },
      createdAt: stoppedAt
    });
    liveUpdates?.publish({
      type: 'charger.disconnected',
      chargerId: connection.chargerId,
      connectionId: connection.id,
      disconnectedAt: stoppedAt.toISOString()
    });
    liveUpdates?.publish('sessions', connection.chargerId);
  }

  return openConnections.length;
}
