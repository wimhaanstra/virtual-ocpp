import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import type { Database } from '../db/client.js';
import { chargerConnections } from '../db/schema.js';
import { toPublicChargerConnection } from './public-mappers.js';

const RECENT_LIMIT = 50;

const ChargerScopedQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

export function registerConnectionRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/charger-connections', async (request, reply) => {
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
  });
}
