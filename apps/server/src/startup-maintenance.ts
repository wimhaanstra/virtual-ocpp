import { randomUUID } from 'node:crypto';
import { isNull } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { chargerConnections, logs } from './db/schema.js';

export function closeStaleChargerConnections(db: Database, stoppedAt = new Date()) {
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
    db.insert(logs).values({
      id: randomUUID(),
      level: 'warn',
      category: 'charger',
      message: 'stale charger connection closed on startup',
      chargerId: connection.chargerId,
      metadata: JSON.stringify({
        connectionId: connection.id,
        connectedAt: connection.connectedAt.toISOString()
      }),
      createdAt: stoppedAt
    }).run();
  }

  return openConnections.length;
}
