import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import { CommunicationJournalService } from './communication-journal.js';
import type { Database } from './db/client.js';

const QuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  sourceType: z.enum(['charger', 'server', 'proxy']).optional(),
  sourceId: z.string().trim().min(1).optional(),
  targetType: z.enum(['charger', 'server', 'proxy']).optional(),
  targetId: z.string().trim().min(1).optional(),
  chargerId: z.string().trim().min(1).optional(),
  proxyTargetId: z.string().trim().min(1).optional(),
  ocppMethod: z.string().trim().min(1).optional(),
  messageType: z.enum(['call', 'callResult', 'callError', 'connection', 'disconnect']).optional(),
  transactionId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(200)
});
const DEFAULT_LIST_WINDOW_HOURS = 24;

export function registerCommunicationJournalRoutes(app: FastifyInstance, db: Database, journal: CommunicationJournalService) {
  app.get('/api/communication-journal', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query', details: parsed.error.flatten() });
    }

    const from = parseDate(parsed.data.from, new Date(Date.now() - DEFAULT_LIST_WINDOW_HOURS * 60 * 60 * 1000));
    const to = parseDate(parsed.data.to, new Date());
    if (!from || !to) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query' });
    }

    if (from.getTime() > to.getTime()) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query' });
    }

    return journal.list({
      from,
      to,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      chargerId: parsed.data.chargerId,
      proxyTargetId: parsed.data.proxyTargetId,
      ocppMethod: parsed.data.ocppMethod,
      messageType: parsed.data.messageType,
      transactionId: parsed.data.transactionId,
      limit: parsed.data.limit
    });
  });

  app.post('/api/communication-journal/purge', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const deletedCount = journal.purgeExpired();
    return reply.send({
      ok: true,
      deletedCount,
      retentionHours: journal.getRetentionHours()
    });
  });
}

function parseDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
