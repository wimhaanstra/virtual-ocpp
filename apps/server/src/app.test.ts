import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { applyMigrations } from './db/client.js';
import {
  chargerConnections,
  chargers,
  chargingSessions,
  logs,
  meterSamples,
  proxySessionMappings,
  proxyTargets,
  sessions,
  tagChargerAccess,
  tags
} from './db/schema.js';
import { OcppRepository } from './ocpp/repository.js';
import { createTestDatabase, testConfig } from './test-utils.js';

describe('app', () => {
  let closeDb: (() => void) | undefined;

  afterEach(() => {
    closeDb?.();
    closeDb = undefined;
  });

  it('returns health status', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await app.close();
  });

  it('accepts the configured login credentials', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'admin',
        password: 'correct-password'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      username: 'admin'
    });
    expect(response.headers['set-cookie']).toBeDefined();
    expect(tempDb.db.select().from(sessions).all()).toHaveLength(1);
    expect(tempDb.db.select().from(logs).all()).toHaveLength(0);

    await app.close();
  });

  it('requires authentication for operator routes', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });

    const routes = [
      '/api/chargers',
      '/api/proxy-targets?chargerId=CHARGER-1',
      '/api/tags',
      '/api/charger-connections',
      '/api/sessions',
      '/api/charging-stats',
      '/api/logs',
      '/api/communication-journal'
    ];

    for (const url of routes) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }

    await app.close();
  });

  it('creates, lists, masks, and deletes charger-scoped proxy targets', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargers).values({
      id: 'CHARGER-PROXY',
      label: 'Proxy charger',
      enabled: true,
      firstSeenAt: new Date('2026-06-19T09:00:00.000Z'),
      lastSeenAt: new Date('2026-06-19T09:00:00.000Z'),
      lastBootAt: new Date('2026-06-19T09:01:00.000Z'),
      chargePointVendor: 'Vendor',
      chargePointModel: 'Model',
      firmwareVersion: '1.0.0',
      createdAt: new Date('2026-06-19T09:00:00.000Z'),
      updatedAt: new Date('2026-06-19T09:00:00.000Z')
    }).run();

    const created = await app.inject({
      method: 'POST',
      url: '/api/proxy-targets',
      headers: { cookie },
      payload: {
        chargerId: 'CHARGER-PROXY',
        name: 'Remote CSMS',
        url: 'ws://127.0.0.1:9000/ocpp',
        username: 'remote-user',
        stationId: 'REMOTE-STATION-1',
        enabled: true,
        mode: 'deny-capable',
        outagePolicy: 'fail-closed',
        basicAuthPassword: 'target-secret'
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      chargerId: 'CHARGER-PROXY',
      name: 'Remote CSMS',
      url: 'ws://127.0.0.1:9000/ocpp',
      hasUsername: true,
      stationId: 'REMOTE-STATION-1',
      enabled: true,
      mode: 'deny-capable',
      outagePolicy: 'fail-closed',
      hasBasicAuthPassword: true
    });
    expect(created.body).not.toContain('target-secret');
    expect(created.body).not.toContain('remote-user');

    const targetId = created.json().id as string;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/proxy-targets?chargerId=CHARGER-PROXY',
      headers: { cookie }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.body).not.toContain('target-secret');
    expect(listed.body).not.toContain('remote-user');

    tempDb.db.insert(proxySessionMappings).values({
      id: 'active-mapping',
      chargerId: 'CHARGER-PROXY',
      proxyTargetId: targetId,
      localTransactionId: 10,
      externalTransactionId: 20,
      createdAt: new Date()
    }).run();

    const blockedDelete = await app.inject({
      method: 'DELETE',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie }
    });
    expect(blockedDelete.statusCode).toBe(409);

    const blockedUrlEdit = await app.inject({
      method: 'PATCH',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie },
      payload: {
        url: 'ws://127.0.0.1:9001/ocpp'
      }
    });
    expect(blockedUrlEdit.statusCode).toBe(409);

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie },
      payload: {
        enabled: false
      }
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ enabled: false });
    expect(
      tempDb.db
        .select()
        .from(proxySessionMappings)
        .where(eq(proxySessionMappings.id, 'active-mapping'))
        .get()?.stoppedAt
    ).toBeInstanceOf(Date);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie }
    });
    expect(deleted.statusCode).toBe(200);
    expect(tempDb.db.select().from(proxyTargets).all()).toHaveLength(0);

    await app.close();
  });

  it('creates and revokes charger-specific tag access', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargers).values({
      id: 'CHARGER-TAGS',
      enabled: true,
      firstSeenAt: new Date('2026-06-19T09:00:00.000Z'),
      lastSeenAt: new Date('2026-06-19T09:00:00.000Z'),
      createdAt: new Date('2026-06-19T09:00:00.000Z'),
      updatedAt: new Date('2026-06-19T09:00:00.000Z')
    }).run();

    const created = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: { cookie },
      payload: {
        uuid: 'TAG-001',
        label: 'Main RFID',
        enabled: true
      }
    });
    expect(created.statusCode).toBe(201);
    const tagId = created.json().id as string;

    const granted = await app.inject({
      method: 'PUT',
      url: `/api/tags/${tagId}/chargers/CHARGER-TAGS`,
      headers: { cookie },
      payload: {
        enabled: true
      }
    });
    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({
      tagId,
      chargerId: 'CHARGER-TAGS',
      enabled: true
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/tags',
      headers: { cookie }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()[0]).toMatchObject({
      id: tagId,
      chargerAccess: [
        {
          chargerId: 'CHARGER-TAGS',
          enabled: true
        }
      ]
    });

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/tags/${tagId}/chargers/CHARGER-TAGS`,
      headers: { cookie }
    });
    expect(revoked.statusCode).toBe(200);
    expect(tempDb.db.select().from(tagChargerAccess).all()).toHaveLength(0);

    await app.close();
  });

  it('returns secret-free charger registry and filtered visibility data', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargers).values([
      {
        id: 'CHARGER-OLD',
        label: 'Old charger',
        enabled: true,
        firstSeenAt: new Date('2026-06-19T08:00:00.000Z'),
        lastSeenAt: new Date('2026-06-19T08:30:00.000Z'),
        lastBootAt: new Date('2026-06-19T08:01:00.000Z'),
        chargePointVendor: 'Vendor A',
        chargePointModel: 'Model A',
        firmwareVersion: '1.0.0',
        createdAt: new Date('2026-06-19T08:00:00.000Z'),
        updatedAt: new Date('2026-06-19T08:30:00.000Z')
      },
      {
        id: 'CHARGER-ACTIVE',
        label: 'Active charger',
        enabled: true,
        firstSeenAt: new Date('2026-06-19T09:00:00.000Z'),
        lastSeenAt: new Date('2026-06-19T09:05:00.000Z'),
        lastBootAt: new Date('2026-06-19T09:01:00.000Z'),
        chargePointVendor: 'Vendor B',
        chargePointModel: 'Model B',
        firmwareVersion: '2.0.0',
        createdAt: new Date('2026-06-19T09:00:00.000Z'),
        updatedAt: new Date('2026-06-19T09:05:00.000Z')
      }
    ]).run();

    tempDb.db.insert(chargerConnections).values([
      {
        id: 'connection-old',
        chargerId: 'CHARGER-OLD',
        connectedAt: new Date('2026-06-19T08:00:00.000Z'),
        disconnectedAt: new Date('2026-06-19T08:30:00.000Z')
      },
      {
        id: 'connection-active',
        chargerId: 'CHARGER-ACTIVE',
        connectedAt: new Date('2026-06-19T09:00:00.000Z'),
        disconnectedAt: null
      }
    ]).run();

    tempDb.db.insert(chargingSessions).values([
      {
        id: 'session-active',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        idTag: 'ACTIVE-TAG',
        startedAt: new Date('2026-06-19T09:05:00.000Z'),
        stoppedAt: null,
        startMeterWh: 3000,
        stopMeterWh: null,
        stopReason: null,
        status: 'active'
      }
    ]).run();

    tempDb.db.insert(meterSamples).values([
      {
        id: 'sample-energy',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        sampledAt: new Date('2026-06-19T09:10:00.000Z'),
        value: '3.75',
        numericValue: 3.75,
        normalizedValue: 3750,
        normalizedUnit: 'Wh',
        measurand: 'Energy.Active.Import.Register',
        unit: 'kWh',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'sample-power',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        sampledAt: new Date('2026-06-19T09:10:00.000Z'),
        value: '7.2',
        numericValue: 7.2,
        normalizedValue: 7200,
        normalizedUnit: 'W',
        measurand: 'Power.Active.Import',
        unit: 'kW',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'sample-current',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        sampledAt: new Date('2026-06-19T09:10:00.000Z'),
        value: '31.3',
        numericValue: 31.3,
        normalizedValue: 31.3,
        normalizedUnit: 'A',
        measurand: 'Current.Import',
        unit: 'A',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'sample-current-phase',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        sampledAt: new Date('2026-06-19T09:11:00.000Z'),
        value: '99',
        numericValue: 99,
        normalizedValue: 99,
        normalizedUnit: 'A',
        measurand: 'Current.Import',
        unit: 'A',
        context: 'Sample.Periodic',
        phase: 'L1',
        location: null,
        format: null
      },
      {
        id: 'sample-voltage',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        sampledAt: new Date('2026-06-19T09:10:00.000Z'),
        value: '230',
        numericValue: 230,
        normalizedValue: 230,
        normalizedUnit: 'V',
        measurand: 'Voltage',
        unit: 'V',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'sample-voltage-phase',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        sampledAt: new Date('2026-06-19T09:11:00.000Z'),
        value: '240',
        numericValue: 240,
        normalizedValue: 240,
        normalizedUnit: 'V',
        measurand: 'Voltage',
        unit: 'V',
        context: 'Sample.Periodic',
        phase: 'L1',
        location: null,
        format: null
      }
    ]).run();

    tempDb.db.insert(logs).values([
      {
        id: 'log-old',
        level: 'warn',
        category: 'charger',
        message: 'charger disconnected',
        chargerId: 'CHARGER-OLD',
        transactionId: 1001,
        metadata: JSON.stringify({ password: 'should-not-leak' }),
        createdAt: new Date('2026-06-19T08:31:00.000Z')
      },
      {
        id: 'log-new',
        level: 'info',
        category: 'session',
        message: 'charging session started',
        chargerId: 'CHARGER-ACTIVE',
        transactionId: 1002,
        metadata: JSON.stringify({
          token: 'also-hidden',
          proxyTargetId: 'proxy-1',
          method: 'StartTransaction',
          status: 'Accepted'
        }),
        createdAt: new Date('2026-06-19T09:06:00.000Z')
      }
    ]).run();

    const chargersResponse = await app.inject({
      method: 'GET',
      url: '/api/chargers',
      headers: { cookie }
    });
    expect(chargersResponse.statusCode).toBe(200);
    expect(chargersResponse.json()).toEqual([
      {
        id: 'CHARGER-ACTIVE',
        label: 'Active charger',
        enabled: true,
        firstSeenAt: '2026-06-19T09:00:00.000Z',
        lastSeenAt: '2026-06-19T09:05:00.000Z',
        lastBootAt: '2026-06-19T09:01:00.000Z',
        chargePointVendor: 'Vendor B',
        chargePointModel: 'Model B',
        firmwareVersion: '2.0.0',
        active: true,
        activeConnectionId: 'connection-active',
        connectedAt: '2026-06-19T09:00:00.000Z',
        disconnectedAt: null,
        createdAt: '2026-06-19T09:00:00.000Z',
        updatedAt: '2026-06-19T09:05:00.000Z'
      },
      {
        id: 'CHARGER-OLD',
        label: 'Old charger',
        enabled: true,
        firstSeenAt: '2026-06-19T08:00:00.000Z',
        lastSeenAt: '2026-06-19T08:30:00.000Z',
        lastBootAt: '2026-06-19T08:01:00.000Z',
        chargePointVendor: 'Vendor A',
        chargePointModel: 'Model A',
        firmwareVersion: '1.0.0',
        active: false,
        activeConnectionId: null,
        connectedAt: null,
        disconnectedAt: null,
        createdAt: '2026-06-19T08:00:00.000Z',
        updatedAt: '2026-06-19T08:30:00.000Z'
      }
    ]);

    const connectionsResponse = await app.inject({
      method: 'GET',
      url: '/api/charger-connections?chargerId=CHARGER-ACTIVE',
      headers: { cookie }
    });
    expect(connectionsResponse.statusCode).toBe(200);
    expect(connectionsResponse.json()).toEqual([
      {
        id: 'connection-active',
        chargerId: 'CHARGER-ACTIVE',
        connectedAt: '2026-06-19T09:00:00.000Z',
        disconnectedAt: null,
        active: true
      }
    ]);
    expect(connectionsResponse.body).not.toContain('should-not-leak');

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions?chargerId=CHARGER-ACTIVE',
      headers: { cookie }
    });
    expect(sessionsResponse.statusCode).toBe(200);
    expect(sessionsResponse.json()).toEqual([
      {
        id: 'session-active',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        idTag: 'ACTIVE-TAG',
        startedAt: '2026-06-19T09:05:00.000Z',
        stoppedAt: null,
        startMeterWh: 3000,
        stopMeterWh: null,
        stopReason: null,
        status: 'active',
        active: true
      }
    ]);

    const logsResponse = await app.inject({
      method: 'GET',
      url: '/api/logs?chargerId=CHARGER-ACTIVE',
      headers: { cookie }
    });
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json()).toEqual([
      {
        id: 'log-new',
        level: 'info',
        category: 'session',
        message: 'charging session started',
        chargerId: 'CHARGER-ACTIVE',
        transactionId: 1002,
        createdAt: '2026-06-19T09:06:00.000Z',
        hasMetadata: true,
        context: {
          proxyTargetId: 'proxy-1',
          method: 'StartTransaction',
          status: 'Accepted'
        }
      }
    ]);
    expect(logsResponse.body).not.toContain('also-hidden');

    const statsResponse = await app.inject({
      method: 'GET',
      url: '/api/charging-stats?chargerId=CHARGER-ACTIVE',
      headers: { cookie }
    });
    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toEqual([
      expect.objectContaining({
        sessionId: 'session-active',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        idTag: 'ACTIVE-TAG',
        startedAt: '2026-06-19T09:05:00.000Z',
        startMeterWh: 3000,
        latestMeterWh: 3750,
        energyUsedWh: 750,
        latestPowerW: 7200,
        latestCurrentA: 31.3,
        latestVoltageV: 230,
        latestSampleAt: '2026-06-19T09:10:00.000Z',
        latestEnergyContext: 'Sample.Periodic',
        latestPowerContext: 'Sample.Periodic'
      })
    ]);

    await app.close();
  });

  it('closes stale open charger connection rows before recording reconnects', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const repository = new OcppRepository(tempDb.db);

    const staleConnectionId = repository.recordConnected('SMART-EVSE-STALE');
    const activeConnectionId = repository.recordConnected('SMART-EVSE-STALE');
    repository.recordDisconnected('SMART-EVSE-STALE', staleConnectionId);

    const rows = tempDb.db.select().from(chargerConnections).all();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.disconnectedAt === null)).toHaveLength(1);
    expect(rows.filter((row) => row.disconnectedAt !== null)).toHaveLength(1);
    expect(rows.find((row) => row.id === activeConnectionId)?.disconnectedAt).toBeNull();
  });

  it('upgrades existing meter sample tables with normalized columns and indexes', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE meter_samples (
          id text PRIMARY KEY NOT NULL,
          charger_id text NOT NULL,
          transaction_id integer,
          connector_id integer NOT NULL,
          sampled_at integer NOT NULL,
          value text NOT NULL,
          measurand text,
          unit text,
          context text
        );
      `);

      applyMigrations(sqlite);

      const columns = sqlite.prepare('PRAGMA table_info(meter_samples)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['numeric_value', 'normalized_value', 'normalized_unit', 'phase', 'location', 'format'])
      );

      const indexes = sqlite.prepare('PRAGMA index_list(meter_samples)').all() as Array<{ name: string }>;
      expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining(['meter_samples_session_idx', 'meter_samples_measurand_idx']));
    } finally {
      sqlite.close();
    }
  });
});

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      username: 'admin',
      password: 'correct-password'
    }
  });

  const cookie = response.headers['set-cookie'];
  if (!cookie || Array.isArray(cookie)) {
    throw new Error('Expected login to return one cookie header');
  }

  return cookie;
}
