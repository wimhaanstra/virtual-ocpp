import { z } from 'zod';

type QueryValue = string | number | boolean | null | undefined;

export type McpApiClient = {
  getJson<T>(path: string, query?: Record<string, QueryValue>): Promise<T>;
  getText(path: string, query?: Record<string, QueryValue>): Promise<string>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  patchJson<T>(path: string, body: unknown): Promise<T>;
  putJson<T>(path: string, body: unknown): Promise<T>;
  deleteJson<T>(path: string): Promise<T>;
};

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ToolDefinition<TSchema extends z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schema: TSchema;
  run(client: McpApiClient, input: z.infer<TSchema>): Promise<unknown>;
};

const EmptySchema = z.object({});
const ChargerScopedSchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});
const ChargerRequiredSchema = z.object({
  chargerId: z.string().trim().min(1)
});
const ChargerUpdateSchema = ChargerRequiredSchema.extend({
  label: z.string().trim().min(1).max(120).nullable().optional(),
  enabled: z.boolean().optional()
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
  tagMappings: z.array(z.object({ localIdTag: z.string().trim().min(1), outboundIdTag: z.string().trim().min(1) })).optional()
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
const CommunicationRetentionSchema = z.object({
  retentionHours: z.number().int().min(1).max(8760)
});
const ChargerConfigurationReadSchema = ChargerRequiredSchema.extend({
  keys: z.array(z.string().trim().min(1)).min(1).max(64)
});
const ChargerConfigurationWriteSchema = ChargerRequiredSchema.extend({
  key: z.string().trim().min(1),
  value: z.string()
});
const TriggerMessageSchema = ChargerRequiredSchema.extend({
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

const toolDefinitions: Array<ToolDefinition<z.ZodTypeAny>> = [
  defineTool({
    name: 'chargers_list',
    description: 'List chargers and their current connection state.',
    schema: ChargerScopedSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' } }),
    run: (client, input) => client.getJson('/api/chargers', input.chargerId ? { chargerId: input.chargerId } : undefined)
  }),
  defineTool({
    name: 'chargers_update',
    description: 'Update a charger label or enabled state.',
    schema: ChargerUpdateSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, label: nullableString(), enabled: { type: 'boolean' } }, ['chargerId']),
    run: (client, input) => client.patchJson(`/api/chargers/${encodeURIComponent(input.chargerId)}`, { label: input.label, enabled: input.enabled })
  }),
  defineTool({
    name: 'tags_list',
    description: 'List tags and charger access grants.',
    schema: EmptySchema,
    inputSchema: objectSchema({}),
    run: (client) => client.getJson('/api/tags')
  }),
  defineTool({
    name: 'tags_create',
    description: 'Create a tag.',
    schema: TagCreateSchema,
    inputSchema: objectSchema({ uuid: { type: 'string' }, label: { type: 'string' }, enabled: { type: 'boolean' } }, ['uuid']),
    run: (client, input) => client.postJson('/api/tags', input)
  }),
  defineTool({
    name: 'tags_update',
    description: 'Update a tag.',
    schema: TagUpdateSchema,
    inputSchema: objectSchema({ tagId: { type: 'string' }, uuid: { type: 'string' }, label: nullableString(), enabled: { type: 'boolean' } }, ['tagId']),
    run: (client, input) => client.patchJson(`/api/tags/${encodeURIComponent(input.tagId)}`, omit(input, 'tagId'))
  }),
  defineTool({
    name: 'tags_grant_access',
    description: 'Grant or update tag access for a charger.',
    schema: TagAccessSchema,
    inputSchema: objectSchema({ tagId: { type: 'string' }, chargerId: { type: 'string' }, enabled: { type: 'boolean' } }, ['tagId', 'chargerId']),
    run: (client, input) =>
      client.putJson(`/api/tags/${encodeURIComponent(input.tagId)}/chargers/${encodeURIComponent(input.chargerId)}`, { enabled: input.enabled ?? true })
  }),
  defineTool({
    name: 'tags_revoke_access',
    description: 'Revoke tag access for a charger.',
    schema: TagAccessSchema.pick({ tagId: true, chargerId: true }),
    inputSchema: objectSchema({ tagId: { type: 'string' }, chargerId: { type: 'string' } }, ['tagId', 'chargerId']),
    run: (client, input) => client.deleteJson(`/api/tags/${encodeURIComponent(input.tagId)}/chargers/${encodeURIComponent(input.chargerId)}`)
  }),
  defineTool({
    name: 'proxy_targets_list',
    description: 'List proxy targets for a charger.',
    schema: ChargerRequiredSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' } }, ['chargerId']),
    run: (client, input) => client.getJson('/api/proxy-targets', { chargerId: input.chargerId })
  }),
  defineTool({
    name: 'proxy_targets_create',
    description: 'Create a proxy target for a charger.',
    schema: ProxyTargetCreateSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' } }, ['chargerId', 'name', 'url']),
    run: (client, input) => client.postJson('/api/proxy-targets', input)
  }),
  defineTool({
    name: 'proxy_targets_update',
    description: 'Update a proxy target.',
    schema: ProxyTargetUpdateSchema,
    inputSchema: objectSchema({ proxyTargetId: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' }, enabled: { type: 'boolean' } }, ['proxyTargetId']),
    run: (client, input) => client.patchJson(`/api/proxy-targets/${encodeURIComponent(input.proxyTargetId)}`, omit(input, 'proxyTargetId'))
  }),
  defineTool({
    name: 'proxy_targets_delete',
    description: 'Delete a proxy target.',
    schema: z.object({ proxyTargetId: z.string().trim().min(1) }),
    inputSchema: objectSchema({ proxyTargetId: { type: 'string' } }, ['proxyTargetId']),
    run: (client, input) => client.deleteJson(`/api/proxy-targets/${encodeURIComponent(input.proxyTargetId)}`)
  }),
  defineTool({
    name: 'sessions_search',
    description: 'Search charging sessions.',
    schema: SessionsSearchSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, status: { enum: ['active', 'stopped'] }, limit: { type: 'number' } }),
    run: (client, input) => client.getJson('/api/sessions/search', input)
  }),
  defineTool({
    name: 'sessions_summary',
    description: 'Summarize charging sessions.',
    schema: ChargerScopedSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' } }),
    run: (client, input) => client.getJson('/api/session-summary', input)
  }),
  defineTool({
    name: 'sessions_active_audit',
    description: 'Inspect active sessions for stale or manual-review warnings.',
    schema: ChargerScopedSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' } }),
    run: (client, input) => client.getJson('/api/active-session-audit', input)
  }),
  defineTool({
    name: 'communication_journal_list',
    description: 'List recent communication journal entries.',
    schema: CommunicationQuerySchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, ocppMethod: { type: 'string' }, messageType: { type: 'string' }, limit: { type: 'number' } }),
    run: (client, input) => client.getJson('/api/communication-journal', input)
  }),
  defineTool({
    name: 'communication_journal_export',
    description: 'Export communication journal rows as CSV.',
    schema: CommunicationQuerySchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, ocppMethod: { type: 'string' }, messageType: { type: 'string' }, limit: { type: 'number' } }),
    run: (client, input) => client.getText('/api/communication-journal/export', input)
  }),
  defineTool({
    name: 'communication_journal_purge',
    description: 'Purge communication journal rows by retention or explicit filters.',
    schema: CommunicationPurgeSchema,
    inputSchema: objectSchema({ scope: { enum: ['retention', 'filters'] }, confirm: { type: 'string' }, filters: { type: 'object' } }),
    run: (client, input) => client.postJson('/api/communication-journal/purge', input)
  }),
  defineTool({
    name: 'settings_get_communication',
    description: 'Read communication retention settings.',
    schema: EmptySchema,
    inputSchema: objectSchema({}),
    run: (client) => client.getJson('/api/settings/communication')
  }),
  defineTool({
    name: 'settings_update_communication',
    description: 'Update communication retention settings.',
    schema: CommunicationRetentionSchema,
    inputSchema: objectSchema({ retentionHours: { type: 'number' } }, ['retentionHours']),
    run: (client, input) => client.patchJson('/api/settings/communication', input)
  }),
  defineTool({
    name: 'chargers_get_configuration',
    description: 'Read an allowlisted set of charger configuration keys.',
    schema: ChargerConfigurationReadSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, keys: { type: 'array', items: { type: 'string' } } }, ['chargerId', 'keys']),
    run: (client, input) => client.postJson(`/api/chargers/${encodeURIComponent(input.chargerId)}/commands/get-configuration`, { key: input.keys })
  }),
  defineTool({
    name: 'chargers_change_configuration',
    description: 'Attempt an allowlisted charger configuration change.',
    schema: ChargerConfigurationWriteSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' } }, ['chargerId', 'key', 'value']),
    run: (client, input) => client.postJson(`/api/chargers/${encodeURIComponent(input.chargerId)}/commands/change-configuration`, { key: input.key, value: input.value })
  }),
  defineTool({
    name: 'chargers_trigger_message',
    description: 'Request a supported charger trigger message.',
    schema: TriggerMessageSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' }, requestedMessage: { enum: TriggerMessageSchema.shape.requestedMessage.options }, connectorId: { type: 'number' } }, ['chargerId', 'requestedMessage']),
    run: (client, input) =>
      client.postJson(`/api/chargers/${encodeURIComponent(input.chargerId)}/commands/trigger-message`, {
        requestedMessage: input.requestedMessage,
        connectorId: input.connectorId
      })
  }),
  defineTool({
    name: 'diagnostics_smartevse',
    description: 'Summarize SmartEVSE MeterValues cadence, recent journal activity, active session, and proxy mappings.',
    schema: ChargerRequiredSchema,
    inputSchema: objectSchema({ chargerId: { type: 'string' } }, ['chargerId']),
    run: (client, input) => client.getJson(`/api/diagnostics/smartevse/${encodeURIComponent(input.chargerId)}`)
  })
];

export function listToolDefinitions() {
  return toolDefinitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function executeTool(client: McpApiClient, name: string, args: unknown): Promise<ToolResult> {
  const tool = toolDefinitions.find((definition) => definition.name === name);
  if (!tool) {
    return errorResult(`Unknown tool: ${name}`);
  }

  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    return errorResult(`Invalid arguments for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`);
  }

  try {
    const result = await tool.run(client, parsed.data);
    return {
      content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : 'The Virtual OCPP API returned an unknown error.');
  }
}

function defineTool<TSchema extends z.ZodTypeAny>(tool: ToolDefinition<TSchema>) {
  return tool;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

function nullableString() {
  return { anyOf: [{ type: 'string' }, { type: 'null' }] };
}

function errorResult(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }]
  };
}

function omit<T extends Record<string, unknown>, K extends keyof T>(object: T, key: K) {
  const copy = { ...object };
  delete copy[key];
  return copy;
}
