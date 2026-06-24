import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../../src/config.js';
import * as schema from '../../src/db/schema.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8797,
    host: '127.0.0.1',
    sqlitePath: `./data/test-${randomUUID()}.sqlite`,
    sessionSecret: 'test-session-secret-with-enough-length',
    adminUsername: 'admin',
    adminPassword: 'correct-password',
    ocppBasicAuthPassword: undefined,
    communicationLogRetentionHours: 24,
    chargerSilentAfterSeconds: 300,
    meterGapThresholdWh: 1000,
    ...overrides
  };
}

export function createTestDatabase() {
  const dir = join(tmpdir(), 'virtual-ocpp-tests');
  mkdirSync(dir, { recursive: true });
  const sqlitePath = join(dir, `test-${randomUUID()}.sqlite`);
  const sqlite = new Database(sqlitePath);

  sqlite.exec(`
    CREATE TABLE sessions (
      id text PRIMARY KEY NOT NULL,
      username text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer NOT NULL,
      revoked_at integer
    );

    CREATE TABLE onboarding_settings (
      id text PRIMARY KEY NOT NULL,
      completed_at integer,
      skipped_at integer
    );

    CREATE TABLE tags (
      id text PRIMARY KEY NOT NULL,
      uuid text NOT NULL UNIQUE,
      label text,
      enabled integer NOT NULL DEFAULT 1,
      created_at integer NOT NULL
    );

    CREATE TABLE chargers (
      id text PRIMARY KEY NOT NULL,
      label text,
      enabled integer NOT NULL DEFAULT 1,
      first_seen_at integer NOT NULL,
      last_seen_at integer NOT NULL,
      last_boot_at integer,
      charge_point_vendor text,
      charge_point_model text,
      firmware_version text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE tag_charger_access (
      id text PRIMARY KEY NOT NULL,
      tag_id text NOT NULL,
      charger_id text NOT NULL,
      enabled integer NOT NULL DEFAULT 1,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX tag_charger_access_tag_id_charger_id_unique
      ON tag_charger_access (tag_id, charger_id);

    CREATE INDEX tag_charger_access_tag_id_idx ON tag_charger_access (tag_id);

    CREATE INDEX tag_charger_access_charger_id_idx ON tag_charger_access (charger_id);

    CREATE TABLE charger_connections (
      id text PRIMARY KEY NOT NULL,
      charger_id text NOT NULL,
      connected_at integer NOT NULL,
      disconnected_at integer
    );

    CREATE TABLE charging_sessions (
      id text PRIMARY KEY NOT NULL,
      charger_id text NOT NULL,
      connector_id integer NOT NULL,
      transaction_id integer NOT NULL,
      id_tag text,
      started_at integer NOT NULL,
      stopped_at integer,
      start_meter_wh integer,
      stop_meter_wh integer,
      stop_reason text,
      status text NOT NULL
    );

    CREATE TABLE meter_samples (
      id text PRIMARY KEY NOT NULL,
      charger_id text NOT NULL,
      transaction_id integer,
      connector_id integer NOT NULL,
      sampled_at integer NOT NULL,
      value text NOT NULL,
      numeric_value real,
      normalized_value real,
      normalized_unit text,
      measurand text,
      unit text,
      context text,
      phase text,
      location text,
      format text
    );

    CREATE INDEX meter_samples_session_idx ON meter_samples (charger_id, transaction_id, sampled_at);

    CREATE INDEX meter_samples_measurand_idx ON meter_samples (measurand);

    CREATE TABLE meter_gap_events (
      id text PRIMARY KEY NOT NULL,
      charger_id text NOT NULL,
      connector_id integer NOT NULL,
      previous_session_id text,
      new_session_id text NOT NULL,
      previous_stopped_at integer,
      new_started_at integer NOT NULL,
      previous_meter_wh integer NOT NULL,
      new_meter_start_wh integer NOT NULL,
      delta_wh integer NOT NULL,
      threshold_wh integer NOT NULL,
      status text NOT NULL,
      submission_result_json text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE INDEX meter_gap_events_charger_id_idx ON meter_gap_events (charger_id);

    CREATE INDEX meter_gap_events_status_idx ON meter_gap_events (status);

    CREATE TABLE proxy_targets (
      id text PRIMARY KEY NOT NULL,
      charger_id text,
      name text NOT NULL,
      url text NOT NULL,
      username text,
      station_id text,
      enabled integer NOT NULL DEFAULT 1,
      mode text NOT NULL,
      outage_policy text NOT NULL,
      allow_recovery_submissions integer NOT NULL DEFAULT 0,
      basic_auth_password text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE INDEX proxy_targets_charger_id_idx ON proxy_targets (charger_id);

    CREATE TABLE charger_proxy_assignments (
      id text PRIMARY KEY NOT NULL,
      charger_id text NOT NULL,
      proxy_target_id text NOT NULL,
      enabled integer NOT NULL DEFAULT 1,
      station_id text,
      mode text NOT NULL,
      outage_policy text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX charger_proxy_assignments_charger_id_proxy_target_id_unique
      ON charger_proxy_assignments (charger_id, proxy_target_id);

    CREATE INDEX charger_proxy_assignments_charger_id_idx ON charger_proxy_assignments (charger_id);

    CREATE INDEX charger_proxy_assignments_proxy_target_id_idx ON charger_proxy_assignments (proxy_target_id);

    CREATE TABLE proxy_session_mappings (
      id text PRIMARY KEY NOT NULL,
      charger_id text NOT NULL,
      proxy_target_id text NOT NULL,
      local_transaction_id integer NOT NULL,
      external_transaction_id integer NOT NULL,
      created_at integer NOT NULL,
      stopped_at integer
    );

    CREATE TABLE proxy_tag_mappings (
      id text PRIMARY KEY NOT NULL,
      proxy_target_id text NOT NULL,
      local_id_tag text NOT NULL,
      outbound_id_tag text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE INDEX proxy_tag_mappings_proxy_target_id_idx ON proxy_tag_mappings (proxy_target_id);

    CREATE UNIQUE INDEX proxy_tag_mappings_proxy_target_id_local_id_tag_unique
      ON proxy_tag_mappings (proxy_target_id, local_id_tag);

    CREATE TABLE logs (
      id text PRIMARY KEY NOT NULL,
      level text NOT NULL,
      category text NOT NULL DEFAULT 'system',
      message text NOT NULL,
      charger_id text,
      transaction_id integer,
      metadata text,
      created_at integer NOT NULL
    );

    CREATE TABLE communication_journal (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      direction text NOT NULL,
      source_type text NOT NULL,
      source_id text NOT NULL,
      target_type text NOT NULL,
      target_id text NOT NULL,
      charger_id text,
      proxy_target_id text,
      message_type text NOT NULL,
      ocpp_method text,
      transaction_id integer,
      id_tag text,
      payload_json text NOT NULL,
      error_code text,
      error_description text,
      correlation_id text
    );

    CREATE INDEX communication_journal_created_at_idx ON communication_journal (created_at);
    CREATE INDEX communication_journal_source_idx ON communication_journal (source_type, source_id);
    CREATE INDEX communication_journal_target_idx ON communication_journal (target_type, target_id);
    CREATE INDEX communication_journal_charger_id_idx ON communication_journal (charger_id);
    CREATE INDEX communication_journal_proxy_target_id_idx ON communication_journal (proxy_target_id);
    CREATE INDEX communication_journal_ocpp_method_idx ON communication_journal (ocpp_method);
    CREATE INDEX communication_journal_message_type_idx ON communication_journal (message_type);
  `);

  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    close: () => sqlite.close()
  };
}
