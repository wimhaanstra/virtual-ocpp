import { z } from 'zod';
import type { ApiClient } from './http-client.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolDefinition<TSchema extends z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schema: TSchema;
  run(client: ApiClient, input: any): Promise<unknown>;
};

const TagMappingSchema = z.object({
  localIdTag: z.string().trim().min(1).max(255),
  outboundIdTag: z.string().trim().min(1).max(255)
});

const ChargersListSchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});
const ChargerUpdateSchema = z.object({
  chargerId: z.string().trim().min(1),
  label: z.string().trim().min(1).max(120).nullable().optional(),
  enabled: z.boolean().optional()
});
const ChargerMeterGapScanSchema = z.object({
  chargerId: z.string().trim().min(1),
  thresholdWh: z.number().int().positive().optional()
});

const TagCreateSchema = z.object({
  uuid: z.string().trim().min(1).max(64),
  label: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional()
});
const TagUpdateSchema = z.object({
  tagId: z.string().trim().min(1),
  uuid: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  enabled: z.boolean().optional()
});
const TagAccessSchema = z.object({
  tagId: z.string().trim().min(1),
  chargerId: z.string().trim().min(1),
  enabled: z.boolean().optional()
});

const ProxyTargetCreateSchema = z.object({
  chargerId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
  username: z.string().trim().min(1).nullable().optional(),
  stationId: z.string().trim().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(['monitor-only', 'deny-capable']).optional(),
  outagePolicy: z.enum(['fail-open', 'fail-closed']).optional(),
  allowRecoverySubmissions: z.boolean().optional(),
  basicAuthPassword: z.string().min(1).nullable().optional(),
  tagMappings: z.array(TagMappingSchema).optional()
});
const ProxyTargetUpdateSchema = ProxyTargetCreateSchema.partial().extend({
  proxyTargetId: z.string().trim().min(1)
});

const SessionsSearchSchema = z.object({
  chargerId: z.string().trim().min(1).optional(),
  status: z.enum(['active', 'stopped']).optional(),
  idTag: z.string().trim().optional(),
  transactionId: z.number().int().nonnegative().optional(),
  connectorId: z.number().int().positive().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  minEnergyWh: z.number().int().nonnegative().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(200).optional()
});
const ChargerScopedSchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

const CommunicationQuerySchema = z.object({
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
  limit: z.number().int().positive().max(500).optional()
});
const CommunicationPurgeSchema = z.object({
  scope: z.enum(['retention', 'filters']).default('retention'),
  confirm: z.string().optional(),
  filters: CommunicationQuerySchema.partial().optional()
});

const OnboardingActionSchema = z.object({
  action: z.enum(['completed', 'skipped', 'reset'])
});
const CommunicationRetentionSchema = z.object({
  retentionHours: z.number().int().min(1).max(8760)
});

const ChargerConfigurationReadSchema = z.object({
  chargerId: z.string().trim().min(1),
  keys: z.array(z.string().trim().min(1)).min(1).max(64)
});
const ChargerConfigurationWriteSchema = z.object({
  chargerId: z.string().trim().min(1),
  key: z.string().trim().min(1),
  value: z.string()
});
const TriggerMessageSchema = z.object({
  chargerId: z.string().trim().min(1),
  requestedMessage: z.enum([
    'BootNotification',
    'DiagnosticsStatusNotification',
    'FirmwareStatusNotification',
    'Heartbeat',
    'MeterValues',
    'StatusNotification'
  ]),
  connectorId: z.number().int().min(0).optional()
});
const SmartEvseDiagnosticsSchema = z.object({
  chargerId: z.string().trim().min(1)
});

const toolDefinitions: Array<ToolDefinition<z.ZodTypeAny>> = [
  defineTool({
    name: 'chargers_list',
    description: 'List chargers and their current connection state.',
    schema: ChargersListSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' }
      },
      additionalProperties: false
    },
    run: (client, input) => client.getJson('/api/chargers', input.chargerId ? { chargerId: input.chargerId } : undefined)
  }),
  defineTool({
    name: 'chargers_update',
    description: 'Update a charger label or enabled state.',
    schema: ChargerUpdateSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' },
        label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        enabled: { type: 'boolean' }
      },
      required: ['chargerId'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.patchJson(`/api/chargers/${encodeURIComponent(input.chargerId)}`, {
        label: input.label,
        enabled: input.enabled
      })
  }),
  defineTool({
    name: 'chargers_scan_meter_gaps',
    description: 'Run a meter-gap scan for a charger.',
    schema: ChargerMeterGapScanSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' },
        thresholdWh: { type: 'number' }
      },
      required: ['chargerId'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.postJson(`/api/chargers/${encodeURIComponent(input.chargerId)}/meter-gaps/scan`, {
        thresholdWh: input.thresholdWh
      })
  }),
  defineTool({
    name: 'tags_list',
    description: 'List tags and charger access grants.',
    schema: z.object({}),
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    run: (client) => client.getJson('/api/tags')
  }),
  defineTool({
    name: 'tags_create',
    description: 'Create a new tag.',
    schema: TagCreateSchema,
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        label: { type: 'string' },
        enabled: { type: 'boolean' }
      },
      required: ['uuid'],
      additionalProperties: false
    },
    run: (client, input) => client.postJson('/api/tags', input)
  }),
  defineTool({
    name: 'tags_update',
    description: 'Update an existing tag.',
    schema: TagUpdateSchema,
    inputSchema: {
      type: 'object',
      properties: {
        tagId: { type: 'string' },
        uuid: { type: 'string' },
        label: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        enabled: { type: 'boolean' }
      },
      required: ['tagId'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.patchJson(`/api/tags/${encodeURIComponent(input.tagId)}`, {
        uuid: input.uuid,
        label: input.label,
        enabled: input.enabled
      })
  }),
  defineTool({
    name: 'tags_delete',
    description: 'Delete a tag.',
    schema: z.object({ tagId: z.string().trim().min(1) }),
    inputSchema: {
      type: 'object',
      properties: {
        tagId: { type: 'string' }
      },
      required: ['tagId'],
      additionalProperties: false
    },
    run: (client, input) => client.deleteJson(`/api/tags/${encodeURIComponent(input.tagId)}`)
  }),
  defineTool({
    name: 'tags_grant_access',
    description: 'Grant or update tag access for a charger.',
    schema: TagAccessSchema,
    inputSchema: {
      type: 'object',
      properties: {
        tagId: { type: 'string' },
        chargerId: { type: 'string' },
        enabled: { type: 'boolean' }
      },
      required: ['tagId', 'chargerId'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.putJson(`/api/tags/${encodeURIComponent(input.tagId)}/chargers/${encodeURIComponent(input.chargerId)}`, {
        enabled: input.enabled ?? true
      })
  }),
  defineTool({
    name: 'tags_revoke_access',
    description: 'Revoke tag access from a charger.',
    schema: z.object({
      tagId: z.string().trim().min(1),
      chargerId: z.string().trim().min(1)
    }),
    inputSchema: {
      type: 'object',
      properties: {
        tagId: { type: 'string' },
        chargerId: { type: 'string' }
      },
      required: ['tagId', 'chargerId'],
      additionalProperties: false
    },
    run: (client, input) => client.deleteJson(`/api/tags/${encodeURIComponent(input.tagId)}/chargers/${encodeURIComponent(input.chargerId)}`)
  }),
  defineTool({
    name: 'proxy_targets_list',
    description: 'List proxy targets for a charger.',
    schema: ChargerScopedSchema.extend({ chargerId: z.string().trim().min(1) }),
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' }
      },
      required: ['chargerId'],
      additionalProperties: false
    },
    run: (client, input) => client.getJson('/api/proxy-targets', { chargerId: input.chargerId })
  }),
  defineTool({
    name: 'proxy_targets_create',
    description: 'Create a proxy target for a charger.',
    schema: ProxyTargetCreateSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        username: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        stationId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        enabled: { type: 'boolean' },
        mode: { enum: ['monitor-only', 'deny-capable'] },
        outagePolicy: { enum: ['fail-open', 'fail-closed'] },
        allowRecoverySubmissions: { type: 'boolean' },
        basicAuthPassword: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        tagMappings: { type: 'array' }
      },
      required: ['chargerId', 'name', 'url'],
      additionalProperties: false
    },
    run: (client, input) => client.postJson('/api/proxy-targets', input)
  }),
  defineTool({
    name: 'proxy_targets_update',
    description: 'Update a proxy target.',
    schema: ProxyTargetUpdateSchema,
    inputSchema: {
      type: 'object',
      properties: {
        proxyTargetId: { type: 'string' },
        chargerId: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        username: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        stationId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        enabled: { type: 'boolean' },
        mode: { enum: ['monitor-only', 'deny-capable'] },
        outagePolicy: { enum: ['fail-open', 'fail-closed'] },
        allowRecoverySubmissions: { type: 'boolean' },
        basicAuthPassword: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        tagMappings: { type: 'array' }
      },
      required: ['proxyTargetId'],
      additionalProperties: false
    },
    run: (client, input) => client.patchJson(`/api/proxy-targets/${encodeURIComponent(input.proxyTargetId)}`, omit(input, 'proxyTargetId'))
  }),
  defineTool({
    name: 'proxy_targets_delete',
    description: 'Delete a proxy target.',
    schema: z.object({ proxyTargetId: z.string().trim().min(1) }),
    inputSchema: {
      type: 'object',
      properties: {
        proxyTargetId: { type: 'string' }
      },
      required: ['proxyTargetId'],
      additionalProperties: false
    },
    run: (client, input) => client.deleteJson(`/api/proxy-targets/${encodeURIComponent(input.proxyTargetId)}`)
  }),
  defineTool({
    name: 'sessions_search',
    description: 'Search charging sessions.',
    schema: SessionsSearchSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' },
        status: { enum: ['active', 'stopped'] },
        idTag: { type: 'string' },
        transactionId: { type: 'number' },
        connectorId: { type: 'number' },
        from: { type: 'string' },
        to: { type: 'string' },
        minEnergyWh: { type: 'number' },
        cursor: { type: 'string' },
        limit: { type: 'number' }
      },
      additionalProperties: false
    },
    run: (client, input) => client.getJson('/api/sessions/search', input)
  }),
  defineTool({
    name: 'sessions_summary',
    description: 'Summarize charging sessions.',
    schema: ChargerScopedSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' }
      },
      additionalProperties: false
    },
    run: (client, input) => client.getJson('/api/session-summary', input)
  }),
  defineTool({
    name: 'sessions_active_audit',
    description: 'Inspect active sessions for stale or manual-review warnings.',
    schema: ChargerScopedSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' }
      },
      additionalProperties: false
    },
    run: (client, input) => client.getJson('/api/active-session-audit', input)
  }),
  defineTool({
    name: 'communication_journal_list',
    description: 'List recent communication journal entries.',
    schema: CommunicationQuerySchema,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        preset: { type: 'string' },
        sourceType: { type: 'string' },
        sourceId: { type: 'string' },
        targetType: { type: 'string' },
        targetId: { type: 'string' },
        chargerId: { type: 'string' },
        proxyTargetId: { type: 'string' },
        ocppMethod: { type: 'string' },
        method: { type: 'string' },
        messageType: { type: 'string' },
        type: { type: 'string' },
        transactionId: { type: 'string' },
        limit: { type: 'number' }
      },
      additionalProperties: false
    },
    run: (client, input) => client.getJson('/api/communication-journal', input)
  }),
  defineTool({
    name: 'communication_journal_export',
    description: 'Export the current communication journal filter as CSV.',
    schema: CommunicationQuerySchema,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        preset: { type: 'string' },
        sourceType: { type: 'string' },
        sourceId: { type: 'string' },
        targetType: { type: 'string' },
        targetId: { type: 'string' },
        chargerId: { type: 'string' },
        proxyTargetId: { type: 'string' },
        ocppMethod: { type: 'string' },
        method: { type: 'string' },
        messageType: { type: 'string' },
        type: { type: 'string' },
        transactionId: { type: 'string' },
        limit: { type: 'number' }
      },
      additionalProperties: false
    },
    run: (client, input) => client.getText('/api/communication-journal/export', input)
  }),
  defineTool({
    name: 'communication_journal_purge',
    description: 'Purge communication journal entries by retention or explicit filters.',
    schema: CommunicationPurgeSchema,
    inputSchema: {
      type: 'object',
      properties: {
        scope: { enum: ['retention', 'filters'] },
        confirm: { type: 'string' },
        filters: { type: 'object' }
      },
      additionalProperties: false
    },
    run: (client, input) => client.postJson('/api/communication-journal/purge', input)
  }),
  defineTool({
    name: 'settings_get_onboarding',
    description: 'Read onboarding settings.',
    schema: z.object({}),
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    run: (client) => client.getJson('/api/settings/onboarding')
  }),
  defineTool({
    name: 'settings_update_onboarding',
    description: 'Mark onboarding completed, skipped, or reset.',
    schema: OnboardingActionSchema,
    inputSchema: {
      type: 'object',
      properties: {
        action: { enum: ['completed', 'skipped', 'reset'] }
      },
      required: ['action'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.patchJson('/api/settings/onboarding', {
        [input.action]: true
      })
  }),
  defineTool({
    name: 'settings_get_communication',
    description: 'Read communication retention settings.',
    schema: z.object({}),
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    run: (client) => client.getJson('/api/settings/communication')
  }),
  defineTool({
    name: 'settings_update_communication',
    description: 'Update communication retention settings.',
    schema: CommunicationRetentionSchema,
    inputSchema: {
      type: 'object',
      properties: {
        retentionHours: { type: 'number' }
      },
      required: ['retentionHours'],
      additionalProperties: false
    },
    run: (client, input) => client.patchJson('/api/settings/communication', input)
  }),
  defineTool({
    name: 'chargers_get_configuration',
    description: 'Read an allowlisted set of charger configuration keys.',
    schema: ChargerConfigurationReadSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' },
        keys: { type: 'array', items: { type: 'string' } }
      },
      required: ['chargerId', 'keys'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.postJson(`/api/chargers/${encodeURIComponent(input.chargerId)}/commands/get-configuration`, {
        key: input.keys
      })
  }),
  defineTool({
    name: 'chargers_change_configuration',
    description: 'Attempt an allowlisted charger configuration change.',
    schema: ChargerConfigurationWriteSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' }
      },
      required: ['chargerId', 'key', 'value'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.postJson(`/api/chargers/${encodeURIComponent(input.chargerId)}/commands/change-configuration`, {
        key: input.key,
        value: input.value
      })
  }),
  defineTool({
    name: 'chargers_trigger_message',
    description: 'Request a supported charger trigger message.',
    schema: TriggerMessageSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' },
        requestedMessage: {
          enum: [
            'BootNotification',
            'DiagnosticsStatusNotification',
            'FirmwareStatusNotification',
            'Heartbeat',
            'MeterValues',
            'StatusNotification'
          ]
        },
        connectorId: { type: 'number' }
      },
      required: ['chargerId', 'requestedMessage'],
      additionalProperties: false
    },
    run: (client, input) =>
      client.postJson(`/api/chargers/${encodeURIComponent(input.chargerId)}/commands/trigger-message`, {
        requestedMessage: input.requestedMessage,
        connectorId: input.connectorId
      })
  }),
  defineTool({
    name: 'diagnostics_smartevse',
    description: 'Summarize SmartEVSE MeterValues cadence, recent journal activity, active session, and proxy mappings for one charger.',
    schema: SmartEvseDiagnosticsSchema,
    inputSchema: {
      type: 'object',
      properties: {
        chargerId: { type: 'string' }
      },
      required: ['chargerId'],
      additionalProperties: false
    },
    run: (client, input) => client.getJson(`/api/diagnostics/smartevse/${encodeURIComponent(input.chargerId)}`)
  })
] as const;

export type ToolName = (typeof toolDefinitions)[number]['name'];

export function listToolDefinitions() {
  return toolDefinitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function executeTool(client: ApiClient, name: string, args: unknown): Promise<ToolResult> {
  const tool = toolDefinitions.find((definition) => definition.name === name);
  if (!tool) {
    return errorResult(`Unknown tool: ${name}`);
  }

  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    return errorResult(`Invalid arguments for ${name}: ${summarizeValidation(parsed.error)}`);
  }

  try {
    const result = await tool.run(client, parsed.data);
    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    return errorResult(formatError(error));
  }
}

function defineTool<TSchema extends z.ZodTypeAny>(tool: ToolDefinition<TSchema>) {
  return tool;
}

function errorResult(message: string): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message
      }
    ]
  };
}

function summarizeValidation(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
    .slice(0, 6)
    .join('; ');
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'ApiError') {
      return error.message;
    }
    return 'The Virtual OCPP API returned an unexpected error.';
  }
  return 'The Virtual OCPP API returned an unknown error.';
}

function omit<T extends Record<string, unknown>, K extends keyof T>(object: T, key: K) {
  const copy = { ...object };
  delete copy[key];
  return copy;
}
