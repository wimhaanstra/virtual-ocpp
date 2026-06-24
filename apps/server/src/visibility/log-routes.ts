import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import type { Database } from '../db/client.js';
import { logs } from '../db/schema.js';
import { toPublicLog } from './public-mappers.js';

const RECENT_LOG_LIMIT = 100;

const ChargerScopedQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

export function registerLogRoutes(app: FastifyInstance, db: Database) {
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
