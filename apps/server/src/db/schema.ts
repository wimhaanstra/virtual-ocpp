import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const DEFAULT_TENANT_ID = 'default';

export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    publicId: text('public_id').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => ({
    publicIdUnique: uniqueIndex('tenants_public_id_unique').on(table.publicId)
  })
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    isSuperAdmin: integer('is_super_admin', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    disabledAt: integer('disabled_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    usernameUnique: uniqueIndex('users_username_unique').on(table.username)
  })
);

export const tenantMemberships = sqliteTable(
  'tenant_memberships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    tenantUserUnique: uniqueIndex('tenant_memberships_tenant_user_unique').on(table.tenantId, table.userId),
    userIdx: index('tenant_memberships_user_id_idx').on(table.userId),
    tenantIdx: index('tenant_memberships_tenant_id_idx').on(table.tenantId)
  })
);

export const tenantInvites = sqliteTable(
  'tenant_invites',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    codeHash: text('code_hash').notNull(),
    role: text('role').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' }),
    redeemedByUserId: text('redeemed_by_user_id'),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    codeHashUnique: uniqueIndex('tenant_invites_code_hash_unique').on(table.codeHash),
    tenantIdx: index('tenant_invites_tenant_id_idx').on(table.tenantId)
  })
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  userId: text('user_id'),
  role: text('role').notNull().default('owner'),
  username: text('username').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
});

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    userId: text('user_id'),
    name: text('name').notNull(),
    scope: text('scope').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('api_tokens_token_hash_unique').on(table.tokenHash),
    createdAtIdx: index('api_tokens_created_at_idx').on(table.createdAt)
  })
);

export const onboardingSettings = sqliteTable('onboarding_settings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  skippedAt: integer('skipped_at', { mode: 'timestamp_ms' })
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    uuid: text('uuid').notNull(),
    label: text('label'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => ({
    tenantUuidUnique: uniqueIndex('tags_tenant_uuid_unique').on(table.tenantId, table.uuid)
  })
);

export const chargers = sqliteTable('chargers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  credentialHash: text('credential_hash'),
  label: text('label'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  lastBootAt: integer('last_boot_at', { mode: 'timestamp_ms' }),
  chargePointVendor: text('charge_point_vendor'),
  chargePointModel: text('charge_point_model'),
  firmwareVersion: text('firmware_version'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const tagChargerAccess = sqliteTable(
  'tag_charger_access',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    tagId: text('tag_id').notNull(),
    chargerId: text('charger_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => ({
    tagIdx: index('tag_charger_access_tag_id_idx').on(table.tagId),
    chargerIdx: index('tag_charger_access_charger_id_idx').on(table.chargerId),
    tagChargerUnique: uniqueIndex('tag_charger_access_tag_id_charger_id_unique').on(table.tagId, table.chargerId)
  })
);

export const chargerConnections = sqliteTable('charger_connections', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  chargerId: text('charger_id').notNull(),
  connectedAt: integer('connected_at', { mode: 'timestamp_ms' }).notNull(),
  disconnectedAt: integer('disconnected_at', { mode: 'timestamp_ms' })
});

export const chargingSessions = sqliteTable('charging_sessions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  chargerId: text('charger_id').notNull(),
  connectorId: integer('connector_id').notNull(),
  transactionId: integer('transaction_id').notNull(),
  idTag: text('id_tag'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' }),
  startMeterWh: integer('start_meter_wh'),
  stopMeterWh: integer('stop_meter_wh'),
  stopReason: text('stop_reason'),
  status: text('status').notNull()
});

export const remoteStopRequests = sqliteTable(
  'remote_stop_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    sessionId: text('session_id').notNull(),
    chargerId: text('charger_id').notNull(),
    transactionId: integer('transaction_id').notNull(),
    status: text('status').notNull(),
    responseStatus: text('response_status'),
    errorCode: text('error_code'),
    requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    sessionIdx: index('remote_stop_requests_session_id_idx').on(table.sessionId),
    chargerTransactionIdx: index('remote_stop_requests_charger_transaction_idx').on(table.chargerId, table.transactionId),
    statusIdx: index('remote_stop_requests_status_idx').on(table.status)
  })
);

export const meterSamples = sqliteTable('meter_samples', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  chargerId: text('charger_id').notNull(),
  transactionId: integer('transaction_id'),
  connectorId: integer('connector_id').notNull(),
  sampledAt: integer('sampled_at', { mode: 'timestamp_ms' }).notNull(),
  value: text('value').notNull(),
  numericValue: real('numeric_value'),
  normalizedValue: real('normalized_value'),
  normalizedUnit: text('normalized_unit'),
  measurand: text('measurand'),
  unit: text('unit'),
  context: text('context'),
  phase: text('phase'),
  location: text('location'),
  format: text('format')
});

export const meterGapEvents = sqliteTable(
  'meter_gap_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    chargerId: text('charger_id').notNull(),
    connectorId: integer('connector_id').notNull(),
    previousSessionId: text('previous_session_id'),
    newSessionId: text('new_session_id').notNull(),
    previousStoppedAt: integer('previous_stopped_at', { mode: 'timestamp_ms' }),
    newStartedAt: integer('new_started_at', { mode: 'timestamp_ms' }).notNull(),
    previousMeterWh: integer('previous_meter_wh').notNull(),
    newMeterStartWh: integer('new_meter_start_wh').notNull(),
    deltaWh: integer('delta_wh').notNull(),
    thresholdWh: integer('threshold_wh').notNull(),
    status: text('status').notNull(),
    submissionResultJson: text('submission_result_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => ({
    chargerIdx: index('meter_gap_events_charger_id_idx').on(table.chargerId),
    statusIdx: index('meter_gap_events_status_idx').on(table.status)
  })
);

export const proxyTargets = sqliteTable('proxy_targets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  chargerId: text('charger_id'),
  name: text('name').notNull(),
  url: text('url').notNull(),
  username: text('username'),
  stationId: text('station_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  mode: text('mode').notNull(),
  outagePolicy: text('outage_policy').notNull(),
  allowRecoverySubmissions: integer('allow_recovery_submissions', { mode: 'boolean' }).notNull().default(false),
  basicAuthPassword: text('basic_auth_password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const chargerProxyAssignments = sqliteTable(
  'charger_proxy_assignments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    chargerId: text('charger_id').notNull(),
    proxyTargetId: text('proxy_target_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    stationId: text('station_id'),
    mode: text('mode').notNull(),
    outagePolicy: text('outage_policy').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => ({
    chargerIdIdx: index('charger_proxy_assignments_charger_id_idx').on(table.chargerId),
    proxyTargetIdx: index('charger_proxy_assignments_proxy_target_id_idx').on(table.proxyTargetId),
    chargerTargetUnique: uniqueIndex('charger_proxy_assignments_charger_id_proxy_target_id_unique').on(
      table.chargerId,
      table.proxyTargetId
    )
  })
);

export const proxySessionMappings = sqliteTable('proxy_session_mappings', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  chargerId: text('charger_id').notNull(),
  proxyTargetId: text('proxy_target_id').notNull(),
  localTransactionId: integer('local_transaction_id').notNull(),
  externalTransactionId: integer('external_transaction_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' })
});

export const proxyTagMappings = sqliteTable(
  'proxy_tag_mappings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    proxyTargetId: text('proxy_target_id').notNull(),
    localIdTag: text('local_id_tag').notNull(),
    outboundIdTag: text('outbound_id_tag').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => ({
    proxyTargetIdx: index('proxy_tag_mappings_proxy_target_id_idx').on(table.proxyTargetId),
    proxyLocalUnique: uniqueIndex('proxy_tag_mappings_proxy_target_id_local_id_tag_unique').on(table.proxyTargetId, table.localIdTag)
  })
);

export const logs = sqliteTable('logs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
  level: text('level').notNull(),
  category: text('category').notNull().default('system'),
  message: text('message').notNull(),
  chargerId: text('charger_id'),
  transactionId: integer('transaction_id'),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const communicationJournal = sqliteTable(
  'communication_journal',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    direction: text('direction').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    chargerId: text('charger_id'),
    proxyTargetId: text('proxy_target_id'),
    messageType: text('message_type').notNull(),
    ocppMethod: text('ocpp_method'),
    transactionId: integer('transaction_id'),
    idTag: text('id_tag'),
    payloadJson: text('payload_json').notNull(),
    errorCode: text('error_code'),
    errorDescription: text('error_description'),
    correlationId: text('correlation_id')
  },
  (table) => ({
    createdAtIdx: index('communication_journal_created_at_idx').on(table.createdAt),
    createdAtIdIdx: index('communication_journal_created_at_id_idx').on(table.createdAt, table.id),
    sourceIdx: index('communication_journal_source_idx').on(table.sourceType, table.sourceId),
    sourceCreatedAtIdx: index('communication_journal_source_created_at_idx').on(table.sourceType, table.sourceId, table.createdAt, table.id),
    targetIdx: index('communication_journal_target_idx').on(table.targetType, table.targetId),
    targetCreatedAtIdx: index('communication_journal_target_created_at_idx').on(table.targetType, table.targetId, table.createdAt, table.id),
    chargerIdx: index('communication_journal_charger_id_idx').on(table.chargerId),
    chargerCreatedAtIdx: index('communication_journal_charger_created_at_idx').on(table.chargerId, table.createdAt, table.id),
    proxyTargetIdx: index('communication_journal_proxy_target_id_idx').on(table.proxyTargetId),
    proxyTargetCreatedAtIdx: index('communication_journal_proxy_target_created_at_idx').on(table.proxyTargetId, table.createdAt, table.id),
    methodIdx: index('communication_journal_ocpp_method_idx').on(table.ocppMethod),
    messageTypeIdx: index('communication_journal_message_type_idx').on(table.messageType),
    messageTypeCreatedAtIdx: index('communication_journal_message_type_created_at_idx').on(table.messageType, table.createdAt, table.id),
    transactionCreatedAtIdx: index('communication_journal_transaction_created_at_idx').on(table.transactionId, table.createdAt, table.id)
  })
);

export const chargerPairingSessions = sqliteTable(
  'charger_pairing_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    pairingCodeHash: text('pairing_code_hash').notNull(),
    basicAuthUsername: text('basic_auth_username'),
    basicAuthPasswordHash: text('basic_auth_password_hash'),
    chargerId: text('charger_id'),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' })
  },
  (table) => ({
    codeHashUnique: uniqueIndex('charger_pairing_sessions_code_hash_unique').on(table.pairingCodeHash),
    tenantIdx: index('charger_pairing_sessions_tenant_id_idx').on(table.tenantId)
  })
);
