import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyMigrations } from '../src/db/client.js';

loadEnvFileFromKnownLocations();

const sqlitePath = process.env.DB_PATH ?? process.env.SQLITE_PATH ?? './data/virtual-ocpp.sqlite';
mkdirSync(dirname(sqlitePath), { recursive: true });

const db = new Database(sqlitePath);
applyMigrations(db);
ensureColumn(db, 'logs', 'category', "ALTER TABLE logs ADD COLUMN category text NOT NULL DEFAULT 'system'");
ensureColumn(db, 'logs', 'charger_id', 'ALTER TABLE logs ADD COLUMN charger_id text');
ensureColumn(db, 'logs', 'transaction_id', 'ALTER TABLE logs ADD COLUMN transaction_id integer');
ensureColumn(db, 'logs', 'metadata', 'ALTER TABLE logs ADD COLUMN metadata text');
ensureColumn(db, 'proxy_targets', 'username', 'ALTER TABLE proxy_targets ADD COLUMN username text');
ensureColumn(db, 'proxy_targets', 'station_id', 'ALTER TABLE proxy_targets ADD COLUMN station_id text');
db.close();

console.log(`Applied initial migration to ${sqlitePath}`);

function ensureColumn(db: Database.Database, table: string, column: string, statement: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(statement);
  }
}

function loadEnvFileFromKnownLocations() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(process.cwd(), '..', '..', '.env')
  ];

  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (envPath) {
    process.loadEnvFile(envPath);
  }
}
