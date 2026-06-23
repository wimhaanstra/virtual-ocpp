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
const ExportQuerySchema = QuerySchema.extend({
  limit: z.coerce.number().int().positive().max(5000).default(5000)
});
const PurgeBodySchema = z.object({
  scope: z.enum(['retention', 'filters']).default('retention'),
  confirm: z.string().optional(),
  filters: QuerySchema.omit({ limit: true }).partial().optional()
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

  app.get('/api/communication-journal/export', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ExportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query', details: parsed.error.flatten() });
    }

    const filters = parseFilters(parsed.data);
    if (!filters) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query' });
    }

    const result = journal.list(filters);
    const csv = toCommunicationCsv(result.items);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${buildExportFilename()}"`)
      .send(csv);
  });

  app.post('/api/communication-journal/purge', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = PurgeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_communication_journal_purge', details: parsed.error.flatten() });
    }

    if (parsed.data.scope === 'filters') {
      if (parsed.data.confirm !== 'PURGE') {
        return reply.code(400).send({ error: 'purge_confirmation_required' });
      }

      const filters = parseFilters({ ...parsed.data.filters, limit: 1 }, { requireExplicitFilter: true });
      if (!filters) {
        return reply.code(400).send({ error: 'invalid_communication_journal_purge' });
      }

      const result = journal.purgeMatching(filters);
      return reply.send({
        ok: true,
        deletedCount: result.deletedCount,
        retentionHours: journal.getRetentionHours(),
        scope: 'filters'
      });
    }

    const deletedCount = journal.purgeExpired();
    return reply.send({
      ok: true,
      deletedCount,
      retentionHours: journal.getRetentionHours(),
      scope: 'retention'
    });
  });
}

type ParsedQuery = z.infer<typeof ExportQuerySchema>;

function parseFilters(
  data: Partial<ParsedQuery>,
  options: { requireExplicitFilter?: boolean } = {}
) {
  const from = parseDate(data.from, options.requireExplicitFilter ? undefined : new Date(Date.now() - DEFAULT_LIST_WINDOW_HOURS * 60 * 60 * 1000));
  const to = parseDate(data.to, options.requireExplicitFilter ? undefined : new Date());
  if (from === null || to === null) return null;
  if (from && to && from.getTime() > to.getTime()) return null;

  const filters = {
    from: from ?? undefined,
    to: to ?? undefined,
    sourceType: data.sourceType,
    sourceId: data.sourceId,
    targetType: data.targetType,
    targetId: data.targetId,
    chargerId: data.chargerId,
    proxyTargetId: data.proxyTargetId,
    ocppMethod: data.ocppMethod,
    messageType: data.messageType,
    transactionId: data.transactionId,
    limit: data.limit
  };

  if (options.requireExplicitFilter) {
    const hasExplicitFilter = Object.entries(filters).some(([key, value]) => key !== 'limit' && value !== undefined);
    if (!hasExplicitFilter) return null;
  }

  return filters;
}

function parseDate(value: string | undefined, fallback?: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toCommunicationCsv(items: ReturnType<CommunicationJournalService['list']>['items']) {
  const headers = [
    'createdAt',
    'direction',
    'sourceType',
    'sourceId',
    'targetType',
    'targetId',
    'chargerId',
    'proxyTargetId',
    'messageType',
    'ocppMethod',
    'transactionId',
    'idTag',
    'errorCode',
    'errorDescription',
    'correlationId',
    'payload'
  ];

  const rows = items.map((item) =>
    [
      item.createdAt,
      item.direction,
      item.sourceType,
      item.sourceId,
      item.targetType,
      item.targetId,
      item.chargerId ?? '',
      item.proxyTargetId ?? '',
      item.messageType,
      item.ocppMethod ?? '',
      item.transactionId ?? '',
      item.idTag ?? '',
      item.errorCode ?? '',
      item.errorDescription ?? '',
      item.correlationId ?? '',
      JSON.stringify(item.payload)
    ].map(csvCell).join(',')
  );

  return `${headers.join(',')}\n${rows.join('\n')}${rows.length > 0 ? '\n' : ''}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function buildExportFilename() {
  return `communication-journal-${new Date().toISOString().replaceAll(':', '-')}.csv`;
}
