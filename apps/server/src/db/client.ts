import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../config.js';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(config: Pick<AppConfig, 'sqlitePath'>) {
  const path = resolve(config.sqlitePath);
  mkdirSync(dirname(path), { recursive: true });

  const client = new Database(path);
  applyMigrations(client);
  return drizzle(client, { schema });
}

export function applyMigrations(client: Database.Database) {
  const migrationDir = fileURLToPath(new URL('../../drizzle', import.meta.url));
  for (const file of readdirSync(migrationDir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const migration = readFileSync(resolve(migrationDir, file), 'utf8');
    client.exec(migration);
  }
  ensureColumn(client, 'proxy_targets', 'charger_id', 'ALTER TABLE proxy_targets ADD COLUMN charger_id text');
  ensureColumn(client, 'meter_samples', 'numeric_value', 'ALTER TABLE meter_samples ADD COLUMN numeric_value real');
  ensureColumn(client, 'meter_samples', 'normalized_value', 'ALTER TABLE meter_samples ADD COLUMN normalized_value real');
  ensureColumn(client, 'meter_samples', 'normalized_unit', 'ALTER TABLE meter_samples ADD COLUMN normalized_unit text');
  ensureColumn(client, 'meter_samples', 'phase', 'ALTER TABLE meter_samples ADD COLUMN phase text');
  ensureColumn(client, 'meter_samples', 'location', 'ALTER TABLE meter_samples ADD COLUMN location text');
  ensureColumn(client, 'meter_samples', 'format', 'ALTER TABLE meter_samples ADD COLUMN format text');
  client.exec('CREATE INDEX IF NOT EXISTS proxy_targets_charger_id_idx ON proxy_targets (charger_id)');
  client.exec('CREATE INDEX IF NOT EXISTS meter_samples_session_idx ON meter_samples (charger_id, transaction_id, sampled_at)');
  client.exec('CREATE INDEX IF NOT EXISTS meter_samples_measurand_idx ON meter_samples (measurand)');
}

function ensureColumn(client: Database.Database, table: string, column: string, statement: string) {
  const columns = client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    client.exec(statement);
  }
}
