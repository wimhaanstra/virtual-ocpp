import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyMigrations } from '../src/db/client.js';

type DemoOptions = {
  chargerId: string;
  cleanup: boolean;
};

type DemoTag = {
  id: string;
  uuid: string;
  label: string;
  enabled: boolean;
};

type DemoProxyTarget = {
  id: string;
  name: string;
  url: string;
  username: string | null;
  stationId: string | null;
  enabled: boolean;
  mode: 'monitor-only' | 'deny-capable';
  outagePolicy: 'fail-open' | 'fail-closed';
  allowRecoverySubmissions: boolean;
  basicAuthPassword: string | null;
  mappings: Array<{ localIdTag: string; outboundIdTag: string }>;
};

type DemoSession = {
  id: string;
  connectorId: number;
  transactionId: number;
  idTag: string;
  startedAt: Date;
  stoppedAt: Date | null;
  startMeterWh: number;
  stopMeterWh: number | null;
  stopReason: string | null;
  status: 'active' | 'stopped';
  latestMeterWh?: number;
  latestPowerW?: number;
  latestCurrentA?: number;
  latestVoltageV?: number;
  latestTemperatureC?: number;
};

loadEnvFileFromKnownLocations();

const options = parseArgs(process.argv.slice(2));
const sqlitePath = process.env.DB_PATH ?? process.env.SQLITE_PATH ?? './data/virtual-ocpp.sqlite';
mkdirSync(dirname(sqlitePath), { recursive: true });

const db = new Database(sqlitePath);
applyMigrations(db);

try {
  if (options.cleanup) {
    cleanupDemoData(db, options);
  } else {
    seedDemoData(db, options);
  }
} finally {
  db.close();
}

function parseArgs(args: string[]): DemoOptions {
  const options: DemoOptions = {
    chargerId: 'HOME-DRIVEWAY-01',
    cleanup: false
  };

  for (const arg of args) {
    const [key, rawValue = ''] = arg.split('=');
    if (key === '--cleanup') {
      options.cleanup = true;
      continue;
    }
    if (key === '--charger-id') options.chargerId = parseNonEmptyString(rawValue, key);
  }

  return options;
}

function seedDemoData(db: Database.Database, options: DemoOptions) {
  const now = new Date();
  const firstSeenAt = minutesAgo(now, 18_240);
  const lastSeenAt = minutesAgo(now, 1);
  const connectedAt = minutesAgo(now, 95);
  const tags = buildDemoTags();
  const proxyTargets = buildDemoProxyTargets(tags);
  const sessions = buildDemoSessions(now, tags);

  const upsertCharger = db.prepare(`
    INSERT INTO chargers (
      id, label, enabled, first_seen_at, last_seen_at, last_boot_at, charge_point_vendor, charge_point_model, firmware_version, created_at, updated_at
    ) VALUES (
      @id, @label, 1, @firstSeenAt, @lastSeenAt, @lastBootAt, @vendor, @model, @firmware, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      enabled = excluded.enabled,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      last_boot_at = excluded.last_boot_at,
      charge_point_vendor = excluded.charge_point_vendor,
      charge_point_model = excluded.charge_point_model,
      firmware_version = excluded.firmware_version,
      updated_at = excluded.updated_at
  `);
  const upsertConnection = db.prepare(`
    INSERT INTO charger_connections (id, charger_id, connected_at, disconnected_at)
    VALUES (@id, @chargerId, @connectedAt, null)
    ON CONFLICT(id) DO UPDATE SET
      charger_id = excluded.charger_id,
      connected_at = excluded.connected_at,
      disconnected_at = null
  `);
  const upsertTag = db.prepare(`
    INSERT INTO tags (id, uuid, label, enabled, created_at)
    VALUES (@id, @uuid, @label, @enabled, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      uuid = excluded.uuid,
      label = excluded.label,
      enabled = excluded.enabled
  `);
  const upsertTagAccess = db.prepare(`
    INSERT INTO tag_charger_access (id, tag_id, charger_id, enabled, created_at, updated_at)
    VALUES (@id, @tagId, @chargerId, @enabled, @createdAt, @updatedAt)
    ON CONFLICT(tag_id, charger_id) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const upsertProxyTarget = db.prepare(`
    INSERT INTO proxy_targets (
      id, charger_id, name, url, username, station_id, enabled, mode, outage_policy, allow_recovery_submissions, basic_auth_password, created_at, updated_at
    ) VALUES (
      @id, @chargerId, @name, @url, @username, @stationId, @enabled, @mode, @outagePolicy, @allowRecoverySubmissions, @basicAuthPassword, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      charger_id = excluded.charger_id,
      name = excluded.name,
      url = excluded.url,
      username = excluded.username,
      station_id = excluded.station_id,
      enabled = excluded.enabled,
      mode = excluded.mode,
      outage_policy = excluded.outage_policy,
      allow_recovery_submissions = excluded.allow_recovery_submissions,
      basic_auth_password = excluded.basic_auth_password,
      updated_at = excluded.updated_at
  `);
  const insertProxyTagMapping = db.prepare(`
    INSERT OR REPLACE INTO proxy_tag_mappings (id, proxy_target_id, local_id_tag, outbound_id_tag, created_at, updated_at)
    VALUES (@id, @proxyTargetId, @localIdTag, @outboundIdTag, @createdAt, @updatedAt)
  `);
  const upsertSession = db.prepare(`
    INSERT OR REPLACE INTO charging_sessions (
      id, charger_id, connector_id, transaction_id, id_tag, started_at, stopped_at, start_meter_wh, stop_meter_wh, stop_reason, status
    ) VALUES (
      @id, @chargerId, @connectorId, @transactionId, @idTag, @startedAt, @stoppedAt, @startMeterWh, @stopMeterWh, @stopReason, @status
    )
  `);
  const insertMeterSample = db.prepare(`
    INSERT OR REPLACE INTO meter_samples (
      id, charger_id, transaction_id, connector_id, sampled_at, value, numeric_value, normalized_value, normalized_unit, measurand, unit, context, phase, location, format
    ) VALUES (
      @id, @chargerId, @transactionId, @connectorId, @sampledAt, @value, @numericValue, @normalizedValue, @normalizedUnit, @measurand, @unit, @context, @phase, @location, @format
    )
  `);
  const upsertProxySessionMapping = db.prepare(`
    INSERT OR REPLACE INTO proxy_session_mappings (
      id, charger_id, proxy_target_id, local_transaction_id, external_transaction_id, created_at, stopped_at
    ) VALUES (
      @id, @chargerId, @proxyTargetId, @localTransactionId, @externalTransactionId, @createdAt, @stoppedAt
    )
  `);
  const insertJournalEntry = db.prepare(`
    INSERT OR REPLACE INTO communication_journal (
      id, created_at, direction, source_type, source_id, target_type, target_id, charger_id, proxy_target_id, message_type, ocpp_method, transaction_id, id_tag, payload_json, error_code, error_description, correlation_id
    ) VALUES (
      @id, @createdAt, @direction, @sourceType, @sourceId, @targetType, @targetId, @chargerId, @proxyTargetId, @messageType, @ocppMethod, @transactionId, @idTag, @payloadJson, @errorCode, @errorDescription, @correlationId
    )
  `);

  const write = db.transaction(() => {
    cleanupDemoData(db, options, { silent: true });

    upsertCharger.run({
      id: options.chargerId,
      label: 'Home driveway charger',
      firstSeenAt: firstSeenAt.getTime(),
      lastSeenAt: lastSeenAt.getTime(),
      lastBootAt: connectedAt.getTime(),
      vendor: 'Alfen',
      model: 'Eve Single S-line',
      firmware: '7.6.3',
      createdAt: firstSeenAt.getTime(),
      updatedAt: now.getTime()
    });
    upsertConnection.run({
      id: demoId('connection', options.chargerId),
      chargerId: options.chargerId,
      connectedAt: connectedAt.getTime()
    });

    for (const tag of tags) {
      upsertTag.run({
        id: tag.id,
        uuid: tag.uuid,
        label: tag.label,
        enabled: tag.enabled ? 1 : 0,
        createdAt: firstSeenAt.getTime()
      });
      upsertTagAccess.run({
        id: demoId('tag-access', `${options.chargerId}-${tag.id}`),
        tagId: tag.id,
        chargerId: options.chargerId,
        enabled: tag.enabled ? 1 : 0,
        createdAt: firstSeenAt.getTime(),
        updatedAt: now.getTime()
      });
    }

    for (const target of proxyTargets) {
      upsertProxyTarget.run({
        id: target.id,
        chargerId: options.chargerId,
        name: target.name,
        url: target.url,
        username: target.username,
        stationId: target.stationId,
        enabled: target.enabled ? 1 : 0,
        mode: target.mode,
        outagePolicy: target.outagePolicy,
        allowRecoverySubmissions: target.allowRecoverySubmissions ? 1 : 0,
        basicAuthPassword: target.basicAuthPassword,
        createdAt: firstSeenAt.getTime(),
        updatedAt: now.getTime()
      });

      for (const [index, mapping] of target.mappings.entries()) {
        insertProxyTagMapping.run({
          id: demoId('proxy-tag-map', `${target.id}-${index}`),
          proxyTargetId: target.id,
          localIdTag: mapping.localIdTag,
          outboundIdTag: mapping.outboundIdTag,
          createdAt: firstSeenAt.getTime(),
          updatedAt: now.getTime()
        });
      }
    }

    for (const session of sessions) {
      upsertSession.run({
        id: session.id,
        chargerId: options.chargerId,
        connectorId: session.connectorId,
        transactionId: session.transactionId,
        idTag: session.idTag,
        startedAt: session.startedAt.getTime(),
        stoppedAt: session.stoppedAt?.getTime() ?? null,
        startMeterWh: session.startMeterWh,
        stopMeterWh: session.stopMeterWh,
        stopReason: session.stopReason,
        status: session.status
      });

      seedSessionSamples(insertMeterSample, options.chargerId, session);
    }

    const activeSession = sessions.find((session) => session.status === 'active');
    if (activeSession) {
      for (const [index, target] of proxyTargets.filter((target) => target.enabled).entries()) {
        upsertProxySessionMapping.run({
          id: demoId('proxy-session', `${target.id}-${activeSession.transactionId}`),
          chargerId: options.chargerId,
          proxyTargetId: target.id,
          localTransactionId: activeSession.transactionId,
          externalTransactionId: 70_100 + index,
          createdAt: activeSession.startedAt.getTime(),
          stoppedAt: null
        });
      }
    }

    seedCommunicationJournal(insertJournalEntry, options.chargerId, proxyTargets, sessions, now);
  });

  write();
  console.log(`Seeded demo charger ${options.chargerId} in ${sqlitePath}`);
  console.log('Created 1 connected charger, 3 proxy targets, 3 tags, 1 active session, and 12 stopped sessions.');
}

function cleanupDemoData(db: Database.Database, options: DemoOptions, config: { silent?: boolean } = {}) {
  const proxyTargetIds = db
    .prepare("SELECT id FROM proxy_targets WHERE charger_id = ? OR id LIKE 'demo-proxy-%'")
    .all(options.chargerId)
    .map((row) => (row as { id: string }).id);
  const tagIds = buildDemoTags().map((tag) => tag.id);
  const proxyTargetPlaceholders = proxyTargetIds.map(() => '?').join(', ');
  const tagPlaceholders = tagIds.map(() => '?').join(', ');

  const cleanup = db.transaction(() => {
    const communicationJournal = proxyTargetIds.length
      ? db
          .prepare(`DELETE FROM communication_journal WHERE charger_id = ? OR proxy_target_id IN (${proxyTargetPlaceholders}) OR id LIKE 'demo-journal-%'`)
          .run(options.chargerId, ...proxyTargetIds).changes
      : db.prepare("DELETE FROM communication_journal WHERE charger_id = ? OR id LIKE 'demo-journal-%'").run(options.chargerId).changes;
    const meterSamples = db
      .prepare("DELETE FROM meter_samples WHERE charger_id = ? OR id LIKE 'demo-meter-sample-%'")
      .run(options.chargerId).changes;
    const proxySessionMappings = db
      .prepare("DELETE FROM proxy_session_mappings WHERE charger_id = ? OR id LIKE 'demo-proxy-session-%'")
      .run(options.chargerId).changes;
    const chargingSessions = db
      .prepare("DELETE FROM charging_sessions WHERE charger_id = ? OR id LIKE 'demo-session-%'")
      .run(options.chargerId).changes;
    const proxyTagMappings = proxyTargetIds.length
      ? db
          .prepare(`DELETE FROM proxy_tag_mappings WHERE proxy_target_id IN (${proxyTargetPlaceholders}) OR id LIKE 'demo-proxy-tag-map-%'`)
          .run(...proxyTargetIds).changes
      : db.prepare("DELETE FROM proxy_tag_mappings WHERE id LIKE 'demo-proxy-tag-map-%'").run().changes;
    const proxyTargets = db
      .prepare("DELETE FROM proxy_targets WHERE charger_id = ? OR id LIKE 'demo-proxy-%'")
      .run(options.chargerId).changes;
    const tagChargerAccess = db
      .prepare("DELETE FROM tag_charger_access WHERE charger_id = ? OR id LIKE 'demo-tag-access-%'")
      .run(options.chargerId).changes;
    const tags = tagIds.length
      ? db.prepare(`DELETE FROM tags WHERE id IN (${tagPlaceholders})`).run(...tagIds).changes
      : 0;
    const chargerConnections = db
      .prepare("DELETE FROM charger_connections WHERE charger_id = ? OR id LIKE 'demo-connection-%'")
      .run(options.chargerId).changes;
    const chargers = db.prepare("DELETE FROM chargers WHERE id = ?").run(options.chargerId).changes;

    return {
      chargers,
      chargerConnections,
      chargingSessions,
      communicationJournal,
      meterSamples,
      proxySessionMappings,
      proxyTagMappings,
      proxyTargets,
      tagChargerAccess,
      tags
    };
  });

  const result = cleanup();
  if (!config.silent) {
    console.log(`Deleted demo data for ${options.chargerId} from ${sqlitePath}`);
    console.log(result);
  }
}

function buildDemoTags(): DemoTag[] {
  return [
    { id: 'demo-tag-family', uuid: 'FAMILY-RFID-1842', label: 'Family RFID', enabled: true },
    { id: 'demo-tag-guest', uuid: 'GUEST-RFID-0297', label: 'Guest card', enabled: true },
    { id: 'demo-tag-service', uuid: 'SERVICE-RFID-4410', label: 'Service card', enabled: false }
  ];
}

function buildDemoProxyTargets(tags: DemoTag[]): DemoProxyTarget[] {
  const [familyTag, guestTag] = tags;
  return [
    {
      id: 'demo-proxy-utility-roaming',
      name: 'Utility roaming',
      url: 'wss://ocpp.utility.example/ws',
      username: 'home-driveway-01',
      stationId: 'NL*SBX*E1842',
      enabled: true,
      mode: 'deny-capable',
      outagePolicy: 'fail-open',
      allowRecoverySubmissions: true,
      basicAuthPassword: 'demo-password',
      mappings: [
        { localIdTag: familyTag.uuid, outboundIdTag: 'UTILITY-FAMILY-1842' },
        { localIdTag: guestTag.uuid, outboundIdTag: 'UTILITY-GUEST-0297' }
      ]
    },
    {
      id: 'demo-proxy-fleet-reporting',
      name: 'Fleet reporting',
      url: 'wss://fleet.example.net/ocpp',
      username: null,
      stationId: 'HOME-DRIVEWAY-FLEET',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      allowRecoverySubmissions: false,
      basicAuthPassword: null,
      mappings: [{ localIdTag: familyTag.uuid, outboundIdTag: 'DRIVER-HOME-01' }]
    },
    {
      id: 'demo-proxy-billing-sandbox',
      name: 'Billing sandbox',
      url: 'wss://billing.example.org/charge-points',
      username: 'sandbox-operator',
      stationId: null,
      enabled: false,
      mode: 'monitor-only',
      outagePolicy: 'fail-closed',
      allowRecoverySubmissions: false,
      basicAuthPassword: 'demo-password',
      mappings: []
    }
  ];
}

function buildDemoSessions(now: Date, tags: DemoTag[]): DemoSession[] {
  const [familyTag, guestTag] = tags;
  const activeStartedAt = minutesAgo(now, 42);
  const activeStartMeterWh = 482_120;
  const activeLatestMeterWh = activeStartMeterWh + 15_400;
  const sessions: DemoSession[] = [
    {
      id: 'demo-session-active-home-driveway',
      connectorId: 1,
      transactionId: 62_184,
      idTag: familyTag.uuid,
      startedAt: activeStartedAt,
      stoppedAt: null,
      startMeterWh: activeStartMeterWh,
      stopMeterWh: null,
      stopReason: null,
      status: 'active',
      latestMeterWh: activeLatestMeterWh,
      latestPowerW: 22_000,
      latestCurrentA: 32,
      latestVoltageV: 230,
      latestTemperatureC: 36.4
    }
  ];

  const stoppedSessions = [
    { ageHours: 7, durationMinutes: 86, energyWh: 28_600, tag: familyTag.uuid, reason: 'Local' },
    { ageHours: 31, durationMinutes: 52, energyWh: 17_900, tag: guestTag.uuid, reason: 'EVDisconnected' },
    { ageHours: 54, durationMinutes: 121, energyWh: 41_200, tag: familyTag.uuid, reason: 'Local' },
    { ageHours: 78, durationMinutes: 39, energyWh: 9_800, tag: familyTag.uuid, reason: 'PowerLoss' },
    { ageHours: 105, durationMinutes: 74, energyWh: 23_400, tag: guestTag.uuid, reason: 'Local' },
    { ageHours: 128, durationMinutes: 112, energyWh: 36_500, tag: familyTag.uuid, reason: 'EVDisconnected' },
    { ageHours: 153, durationMinutes: 45, energyWh: 12_100, tag: familyTag.uuid, reason: 'Local' },
    { ageHours: 179, durationMinutes: 96, energyWh: 30_700, tag: guestTag.uuid, reason: 'EVDisconnected' },
    { ageHours: 206, durationMinutes: 66, energyWh: 20_300, tag: familyTag.uuid, reason: 'Local' },
    { ageHours: 233, durationMinutes: 103, energyWh: 33_900, tag: familyTag.uuid, reason: 'Local' },
    { ageHours: 260, durationMinutes: 48, energyWh: 14_500, tag: guestTag.uuid, reason: 'EVDisconnected' },
    { ageHours: 287, durationMinutes: 89, energyWh: 27_800, tag: familyTag.uuid, reason: 'Local' }
  ];

  stoppedSessions.forEach((entry, index) => {
    const stoppedAt = hoursAgo(now, entry.ageHours);
    const startedAt = new Date(stoppedAt.getTime() - entry.durationMinutes * 60 * 1000);
    const startMeterWh = 401_000 + index * 6_300;
    sessions.push({
      id: `demo-session-stopped-${String(index + 1).padStart(2, '0')}`,
      connectorId: index % 3 === 0 ? 2 : 1,
      transactionId: 62_183 - index,
      idTag: entry.tag,
      startedAt,
      stoppedAt,
      startMeterWh,
      stopMeterWh: startMeterWh + entry.energyWh,
      stopReason: entry.reason,
      status: 'stopped'
    });
  });

  return sessions;
}

function seedSessionSamples(insertMeterSample: Database.Statement, chargerId: string, session: DemoSession) {
  if (session.status === 'active') {
    const sampledAt = minutesAgo(new Date(), 1);
    insertSample(insertMeterSample, {
      id: `${session.id}-energy`,
      chargerId,
      session,
      sampledAt,
      value: session.latestMeterWh ?? session.startMeterWh,
      measurand: 'Energy.Active.Import.Register',
      unit: 'Wh',
      normalizedUnit: 'Wh'
    });
    insertSample(insertMeterSample, {
      id: `${session.id}-power`,
      chargerId,
      session,
      sampledAt,
      value: session.latestPowerW ?? 0,
      measurand: 'Power.Active.Import',
      unit: 'W',
      normalizedUnit: 'W'
    });
    insertSample(insertMeterSample, {
      id: `${session.id}-current`,
      chargerId,
      session,
      sampledAt,
      value: session.latestCurrentA ?? 0,
      measurand: 'Current.Import',
      unit: 'A',
      normalizedUnit: 'A'
    });
    insertSample(insertMeterSample, {
      id: `${session.id}-voltage`,
      chargerId,
      session,
      sampledAt,
      value: session.latestVoltageV ?? 0,
      measurand: 'Voltage',
      unit: 'V',
      normalizedUnit: 'V'
    });
    insertSample(insertMeterSample, {
      id: `${session.id}-temperature`,
      chargerId,
      session,
      sampledAt,
      value: session.latestTemperatureC ?? 0,
      measurand: 'Temperature',
      unit: 'Celsius',
      normalizedUnit: 'C'
    });

    for (const [phase, value] of Object.entries({ L1: 31.8, L2: 32.1, L3: 31.9 })) {
      insertSample(insertMeterSample, {
        id: `${session.id}-current-${phase}`,
        chargerId,
        session,
        sampledAt,
        value,
        measurand: 'Current.Import',
        unit: 'A',
        normalizedUnit: 'A',
        phase
      });
    }
    return;
  }

  if (!session.stoppedAt || session.stopMeterWh === null) return;
  insertSample(insertMeterSample, {
    id: `${session.id}-energy`,
    chargerId,
    session,
    sampledAt: minutesBefore(session.stoppedAt, 1),
    value: session.stopMeterWh,
    measurand: 'Energy.Active.Import.Register',
    unit: 'Wh',
    normalizedUnit: 'Wh'
  });
}

function insertSample(
  insertMeterSample: Database.Statement,
  input: {
    id: string;
    chargerId: string;
    session: DemoSession;
    sampledAt: Date;
    value: number;
    measurand: string;
    unit: string;
    normalizedUnit: string;
    phase?: string;
  }
) {
  insertMeterSample.run({
    id: demoId('meter-sample', input.id),
    chargerId: input.chargerId,
    transactionId: input.session.transactionId,
    connectorId: input.session.connectorId,
    sampledAt: input.sampledAt.getTime(),
    value: String(input.value),
    numericValue: input.value,
    normalizedValue: input.value,
    normalizedUnit: input.normalizedUnit,
    measurand: input.measurand,
    unit: input.unit,
    context: 'Sample.Periodic',
    phase: input.phase ?? null,
    location: 'Outlet',
    format: null
  });
}

function seedCommunicationJournal(
  insertJournalEntry: Database.Statement,
  chargerId: string,
  proxyTargets: DemoProxyTarget[],
  sessions: DemoSession[],
  now: Date
) {
  const activeSession = sessions.find((session) => session.status === 'active');
  if (!activeSession) return;

  insertJournalEntry.run({
    id: demoId('journal', 'boot-notification'),
    createdAt: minutesAgo(now, 95).getTime(),
    direction: 'inbound',
    sourceType: 'charger',
    sourceId: chargerId,
    targetType: 'virtual-ocpp',
    targetId: 'local-primary',
    chargerId,
    proxyTargetId: null,
    messageType: 'CALL',
    ocppMethod: 'BootNotification',
    transactionId: null,
    idTag: null,
    payloadJson: JSON.stringify({
      chargePointVendor: 'Alfen',
      chargePointModel: 'Eve Single S-line',
      firmwareVersion: '7.6.3'
    }),
    errorCode: null,
    errorDescription: null,
    correlationId: 'demo-boot-001'
  });

  insertJournalEntry.run({
    id: demoId('journal', 'meter-values'),
    createdAt: minutesAgo(now, 1).getTime(),
    direction: 'inbound',
    sourceType: 'charger',
    sourceId: chargerId,
    targetType: 'virtual-ocpp',
    targetId: 'local-primary',
    chargerId,
    proxyTargetId: null,
    messageType: 'CALL',
    ocppMethod: 'MeterValues',
    transactionId: activeSession.transactionId,
    idTag: activeSession.idTag,
    payloadJson: JSON.stringify({
      connectorId: activeSession.connectorId,
      transactionId: activeSession.transactionId,
      meterValue: [
        {
          timestamp: minutesAgo(now, 1).toISOString(),
          sampledValue: [
            { value: String(activeSession.latestMeterWh), measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
            { value: String(activeSession.latestPowerW), measurand: 'Power.Active.Import', unit: 'W' }
          ]
        }
      ]
    }),
    errorCode: null,
    errorDescription: null,
    correlationId: 'demo-meter-001'
  });

  for (const [index, target] of proxyTargets.filter((target) => target.enabled).entries()) {
    insertJournalEntry.run({
      id: demoId('journal', `proxy-${target.id}`),
      createdAt: minutesAgo(now, index + 1).getTime(),
      direction: 'outbound',
      sourceType: 'virtual-ocpp',
      sourceId: 'local-primary',
      targetType: 'proxy',
      targetId: target.id,
      chargerId,
      proxyTargetId: target.id,
      messageType: 'CALL',
      ocppMethod: 'MeterValues',
      transactionId: activeSession.transactionId,
      idTag: activeSession.idTag,
      payloadJson: JSON.stringify({
        upstreamIdentity: target.stationId ?? chargerId,
        connectorId: activeSession.connectorId,
        transactionId: 70_100 + index
      }),
      errorCode: null,
      errorDescription: null,
      correlationId: `demo-proxy-meter-${index + 1}`
    });
  }
}

function demoId(scope: string, value: string) {
  return `demo-${scope}-${value}`.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase();
}

function minutesAgo(now: Date, minutes: number) {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

function minutesBefore(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

function hoursAgo(now: Date, hours: number) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
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
