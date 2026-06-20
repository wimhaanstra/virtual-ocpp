CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `username` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `revoked_at` integer
);

CREATE TABLE IF NOT EXISTS `tags` (
  `id` text PRIMARY KEY NOT NULL,
  `uuid` text NOT NULL,
  `label` text,
  `enabled` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `tags_uuid_unique` ON `tags` (`uuid`);

CREATE TABLE IF NOT EXISTS `charger_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `charger_id` text NOT NULL,
  `connected_at` integer NOT NULL,
  `disconnected_at` integer
);

CREATE TABLE IF NOT EXISTS `charging_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `charger_id` text NOT NULL,
  `connector_id` integer NOT NULL,
  `transaction_id` integer NOT NULL,
  `id_tag` text,
  `started_at` integer NOT NULL,
  `stopped_at` integer,
  `start_meter_wh` integer,
  `stop_meter_wh` integer,
  `stop_reason` text,
  `status` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `meter_samples` (
  `id` text PRIMARY KEY NOT NULL,
  `charger_id` text NOT NULL,
  `transaction_id` integer,
  `connector_id` integer NOT NULL,
  `sampled_at` integer NOT NULL,
  `value` text NOT NULL,
  `numeric_value` real,
  `normalized_value` real,
  `normalized_unit` text,
  `measurand` text,
  `unit` text,
  `context` text,
  `phase` text,
  `location` text,
  `format` text
);

CREATE TABLE IF NOT EXISTS `proxy_targets` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `url` text NOT NULL,
  `username` text,
  `station_id` text,
  `enabled` integer DEFAULT 1 NOT NULL,
  `mode` text NOT NULL,
  `outage_policy` text NOT NULL,
  `basic_auth_password` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `proxy_session_mappings` (
  `id` text PRIMARY KEY NOT NULL,
  `charger_id` text NOT NULL,
  `proxy_target_id` text NOT NULL,
  `local_transaction_id` integer NOT NULL,
  `external_transaction_id` integer NOT NULL,
  `created_at` integer NOT NULL,
  `stopped_at` integer
);

CREATE TABLE IF NOT EXISTS `logs` (
  `id` text PRIMARY KEY NOT NULL,
  `level` text NOT NULL,
  `category` text DEFAULT 'system' NOT NULL,
  `message` text NOT NULL,
  `charger_id` text,
  `transaction_id` integer,
  `metadata` text,
  `created_at` integer NOT NULL
);
