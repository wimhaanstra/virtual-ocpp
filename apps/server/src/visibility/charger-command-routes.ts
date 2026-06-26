import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import type { Database } from '../db/client.js';
import type { LiveUpdateBus } from '../live-updates.js';
import { recordLogEntry } from '../log-writer.js';
import { ChargerCommandError, type ChargerCommandService } from '../ocpp/charger-command-service.js';

const GetConfigurationCommandSchema = z.object({
  key: z.array(z.string().trim().min(1)).max(64).optional()
});
const ChangeConfigurationCommandSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string()
});
const TriggerMessageCommandSchema = z.object({
  requestedMessage: z.enum([
    'BootNotification',
    'DiagnosticsStatusNotification',
    'FirmwareStatusNotification',
    'Heartbeat',
    'MeterValues',
    'StatusNotification'
  ]),
  connectorId: z.coerce.number().int().min(0).optional()
});

const READABLE_CONFIGURATION_KEYS = new Set([
  'ClockAlignedDataInterval',
  'ConnectorPhaseRotation',
  'HeartbeatInterval',
  'MeterValueSampleInterval',
  'MeterValuesAlignedData',
  'MeterValuesSampledData',
  'NumberOfConnectors',
  'StopTxnAlignedData',
  'StopTxnSampledData',
  'SupportedFeatureProfiles'
]);

const WRITABLE_CONFIGURATION_KEYS = new Set([
  'ClockAlignedDataInterval',
  'HeartbeatInterval',
  'MeterValueSampleInterval',
  'MeterValuesAlignedData',
  'MeterValuesSampledData',
  'StopTxnAlignedData',
  'StopTxnSampledData'
]);

export function registerChargerCommandRoutes(
  app: FastifyInstance,
  db: Database,
  chargerCommands?: ChargerCommandService,
  liveUpdates?: LiveUpdateBus
) {
  app.post<{ Params: { id: string } }>('/api/chargers/:id/commands/get-configuration', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;

    const parsed = GetConfigurationCommandSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_get_configuration_command', details: parsed.error.flatten() });
    }
    const blockedKeys = getBlockedConfigurationKeys(parsed.data.key, READABLE_CONFIGURATION_KEYS);
    if (!parsed.data.key || parsed.data.key.length === 0 || blockedKeys.length > 0) {
      return reply.code(400).send({
        error: 'configuration_key_not_allowed',
        allowedKeys: [...READABLE_CONFIGURATION_KEYS].sort(),
        blockedKeys
      });
    }
    if (!chargerCommands) {
      return reply.code(503).send({ error: 'charger_commands_unavailable' });
    }

    try {
      const result = await chargerCommands.getConfiguration(request.params.id, parsed.data);
      recordChargerCommandLog(db, liveUpdates, {
        level: 'info',
        message: 'get configuration requested',
        chargerId: request.params.id,
        metadata: {
          keyCount: parsed.data.key?.length ?? 0,
          returnedKeyCount: result.configurationKey?.length ?? 0,
          unknownKeyCount: result.unknownKey?.length ?? 0
        }
      });
      return result;
    } catch (error) {
      return handleChargerCommandFailure(reply, db, liveUpdates, {
        error,
        chargerId: request.params.id,
        message: 'get configuration failed'
      });
    }
  });

  app.post<{ Params: { id: string } }>('/api/chargers/:id/commands/change-configuration', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;

    const parsed = ChangeConfigurationCommandSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_change_configuration_command', details: parsed.error.flatten() });
    }
    if (!WRITABLE_CONFIGURATION_KEYS.has(parsed.data.key)) {
      return reply.code(400).send({
        error: 'configuration_key_not_writable',
        allowedKeys: [...WRITABLE_CONFIGURATION_KEYS].sort(),
        blockedKeys: [parsed.data.key]
      });
    }
    if (!chargerCommands) {
      return reply.code(503).send({ error: 'charger_commands_unavailable' });
    }

    try {
      const result = await chargerCommands.changeConfiguration(request.params.id, parsed.data);
      const status = typeof result.status === 'string' ? result.status : 'Unknown';
      recordChargerCommandLog(db, liveUpdates, {
        level: status === 'Accepted' || status === 'RebootRequired' ? 'info' : 'warn',
        message: 'change configuration requested',
        chargerId: request.params.id,
        metadata: {
          key: parsed.data.key,
          status
        }
      });
      return { ...result, status };
    } catch (error) {
      return handleChargerCommandFailure(reply, db, liveUpdates, {
        error,
        chargerId: request.params.id,
        message: 'change configuration failed',
        metadata: { key: parsed.data.key }
      });
    }
  });

  app.post<{ Params: { id: string } }>('/api/chargers/:id/commands/trigger-message', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;

    const parsed = TriggerMessageCommandSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_trigger_message_command', details: parsed.error.flatten() });
    }
    if (!chargerCommands) {
      return reply.code(503).send({ error: 'charger_commands_unavailable' });
    }

    try {
      const result = await chargerCommands.triggerMessage(request.params.id, parsed.data);
      const status = typeof result.status === 'string' ? result.status : 'Unknown';
      recordChargerCommandLog(db, liveUpdates, {
        level: status === 'Accepted' ? 'info' : 'warn',
        message: 'trigger message requested',
        chargerId: request.params.id,
        metadata: {
          requestedMessage: parsed.data.requestedMessage,
          connectorId: parsed.data.connectorId ?? null,
          status
        }
      });
      return { ...result, status };
    } catch (error) {
      return handleChargerCommandFailure(reply, db, liveUpdates, {
        error,
        chargerId: request.params.id,
        message: 'trigger message failed',
        metadata: {
          requestedMessage: parsed.data.requestedMessage,
          connectorId: parsed.data.connectorId ?? null
        }
      });
    }
  });
}

function recordChargerCommandLog(
  db: Database,
  liveUpdates: LiveUpdateBus | undefined,
  input: {
    level: 'info' | 'warn';
    message: string;
    chargerId: string;
    metadata?: Record<string, unknown>;
  }
) {
  recordLogEntry(db, liveUpdates, {
    level: input.level,
    category: 'charger-command',
    message: input.message,
    chargerId: input.chargerId,
    metadata: input.metadata
  });
}

function handleChargerCommandFailure(
  reply: FastifyReply,
  db: Database,
  liveUpdates: LiveUpdateBus | undefined,
  input: {
    error: unknown;
    chargerId: string;
    message: string;
    metadata?: Record<string, unknown>;
  }
) {
  const statusCode = input.error instanceof ChargerCommandError && input.error.code === 'charger_not_connected' ? 409 : 502;
  recordChargerCommandLog(db, liveUpdates, {
    level: 'warn',
    message: input.message,
    chargerId: input.chargerId,
    metadata: {
      ...input.metadata,
      errorType: input.error instanceof Error ? input.error.name : 'unknown_error',
      errorCode: input.error && typeof input.error === 'object' && 'code' in input.error ? (input.error as { code?: unknown }).code : undefined
    }
  });

  return reply.code(statusCode).send({
    error: input.error instanceof ChargerCommandError ? input.error.code : 'charger_command_failed'
  });
}

function getBlockedConfigurationKeys(keys: string[] | undefined, allowlist: Set<string>) {
  return (keys ?? []).filter((key) => !allowlist.has(key));
}
