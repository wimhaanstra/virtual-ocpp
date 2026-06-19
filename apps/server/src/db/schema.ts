import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
});

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  uuid: text('uuid').notNull().unique(),
  label: text('label'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const chargers = sqliteTable('chargers', {
  id: text('id').primaryKey(),
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
  chargerId: text('charger_id').notNull(),
  connectedAt: integer('connected_at', { mode: 'timestamp_ms' }).notNull(),
  disconnectedAt: integer('disconnected_at', { mode: 'timestamp_ms' })
});

export const chargingSessions = sqliteTable('charging_sessions', {
  id: text('id').primaryKey(),
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

export const meterSamples = sqliteTable('meter_samples', {
  id: text('id').primaryKey(),
  chargerId: text('charger_id').notNull(),
  transactionId: integer('transaction_id'),
  connectorId: integer('connector_id').notNull(),
  sampledAt: integer('sampled_at', { mode: 'timestamp_ms' }).notNull(),
  value: text('value').notNull(),
  measurand: text('measurand'),
  unit: text('unit'),
  context: text('context')
});

export const proxyTargets = sqliteTable('proxy_targets', {
  id: text('id').primaryKey(),
  chargerId: text('charger_id'),
  name: text('name').notNull(),
  url: text('url').notNull(),
  username: text('username'),
  stationId: text('station_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  mode: text('mode').notNull(),
  outagePolicy: text('outage_policy').notNull(),
  basicAuthPassword: text('basic_auth_password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const chargerProxyAssignments = sqliteTable(
  'charger_proxy_assignments',
  {
    id: text('id').primaryKey(),
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
  chargerId: text('charger_id').notNull(),
  proxyTargetId: text('proxy_target_id').notNull(),
  localTransactionId: integer('local_transaction_id').notNull(),
  externalTransactionId: integer('external_transaction_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  stoppedAt: integer('stopped_at', { mode: 'timestamp_ms' })
});

export const logs = sqliteTable('logs', {
  id: text('id').primaryKey(),
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
    sourceIdx: index('communication_journal_source_idx').on(table.sourceType, table.sourceId),
    targetIdx: index('communication_journal_target_idx').on(table.targetType, table.targetId),
    chargerIdx: index('communication_journal_charger_id_idx').on(table.chargerId),
    proxyTargetIdx: index('communication_journal_proxy_target_id_idx').on(table.proxyTargetId),
    methodIdx: index('communication_journal_ocpp_method_idx').on(table.ocppMethod),
    messageTypeIdx: index('communication_journal_message_type_idx').on(table.messageType)
  })
);
