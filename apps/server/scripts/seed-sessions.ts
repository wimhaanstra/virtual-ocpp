import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyMigrations } from '../src/db/client.js';

type SeedOptions = {
  active: number;
  chargerId: string;
  cleanup: boolean;
  count: number;
  days: number;
  tagPrefix: string;
};

loadEnvFileFromKnownLocations();

const options = parseArgs(process.argv.slice(2));
const sqlitePath = process.env.DB_PATH ?? process.env.SQLITE_PATH ?? './data/virtual-ocpp.sqlite';
mkdirSync(dirname(sqlitePath), { recursive: true });

const db = new Database(sqlitePath);
applyMigrations(db);

try {
  if (options.cleanup) {
    cleanupSeedRows(db, options);
  } else {
    seedSessions(db, options);
  }
} finally {
  db.close();
}

function parseArgs(args: string[]): SeedOptions {
  const options: SeedOptions = {
    active: 5,
    chargerId: 'SEED-CHARGER',
    cleanup: false,
    count: 1000,
    days: 90,
    tagPrefix: 'SEED-TAG'
  };

  for (const arg of args) {
    const [key, rawValue = ''] = arg.split('=');
    if (key === '--cleanup') {
      options.cleanup = true;
      continue;
    }
    if (key === '--active') options.active = parseNonNegativeInt(rawValue, key);
    if (key === '--charger-id') options.chargerId = parseNonEmptyString(rawValue, key);
    if (key === '--count') options.count = parsePositiveInt(rawValue, key);
    if (key === '--days') options.days = parsePositiveInt(rawValue, key);
    if (key === '--tag-prefix') options.tagPrefix = parseNonEmptyString(rawValue, key);
  }

  if (options.active > options.count) {
    throw new Error('--active cannot be larger than --count');
  }

  return options;
}

function seedSessions(db: Database.Database, options: SeedOptions) {
  const now = new Date();
  const startWindowMs = options.days * 24 * 60 * 60 * 1000;
  const createdAt = now.getTime();
  const chargerUpsert = db.prepare(`
    INSERT INTO chargers (id, label, enabled, first_seen_at, last_seen_at, last_boot_at, charge_point_vendor, charge_point_model, firmware_version, created_at, updated_at)
    VALUES (@id, @label, 1, @firstSeenAt, @lastSeenAt, @lastBootAt, @vendor, @model, @firmware, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);
  const sessionInsert = db.prepare(`
    INSERT OR REPLACE INTO charging_sessions (
      id, charger_id, connector_id, transaction_id, id_tag, started_at, stopped_at, start_meter_wh, stop_meter_wh, stop_reason, status
    ) VALUES (
      @id, @chargerId, @connectorId, @transactionId, @idTag, @startedAt, @stoppedAt, @startMeterWh, @stopMeterWh, @stopReason, @status
    )
  `);
  const sampleInsert = db.prepare(`
    INSERT OR REPLACE INTO meter_samples (
      id, charger_id, transaction_id, connector_id, sampled_at, value, numeric_value, normalized_value, normalized_unit, measurand, unit, context, phase, location, format
    ) VALUES (
      @id, @chargerId, @transactionId, @connectorId, @sampledAt, @value, @numericValue, @normalizedValue, @normalizedUnit, @measurand, @unit, @context, @phase, @location, @format
    )
  `);

  const write = db.transaction(() => {
    chargerUpsert.run({
      id: options.chargerId,
      label: 'Seed charger',
      firstSeenAt: new Date(now.getTime() - startWindowMs).getTime(),
      lastSeenAt: now.getTime(),
      lastBootAt: now.getTime(),
      vendor: 'Virtual OCPP',
      model: 'Seed',
      firmware: 'seed',
      createdAt,
      updatedAt: createdAt
    });

    for (let index = 0; index < options.count; index += 1) {
      const isActive = index < options.active;
      const startedAt = new Date(now.getTime() - Math.floor((index / Math.max(1, options.count)) * startWindowMs));
      const durationMinutes = 20 + (index % 100);
      const stoppedAt = isActive ? null : new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
      const startMeterWh = 50_000 + index * 1_700;
      const energyWh = isActive ? null : 1_000 + (index % 46) * 250;
      const stopMeterWh = energyWh === null ? null : startMeterWh + energyWh;
      const connectorId = (index % 3) + 1;
      const transactionId = 9_000_000 + index;
      const idTag = `${options.tagPrefix}-${(index % 12) + 1}`;
      const sessionId = `seed-session-${options.chargerId}-${index}`;

      sessionInsert.run({
        id: sessionId,
        chargerId: options.chargerId,
        connectorId,
        transactionId,
        idTag,
        startedAt: startedAt.getTime(),
        stoppedAt: stoppedAt?.getTime() ?? null,
        startMeterWh,
        stopMeterWh,
        stopReason: stoppedAt ? (index % 4 === 0 ? 'EVDisconnected' : 'Local') : null,
        status: isActive ? 'active' : 'stopped'
      });

      if (isActive) {
        const latestMeterWh = startMeterWh + 600 + index * 50;
        sampleInsert.run({
          id: `seed-meter-sample-${options.chargerId}-${index}`,
          chargerId: options.chargerId,
          transactionId,
          connectorId,
          sampledAt: new Date(startedAt.getTime() + 10 * 60 * 1000).getTime(),
          value: String(latestMeterWh),
          numericValue: latestMeterWh,
          normalizedValue: latestMeterWh,
          normalizedUnit: 'Wh',
          measurand: 'Energy.Active.Import.Register',
          unit: 'Wh',
          context: 'Sample.Periodic',
          phase: null,
          location: null,
          format: null
        });
      }
    }
  });

  write();
  console.log(`Seeded ${options.count} sessions for ${options.chargerId} in ${sqlitePath}`);
}

function cleanupSeedRows(db: Database.Database, options: SeedOptions) {
  const cleanup = db.transaction(() => {
    const samples = db
      .prepare("DELETE FROM meter_samples WHERE charger_id = ? AND id LIKE 'seed-meter-sample-%'")
      .run(options.chargerId).changes;
    const sessions = db
      .prepare("DELETE FROM charging_sessions WHERE charger_id = ? AND id LIKE 'seed-session-%'")
      .run(options.chargerId).changes;
    return { samples, sessions };
  });
  const result = cleanup();
  console.log(`Deleted ${result.sessions} seed sessions and ${result.samples} seed meter samples for ${options.chargerId} from ${sqlitePath}`);
}

function parsePositiveInt(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInt(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}

function parseNonEmptyString(value: string, flag: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${flag} must not be empty`);
  return trimmed;
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
