import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import {
  CommunicationJournalService,
  decodeCommunicationJournalCursor,
  type CommunicationJournalListFilters,
  type CommunicationMessageType,
  type CommunicationSourceType,
  type CommunicationTargetType
} from './communication-journal.js';
import type { Database } from './db/client.js';

const QuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.string().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  chargerId: z.string().optional(),
  proxyTargetId: z.string().optional(),
  ocppMethod: z.string().optional(),
  method: z.string().optional(),
  messageType: z.string().optional(),
  type: z.string().optional(),
  transactionId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
});
const ExportQuerySchema = QuerySchema.extend({
  cursor: z.undefined().optional(),
  limit: z.coerce.number().int().positive().max(5000).default(5000)
});
const PurgeBodySchema = z.object({
  scope: z.enum(['retention', 'filters']).default('retention'),
  confirm: z.string().optional(),
  filters: QuerySchema.omit({ limit: true, cursor: true }).partial().optional()
});
const DEFAULT_LIST_WINDOW_HOURS = 24;
const PRESET_MS = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000
} as const;

export function registerCommunicationJournalRoutes(app: FastifyInstance, db: Database, journal: CommunicationJournalService) {
  app.get('/api/communication-journal', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query', details: parsed.error.flatten() });
    }

    const filters = normalizeCommunicationFilters(parsed.data, { defaultWindow: true, allowCursor: true });
    if (!filters) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query' });
    }

    return journal.list(filters);
  });

  app.get('/api/communication-journal/export', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ExportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_communication_journal_query', details: parsed.error.flatten() });
    }

    const filters = normalizeCommunicationFilters(parsed.data, { defaultWindow: true });
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
    if (await requireAdmin(request, reply, db, 'write')) return;

    const parsed = PurgeBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_communication_journal_purge', details: parsed.error.flatten() });
    }

    if (parsed.data.scope === 'filters') {
      if (parsed.data.confirm !== 'PURGE') {
        return reply.code(400).send({ error: 'purge_confirmation_required' });
      }

      const filters = normalizeCommunicationFilters({ ...parsed.data.filters, limit: 1 }, { requireExplicitFilter: true });
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

type ParsedQuery = z.infer<typeof QuerySchema>;

function normalizeCommunicationFilters(
  data: Partial<ParsedQuery>,
  options: { requireExplicitFilter?: boolean; defaultWindow?: boolean; allowCursor?: boolean } = {}
): CommunicationJournalListFilters | null {
  const preset = trimOptional(data.preset);
  const explicitFrom = trimOptional(data.from);
  const explicitTo = trimOptional(data.to);
  const now = new Date();
  let from = parseDate(explicitFrom);
  let to = parseDate(explicitTo);
  if (from === null || to === null) return null;

  if (!from && !to && preset && preset !== 'custom') {
    if (!isPreset(preset)) return null;
    to = now;
    from = new Date(now.getTime() - PRESET_MS[preset]);
  } else if (preset && preset !== 'custom' && !isPreset(preset)) {
    return null;
  }

  if (options.defaultWindow && !from && !to) {
    from = new Date(now.getTime() - DEFAULT_LIST_WINDOW_HOURS * 60 * 60 * 1000);
    to = now;
  }

  if (from && to && from.getTime() > to.getTime()) return null;
  const cursor = trimOptional(data.cursor);
  const parsedCursor = cursor && options.allowCursor ? decodeCommunicationJournalCursor(cursor) : undefined;
  if (cursor && options.allowCursor && !parsedCursor) return null;
  if (cursor && !options.allowCursor) return null;
  const transactionIdValue = trimOptional(data.transactionId);
  let transactionId: number | undefined;
  if (transactionIdValue) {
    const parsedTransactionId = Number(transactionIdValue);
    if (!Number.isInteger(parsedTransactionId) || parsedTransactionId < 0) return null;
    transactionId = parsedTransactionId;
  }
  const sourceType = trimOptional(data.sourceType);
  const targetType = trimOptional(data.targetType);
  const messageType = trimOptional(data.messageType ?? data.type);
  if (sourceType && !isEndpointType(sourceType)) return null;
  if (targetType && !isEndpointType(targetType)) return null;
  if (messageType && !isMessageType(messageType)) return null;

  const filters = {
    from: from ?? undefined,
    to: to ?? undefined,
    sourceType: sourceType as CommunicationSourceType | undefined,
    sourceId: trimOptional(data.sourceId),
    targetType: targetType as CommunicationTargetType | undefined,
    targetId: trimOptional(data.targetId),
    chargerId: trimOptional(data.chargerId),
    proxyTargetId: trimOptional(data.proxyTargetId),
    ocppMethod: trimOptional(data.ocppMethod ?? data.method),
    messageType: messageType as CommunicationMessageType | undefined,
    transactionId,
    limit: data.limit,
    cursor: parsedCursor ?? undefined
  };

  if (options.requireExplicitFilter) {
    const hasExplicitFilter = Object.entries(filters).some(([key, value]) => !['limit', 'cursor'].includes(key) && value !== undefined);
    if (!hasExplicitFilter) return null;
  }

  return filters;
}

function trimOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPreset(value: string): value is keyof typeof PRESET_MS {
  return value in PRESET_MS;
}

function isEndpointType(value: string): value is CommunicationSourceType {
  return value === 'charger' || value === 'server' || value === 'proxy';
}

function isMessageType(value: string): value is CommunicationMessageType {
  return value === 'call' || value === 'callResult' || value === 'callError' || value === 'connection' || value === 'disconnect' || value === 'raw';
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
