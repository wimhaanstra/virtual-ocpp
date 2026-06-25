import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { RPCServer } from 'ocpp-rpc';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { applyMigrations } from '../src/db/client.js';
import {
  chargerConnections,
  chargerProxyAssignments,
  chargers,
  chargingSessions,
  communicationJournal,
  logs,
  meterGapEvents,
  meterSamples,
  proxySessionMappings,
  proxyTagMappings,
  proxyTargets,
  remoteStopRequests,
  sessions,
  tagChargerAccess,
  tags
} from '../src/db/schema.js';
import { OcppRepository } from '../src/ocpp/repository.js';
import { createTestDatabase, testConfig } from './support/test-utils.js';

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

  it('returns readiness status after database access succeeds', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, database: 'ready' });

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

  it('does not mark session cookies secure on plain http production requests', async () => {
    const config = testConfig({ nodeEnv: 'production' });
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
    expect(String(response.headers['set-cookie'])).not.toContain('Secure');

    await app.close();
  });

  it('marks session cookies secure when forwarded over https', async () => {
    const config = testConfig({ nodeEnv: 'production' });
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'x-forwarded-proto': 'https'
      },
      payload: {
        username: 'admin',
        password: 'correct-password'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('Secure');

    await app.close();
  });

  it('requires authentication for operator routes', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });

    const routes = [
      { method: 'GET', url: '/api/chargers' },
      { method: 'GET', url: '/api/proxy-targets?chargerId=CHARGER-1' },
      { method: 'GET', url: '/api/proxy-health?chargerId=CHARGER-1' },
      { method: 'GET', url: '/api/settings/onboarding' },
      { method: 'PATCH', url: '/api/settings/onboarding' },
      { method: 'GET', url: '/api/tags' },
      { method: 'GET', url: '/api/charger-connections' },
      { method: 'GET', url: '/api/sessions' },
      { method: 'GET', url: '/api/session-summary' },
      { method: 'GET', url: '/api/active-session-audit' },
      { method: 'POST', url: '/api/sessions/session-1/remote-stop' },
      { method: 'POST', url: '/api/chargers/CHARGER-1/commands/get-configuration' },
      { method: 'POST', url: '/api/chargers/CHARGER-1/commands/change-configuration' },
      { method: 'POST', url: '/api/chargers/CHARGER-1/commands/trigger-message' },
      { method: 'GET', url: '/api/charging-stats' },
      { method: 'GET', url: '/api/logs' },
      { method: 'GET', url: '/api/communication-journal' },
      { method: 'GET', url: '/api/live-updates' }
    ] as const;

    for (const { method, url } of routes) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
    }

    await app.close();
  });

  it('marks stale open charger connections disconnected on startup', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;

    tempDb.db.insert(chargerConnections).values({
      id: 'stale-connection-1',
      chargerId: 'SMART-EVSE-STALE-STARTUP',
      connectedAt: new Date('2026-06-19T09:00:00.000Z')
    }).run();
    tempDb.db.insert(chargingSessions).values({
      id: 'session-stale-startup',
      chargerId: 'SMART-EVSE-STALE-STARTUP',
      connectorId: 1,
      transactionId: 111,
      idTag: 'STALE-TAG',
      startedAt: new Date('2026-06-19T09:05:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();

    const app = await buildApp({ config, db: tempDb.db });

    const connection = tempDb.db.select().from(chargerConnections).where(eq(chargerConnections.id, 'stale-connection-1')).limit(1).get();
    expect(connection?.disconnectedAt).toBeInstanceOf(Date);
    expect(tempDb.db.select().from(logs).all()).toEqual([
      expect.objectContaining({
        level: 'warn',
        category: 'charger',
        message: 'stale charger connection closed on startup',
        chargerId: 'SMART-EVSE-STALE-STARTUP'
      })
    ]);
    expect(app.liveUpdates.replaySince().map((event) => event.event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'charger.disconnected',
          chargerId: 'SMART-EVSE-STALE-STARTUP'
        }),
        expect.objectContaining({
          type: 'refresh',
          topic: 'sessions',
          chargerId: 'SMART-EVSE-STALE-STARTUP'
        })
      ])
    );
    const cookie = await login(app);
    const audit = await app.inject({
      method: 'GET',
      url: '/api/active-session-audit?chargerId=SMART-EVSE-STALE-STARTUP',
      headers: { cookie }
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().items[0]).toMatchObject({
      sessionId: 'session-stale-startup',
      disconnectSource: 'startup_reconciliation',
      disconnectSourceAt: expect.any(String)
    });

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
        basicAuthPassword: 'target-secret',
        tagMappings: [
          {
            localIdTag: 'LOCAL-TAG',
            outboundIdTag: 'REMOTE-TAG'
          }
        ]
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
      hasBasicAuthPassword: true,
      tagMappings: [
        expect.objectContaining({
          localIdTag: 'LOCAL-TAG',
          outboundIdTag: 'REMOTE-TAG'
        })
      ]
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
    expect(listed.json()[0].tagMappings).toEqual([
      expect.objectContaining({
        localIdTag: 'LOCAL-TAG',
        outboundIdTag: 'REMOTE-TAG'
      })
    ]);
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

    const remappedWhileActive = await app.inject({
      method: 'PATCH',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie },
      payload: {
        tagMappings: [
          {
            localIdTag: 'LOCAL-TAG',
            outboundIdTag: 'REMOTE-TAG-ACTIVE'
          }
        ]
      }
    });
    expect(remappedWhileActive.statusCode).toBe(200);
    expect(
      tempDb.db
        .select()
        .from(proxySessionMappings)
        .where(eq(proxySessionMappings.id, 'active-mapping'))
        .get()?.stoppedAt
    ).toBeNull();

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
    expect(tempDb.db.select().from(proxyTagMappings).all()).toHaveLength(1);

    const remapped = await app.inject({
      method: 'PATCH',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie },
      payload: {
        tagMappings: [
          {
            localIdTag: 'LOCAL-TAG',
            outboundIdTag: 'REMOTE-TAG-2'
          }
        ]
      }
    });
    expect(remapped.statusCode).toBe(200);
    expect(remapped.json().tagMappings).toEqual([
      expect.objectContaining({
        localIdTag: 'LOCAL-TAG',
        outboundIdTag: 'REMOTE-TAG-2'
      })
    ]);
    expect(tempDb.db.select().from(proxyTagMappings).all()).toHaveLength(1);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie }
    });
    expect(deleted.statusCode).toBe(200);
    expect(tempDb.db.select().from(proxyTargets).all()).toHaveLength(0);
    expect(tempDb.db.select().from(proxyTagMappings).all()).toHaveLength(0);

    await app.close();
  });

  it('enforces at most three enabled proxy targets per charger', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);
    const now = new Date('2026-06-19T09:00:00.000Z');

    for (const chargerId of ['CHARGER-PROXY-LIMIT', 'CHARGER-PROXY-OTHER']) {
      tempDb.db.insert(chargers).values({
        id: chargerId,
        enabled: true,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now
      }).run();
    }

    for (let index = 1; index <= 3; index += 1) {
      tempDb.db.insert(proxyTargets).values({
        id: `proxy-limit-${index}`,
        chargerId: 'CHARGER-PROXY-LIMIT',
        name: `Proxy ${index}`,
        url: `ws://127.0.0.1:90${index}/ocpp`,
        stationId: `STATION-${index}`,
        enabled: true,
        mode: 'monitor-only',
        outagePolicy: 'fail-open',
        allowRecoverySubmissions: false,
        createdAt: now,
        updatedAt: now
      }).run();
    }

    const blockedCreate = await app.inject({
      method: 'POST',
      url: '/api/proxy-targets',
      headers: { cookie },
      payload: {
        chargerId: 'CHARGER-PROXY-LIMIT',
        name: 'Fourth enabled',
        url: 'ws://127.0.0.1:9004/ocpp',
        enabled: true
      }
    });
    expect(blockedCreate.statusCode).toBe(409);
    expect(blockedCreate.json()).toMatchObject({ error: 'proxy_target_limit_exceeded', maxEnabledTargets: 3 });
    expect(tempDb.db.select().from(proxyTargets).where(eq(proxyTargets.chargerId, 'CHARGER-PROXY-LIMIT')).all()).toHaveLength(3);

    const disabledCreate = await app.inject({
      method: 'POST',
      url: '/api/proxy-targets',
      headers: { cookie },
      payload: {
        chargerId: 'CHARGER-PROXY-LIMIT',
        name: 'Fourth disabled',
        url: 'ws://127.0.0.1:9005/ocpp',
        enabled: false
      }
    });
    expect(disabledCreate.statusCode).toBe(201);
    expect(disabledCreate.json()).toMatchObject({ enabled: false });

    const blockedEnable = await app.inject({
      method: 'PATCH',
      url: `/api/proxy-targets/${disabledCreate.json().id}`,
      headers: { cookie },
      payload: {
        enabled: true
      }
    });
    expect(blockedEnable.statusCode).toBe(409);
    expect(blockedEnable.json()).toMatchObject({ error: 'proxy_target_limit_exceeded', maxEnabledTargets: 3 });
    expect(tempDb.db.select().from(proxyTargets).where(eq(proxyTargets.id, disabledCreate.json().id)).get()).toMatchObject({ enabled: false });

    const enabledUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/proxy-targets/proxy-limit-1',
      headers: { cookie },
      payload: {
        name: 'Proxy 1 renamed'
      }
    });
    expect(enabledUpdate.statusCode).toBe(200);
    expect(enabledUpdate.json()).toMatchObject({ name: 'Proxy 1 renamed', enabled: true });

    const otherChargerCreate = await app.inject({
      method: 'POST',
      url: '/api/proxy-targets',
      headers: { cookie },
      payload: {
        chargerId: 'CHARGER-PROXY-OTHER',
        name: 'Other charger proxy',
        url: 'ws://127.0.0.1:9010/ocpp',
        enabled: true
      }
    });
    expect(otherChargerCreate.statusCode).toBe(201);
    expect(otherChargerCreate.json()).toMatchObject({ chargerId: 'CHARGER-PROXY-OTHER', enabled: true });

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

  it('deletes a charger and all charger-owned data after password and id confirmation', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);
    const now = new Date('2026-06-19T09:00:00.000Z');

    tempDb.db.insert(chargers).values([
      {
        id: 'CHARGER-DELETE',
        label: 'Delete me',
        enabled: true,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'CHARGER-KEEP',
        label: 'Keep me',
        enabled: true,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now
      }
    ]).run();
    tempDb.db.insert(tags).values({
      id: 'tag-delete-access',
      uuid: 'TAG-DELETE',
      label: 'Shared tag',
      enabled: true,
      createdAt: now
    }).run();
    tempDb.db.insert(tagChargerAccess).values([
      {
        id: 'access-delete',
        tagId: 'tag-delete-access',
        chargerId: 'CHARGER-DELETE',
        enabled: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'access-keep',
        tagId: 'tag-delete-access',
        chargerId: 'CHARGER-KEEP',
        enabled: true,
        createdAt: now,
        updatedAt: now
      }
    ]).run();
    tempDb.db.insert(proxyTargets).values({
      id: 'target-delete',
      chargerId: 'CHARGER-DELETE',
      name: 'Delete target',
      url: 'ws://127.0.0.1:9000',
      username: null,
      stationId: 'REMOTE-DELETE',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      basicAuthPassword: null,
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(proxyTagMappings).values({
      id: 'mapping-delete',
      proxyTargetId: 'target-delete',
      localIdTag: 'LOCAL',
      outboundIdTag: 'REMOTE',
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(chargerProxyAssignments).values({
      id: 'assignment-delete',
      chargerId: 'CHARGER-DELETE',
      proxyTargetId: 'target-delete',
      enabled: true,
      stationId: null,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(proxySessionMappings).values({
      id: 'proxy-session-delete',
      chargerId: 'CHARGER-DELETE',
      proxyTargetId: 'target-delete',
      localTransactionId: 10,
      externalTransactionId: 20,
      createdAt: now
    }).run();
    tempDb.db.insert(chargerConnections).values({
      id: 'connection-delete',
      chargerId: 'CHARGER-DELETE',
      connectedAt: now
    }).run();
    tempDb.db.insert(chargingSessions).values({
      id: 'session-delete',
      chargerId: 'CHARGER-DELETE',
      connectorId: 1,
      transactionId: 10,
      idTag: 'LOCAL',
      startedAt: now,
      status: 'active'
    }).run();
    tempDb.db.insert(meterSamples).values({
      id: 'sample-delete',
      chargerId: 'CHARGER-DELETE',
      transactionId: 10,
      connectorId: 1,
      sampledAt: now,
      value: '1',
      numericValue: 1,
      normalizedValue: 1000,
      normalizedUnit: 'Wh',
      measurand: 'Energy.Active.Import.Register',
      unit: 'kWh',
      context: null,
      phase: null,
      location: null,
      format: null
    }).run();
    tempDb.db.insert(logs).values({
      id: 'log-delete',
      level: 'info',
      category: 'charger',
      message: 'delete log',
      chargerId: 'CHARGER-DELETE',
      transactionId: null,
      metadata: null,
      createdAt: now
    }).run();
    tempDb.db.insert(communicationJournal).values({
      id: 'journal-delete',
      createdAt: now,
      direction: 'outbound',
      sourceType: 'server',
      sourceId: 'server',
      targetType: 'proxy',
      targetId: 'target-delete',
      chargerId: 'CHARGER-DELETE',
      proxyTargetId: 'target-delete',
      messageType: 'call',
      ocppMethod: 'Heartbeat',
      transactionId: null,
      idTag: null,
      payloadJson: '{}',
      errorCode: null,
      errorDescription: null,
      correlationId: null
    }).run();

    const mismatch = await app.inject({
      method: 'DELETE',
      url: '/api/chargers/CHARGER-DELETE',
      headers: { cookie },
      payload: {
        adminPassword: 'correct-password',
        chargerIdConfirmation: 'CHARGER-KEEP'
      }
    });
    expect(mismatch.statusCode).toBe(409);

    const badPassword = await app.inject({
      method: 'DELETE',
      url: '/api/chargers/CHARGER-DELETE',
      headers: { cookie },
      payload: {
        adminPassword: 'wrong-password',
        chargerIdConfirmation: 'CHARGER-DELETE'
      }
    });
    expect(badPassword.statusCode).toBe(403);
    expect(tempDb.db.select().from(chargers).where(eq(chargers.id, 'CHARGER-DELETE')).get()).toBeDefined();

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/chargers/CHARGER-DELETE',
      headers: { cookie },
      payload: {
        adminPassword: 'correct-password',
        chargerIdConfirmation: 'CHARGER-DELETE'
      }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      ok: true
    });

    expect(tempDb.db.select().from(chargers).where(eq(chargers.id, 'CHARGER-DELETE')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(proxyTargets).all()).toHaveLength(0);
    expect(tempDb.db.select().from(proxyTagMappings).all()).toHaveLength(0);
    expect(tempDb.db.select().from(proxySessionMappings).all()).toHaveLength(0);
    expect(tempDb.db.select().from(chargerProxyAssignments).all()).toHaveLength(0);
    expect(tempDb.db.select().from(chargerConnections).where(eq(chargerConnections.chargerId, 'CHARGER-DELETE')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(chargingSessions).where(eq(chargingSessions.chargerId, 'CHARGER-DELETE')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(meterSamples).where(eq(meterSamples.chargerId, 'CHARGER-DELETE')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(communicationJournal).all()).toHaveLength(0);
    expect(tempDb.db.select().from(logs).where(eq(logs.chargerId, 'CHARGER-DELETE')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(tags).all()).toHaveLength(1);
    expect(tempDb.db.select().from(tagChargerAccess).all()).toEqual([
      expect.objectContaining({
        id: 'access-keep',
        chargerId: 'CHARGER-KEEP'
      })
    ]);
    expect(tempDb.db.select().from(chargers).where(eq(chargers.id, 'CHARGER-KEEP')).all()).toHaveLength(1);
    expect(tempDb.db.select().from(logs).where(eq(logs.message, 'charger deleted')).all()).toHaveLength(1);

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
        id: 'session-complete',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1001,
        idTag: 'ACTIVE-TAG',
        startedAt: new Date('2026-06-19T08:05:00.000Z'),
        stoppedAt: new Date('2026-06-19T08:45:00.000Z'),
        startMeterWh: 1000,
        stopMeterWh: 2500,
        stopReason: 'Local',
        status: 'stopped'
      },
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
        id: 'sample-temperature',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1002,
        sampledAt: new Date('2026-06-19T09:10:00.000Z'),
        value: '42',
        numericValue: 42,
        normalizedValue: 42,
        normalizedUnit: 'Celsius',
        measurand: 'Temperature',
        unit: 'Celsius',
        context: 'Sample.Periodic',
        phase: null,
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
        connectionState: 'connected',
        lastMessageAt: '2026-06-19T09:05:00.000Z',
        connectionWarning: null,
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
        connectionState: 'silent',
        lastMessageAt: '2026-06-19T08:30:00.000Z',
        connectionWarning: {
          code: 'no_recent_ocpp_traffic',
          severity: 'warn',
          message:
            'No recent OCPP traffic received. Check that OCPP is enabled on the charger, the URL and station id are correct, and the charger can reach this server.',
          lastMessageAt: '2026-06-19T08:30:00.000Z'
        },
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
      },
      {
        id: 'session-complete',
        chargerId: 'CHARGER-ACTIVE',
        connectorId: 2,
        transactionId: 1001,
        idTag: 'ACTIVE-TAG',
        startedAt: '2026-06-19T08:05:00.000Z',
        stoppedAt: '2026-06-19T08:45:00.000Z',
        startMeterWh: 1000,
        stopMeterWh: 2500,
        stopReason: 'Local',
        status: 'stopped',
        active: false
      }
    ]);

    const sessionSummaryResponse = await app.inject({
      method: 'GET',
      url: '/api/session-summary?chargerId=CHARGER-ACTIVE',
      headers: { cookie }
    });
    expect(sessionSummaryResponse.statusCode).toBe(200);
    expect(sessionSummaryResponse.json()).toEqual({
      chargerId: 'CHARGER-ACTIVE',
      totalSessions: 2,
      activeSessions: 1,
      totalEnergyWh: 1500,
      lastSession: {
        id: 'session-active',
        transactionId: 1002,
        startedAt: '2026-06-19T09:05:00.000Z',
        stoppedAt: null,
        active: true,
        energyWh: null
      }
    });

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
        latestCurrentPhasesA: {
          L1: 99
        },
        latestVoltageV: 230,
        latestTemperatureC: 42,
        latestSampleAt: '2026-06-19T09:10:00.000Z',
        sampleAssociation: 'transaction-id',
        latestEnergyContext: 'Sample.Periodic',
        latestPowerContext: 'Sample.Periodic'
      })
    ]);

    await app.close();
  });

  it('matches transactionless MeterValues to the active session by connector and time window', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargingSessions).values({
      id: 'session-transactionless',
      chargerId: 'SMART-EVSE-TRANSACTIONLESS',
      connectorId: 1,
      transactionId: 1782211273551,
      idTag: '4227105',
      startedAt: new Date('2026-06-23T15:22:08.000Z'),
      stoppedAt: null,
      startMeterWh: 480341,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();

    tempDb.db.insert(meterSamples).values([
      {
        id: 'transactionless-energy',
        chargerId: 'SMART-EVSE-TRANSACTIONLESS',
        connectorId: 1,
        transactionId: null,
        sampledAt: new Date('2026-06-23T15:30:28.000Z'),
        value: '480834',
        numericValue: 480834,
        normalizedValue: 480834,
        normalizedUnit: 'Wh',
        measurand: 'Energy.Active.Import.Register',
        unit: 'Wh',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'transactionless-power',
        chargerId: 'SMART-EVSE-TRANSACTIONLESS',
        connectorId: 1,
        transactionId: null,
        sampledAt: new Date('2026-06-23T15:30:28.000Z'),
        value: '3757.00',
        numericValue: 3757,
        normalizedValue: 3757,
        normalizedUnit: 'W',
        measurand: 'Power.Active.Import',
        unit: 'W',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'transactionless-current',
        chargerId: 'SMART-EVSE-TRANSACTIONLESS',
        connectorId: 1,
        transactionId: null,
        sampledAt: new Date('2026-06-23T15:30:28.000Z'),
        value: '16.00',
        numericValue: 16,
        normalizedValue: 16,
        normalizedUnit: 'A',
        measurand: 'Current.Import',
        unit: 'A',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'transactionless-current-l1',
        chargerId: 'SMART-EVSE-TRANSACTIONLESS',
        connectorId: 1,
        transactionId: null,
        sampledAt: new Date('2026-06-23T15:30:28.000Z'),
        value: '16.00',
        numericValue: 16,
        normalizedValue: 16,
        normalizedUnit: 'A',
        measurand: 'Current.Import',
        unit: 'A',
        context: 'Sample.Periodic',
        phase: 'L1',
        location: null,
        format: null
      },
      {
        id: 'transactionless-current-l2',
        chargerId: 'SMART-EVSE-TRANSACTIONLESS',
        connectorId: 1,
        transactionId: null,
        sampledAt: new Date('2026-06-23T15:30:28.000Z'),
        value: '0.00',
        numericValue: 0,
        normalizedValue: 0,
        normalizedUnit: 'A',
        measurand: 'Current.Import',
        unit: 'A',
        context: 'Sample.Periodic',
        phase: 'L2',
        location: null,
        format: null
      },
      {
        id: 'transactionless-temperature',
        chargerId: 'SMART-EVSE-TRANSACTIONLESS',
        connectorId: 1,
        transactionId: null,
        sampledAt: new Date('2026-06-23T15:30:28.000Z'),
        value: '39.00',
        numericValue: 39,
        normalizedValue: null,
        normalizedUnit: null,
        measurand: 'Temperature',
        unit: 'Celsius',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      },
      {
        id: 'outside-window-energy',
        chargerId: 'SMART-EVSE-TRANSACTIONLESS',
        connectorId: 1,
        transactionId: null,
        sampledAt: new Date('2026-06-23T15:00:00.000Z'),
        value: '999999',
        numericValue: 999999,
        normalizedValue: 999999,
        normalizedUnit: 'Wh',
        measurand: 'Energy.Active.Import.Register',
        unit: 'Wh',
        context: 'Sample.Periodic',
        phase: null,
        location: null,
        format: null
      }
    ]).run();

    const statsResponse = await app.inject({
      method: 'GET',
      url: '/api/charging-stats?chargerId=SMART-EVSE-TRANSACTIONLESS',
      headers: { cookie }
    });

    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toEqual([
      expect.objectContaining({
        sessionId: 'session-transactionless',
        latestMeterWh: 480834,
        energyUsedWh: 493,
        latestPowerW: 3757,
        latestCurrentA: 16,
        latestCurrentPhasesA: {
          L1: 16,
          L2: 0
        },
        latestTemperatureC: 39,
        latestSampleAt: '2026-06-23T15:30:28.000Z',
        sampleAssociation: 'connector-time-window'
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

  it('closes stale active sessions on the same connector before creating a new session', () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const repository = new OcppRepository(tempDb.db);

    repository.createSession({
      chargerId: 'SMART-EVSE-SESSION',
      connectorId: 1,
      transactionId: 100,
      idTag: 'TAG-1',
      startedAt: new Date('2026-06-19T09:00:00.000Z'),
      meterStart: 1000
    });

    tempDb.db.insert(proxySessionMappings).values({
      id: 'mapping-stale',
      chargerId: 'SMART-EVSE-SESSION',
      proxyTargetId: 'proxy-1',
      localTransactionId: 100,
      externalTransactionId: 200,
      createdAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null
    }).run();

    repository.createSession({
      chargerId: 'SMART-EVSE-SESSION',
      connectorId: 1,
      transactionId: 101,
      idTag: 'TAG-1',
      startedAt: new Date('2026-06-19T09:15:00.000Z'),
      meterStart: 1100
    });

    const rows = tempDb.db.select().from(chargingSessions).all();
    expect(rows.find((row) => row.transactionId === 100)).toMatchObject({
      status: 'stopped',
      stopReason: 'ReplacedByNewTransaction',
      stoppedAt: new Date('2026-06-19T09:15:00.000Z')
    });
    expect(rows.find((row) => row.transactionId === 101)).toMatchObject({ status: 'active' });
    expect(tempDb.db.select().from(proxySessionMappings).get()?.stoppedAt).toEqual(new Date('2026-06-19T09:15:00.000Z'));
  });

  it('allows operators to manually close lingering active sessions', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargingSessions).values({
      id: 'session-lingering',
      chargerId: 'SMART-EVSE-LINGER',
      connectorId: 1,
      transactionId: 300,
      idTag: 'TAG-1',
      startedAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();

    tempDb.db.insert(proxySessionMappings).values({
      id: 'mapping-lingering',
      chargerId: 'SMART-EVSE-LINGER',
      proxyTargetId: 'proxy-1',
      localTransactionId: 300,
      externalTransactionId: 400,
      createdAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-lingering/close',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'session-lingering',
      status: 'stopped',
      active: false,
      stopReason: 'OperatorClosed'
    });
    expect(tempDb.db.select().from(chargingSessions).get()?.status).toBe('stopped');
    expect(tempDb.db.select().from(proxySessionMappings).get()?.stoppedAt).toBeInstanceOf(Date);

    await app.close();
  });

  it('previews force close StopTransaction payloads with the latest meter sample', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargingSessions).values({
      id: 'session-force-preview',
      chargerId: 'SMART-EVSE-FORCE-PREVIEW',
      connectorId: 1,
      transactionId: 301,
      idTag: 'TAG-FORCE',
      startedAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();

    tempDb.db.insert(proxyTargets).values({
      id: 'proxy-force-preview',
      chargerId: 'SMART-EVSE-FORCE-PREVIEW',
      name: 'Preview CSMS',
      url: 'ws://127.0.0.1:65535',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      createdAt: new Date('2026-06-19T09:00:00.000Z'),
      updatedAt: new Date('2026-06-19T09:00:00.000Z')
    }).run();
    tempDb.db.insert(proxySessionMappings).values({
      id: 'mapping-force-preview',
      chargerId: 'SMART-EVSE-FORCE-PREVIEW',
      proxyTargetId: 'proxy-force-preview',
      localTransactionId: 301,
      externalTransactionId: 401,
      createdAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null
    }).run();
    tempDb.db.insert(meterSamples).values({
      id: 'meter-force-preview',
      chargerId: 'SMART-EVSE-FORCE-PREVIEW',
      connectorId: 1,
      transactionId: null,
      sampledAt: new Date('2026-06-19T09:15:00.000Z'),
      value: '1.55',
      numericValue: 1.55,
      normalizedValue: 1550,
      normalizedUnit: 'Wh',
      measurand: 'Energy.Active.Import.Register',
      unit: 'kWh'
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/session-force-preview/force-close-preview',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      meterSource: 'latest-meter-sample',
      localStopTransaction: {
        transactionId: 301,
        idTag: 'TAG-FORCE',
        meterStop: 1550,
        timestamp: '2026-06-19T09:15:00.000Z',
        reason: 'Local'
      },
      proxyPayloads: [
        {
          proxyTargetId: 'proxy-force-preview',
          proxyTargetName: 'Preview CSMS',
          externalTransactionId: 401,
          payload: {
            transactionId: 401,
            idTag: 'TAG-FORCE',
            meterStop: 1550,
            timestamp: '2026-06-19T09:15:00.000Z',
            reason: 'Local'
          }
        }
      ]
    });

    await app.close();
  });

  it('recovers an orphaned proxy stop transaction with an operator supplied upstream id', async () => {
    const proxy = await startRecordingProxyServer();
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = () => {
      proxy.close();
      tempDb.close();
    };
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargingSessions).values({
      id: 'session-orphaned-proxy',
      chargerId: 'SMART-EVSE-ORPHANED',
      connectorId: 1,
      transactionId: 900,
      idTag: 'TAG-ORPHAN',
      startedAt: new Date('2026-06-22T10:42:39.000Z'),
      stoppedAt: new Date('2026-06-23T05:39:03.000Z'),
      startMeterWh: 472632,
      stopMeterWh: 480341,
      stopReason: 'EVDisconnected',
      status: 'stopped'
    }).run();
    tempDb.db.insert(proxyTargets).values({
      id: 'proxy-orphaned-stop',
      chargerId: 'SMART-EVSE-ORPHANED',
      name: 'TapElectric',
      url: proxy.endpoint,
      stationId: '8881',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      createdAt: new Date('2026-06-22T10:00:00.000Z'),
      updatedAt: new Date('2026-06-22T10:00:00.000Z')
    }).run();
    tempDb.db.insert(proxySessionMappings).values({
      id: 'previous-proxy-session',
      chargerId: 'SMART-EVSE-ORPHANED',
      proxyTargetId: 'proxy-orphaned-stop',
      localTransactionId: 899,
      externalTransactionId: 10083,
      createdAt: new Date('2026-06-22T09:00:00.000Z'),
      stoppedAt: new Date('2026-06-22T10:00:00.000Z')
    }).run();

    const suggestionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-orphaned-proxy/proxy-stop-recovery-suggestion',
      headers: { cookie },
      payload: {
        proxyTargetId: 'proxy-orphaned-stop'
      }
    });

    expect(suggestionResponse.statusCode).toBe(200);
    expect(suggestionResponse.json()).toMatchObject({
      predictedExternalTransactionId: 10084,
      lastKnownExternalTransactionId: 10083,
      lastKnownLocalTransactionId: 899,
      source: 'last-proxy-mapping',
      proxyTarget: {
        id: 'proxy-orphaned-stop',
        name: 'TapElectric',
        enabled: true
      }
    });

    const previewResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-orphaned-proxy/proxy-stop-recovery-preview',
      headers: { cookie },
      payload: {
        proxyTargetId: 'proxy-orphaned-stop',
        externalTransactionId: 10084
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      externalTransactionId: 10084,
      payload: {
        transactionId: 10084,
        idTag: 'TAG-ORPHAN',
        meterStop: 480341,
        timestamp: '2026-06-23T05:39:03.000Z',
        reason: 'EVDisconnected'
      },
      proxyTarget: {
        id: 'proxy-orphaned-stop',
        name: 'TapElectric',
        enabled: true
      }
    });

    const submitResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-orphaned-proxy/proxy-stop-recovery',
      headers: { cookie },
      payload: {
        proxyTargetId: 'proxy-orphaned-stop',
        externalTransactionId: 10084
      }
    });

    expect(submitResponse.statusCode).toBe(200);
    expect(proxy.calls.find((call) => call.method === 'StopTransaction')?.params).toMatchObject({
      transactionId: 10084,
      idTag: 'TAG-ORPHAN',
      meterStop: 480341,
      timestamp: '2026-06-23T05:39:03.000Z',
      reason: 'EVDisconnected'
    });
    expect(tempDb.db.select().from(proxySessionMappings).where(eq(proxySessionMappings.localTransactionId, 900)).get()).toMatchObject({
      proxyTargetId: 'proxy-orphaned-stop',
      externalTransactionId: 10084
    });
    expect(
      tempDb.db
        .select()
        .from(logs)
        .where(eq(logs.message, 'proxy stop transaction recovered'))
        .get()
    ).toMatchObject({ chargerId: 'SMART-EVSE-ORPHANED', transactionId: 900 });

    await app.close();
  });

  it('queues and retries stopped local sessions with open proxy stop mappings', async () => {
    const proxy = await startRecordingProxyServer();
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = () => {
      proxy.close();
      tempDb.close();
    };
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargingSessions).values({
      id: 'session-open-proxy-stop',
      chargerId: 'SMART-EVSE-RETRY-STOP',
      connectorId: 1,
      transactionId: 901,
      idTag: 'TAG-RETRY',
      startedAt: new Date('2026-06-22T10:42:39.000Z'),
      stoppedAt: new Date('2026-06-23T05:39:03.000Z'),
      startMeterWh: 472632,
      stopMeterWh: 480341,
      stopReason: 'EVDisconnected',
      status: 'stopped'
    }).run();
    tempDb.db.insert(proxyTargets).values({
      id: 'proxy-retry-stop',
      chargerId: 'SMART-EVSE-RETRY-STOP',
      name: 'TapElectric',
      url: proxy.endpoint,
      stationId: '8881',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      createdAt: new Date('2026-06-22T10:00:00.000Z'),
      updatedAt: new Date('2026-06-22T10:00:00.000Z')
    }).run();
    tempDb.db.insert(proxySessionMappings).values({
      id: 'open-proxy-stop-mapping',
      chargerId: 'SMART-EVSE-RETRY-STOP',
      proxyTargetId: 'proxy-retry-stop',
      localTransactionId: 901,
      externalTransactionId: 10084,
      createdAt: new Date('2026-06-22T10:42:40.000Z'),
      stoppedAt: null
    }).run();

    const queueResponse = await app.inject({
      method: 'GET',
      url: '/api/proxy-stop-recovery-queue?chargerId=SMART-EVSE-RETRY-STOP',
      headers: { cookie }
    });

    expect(queueResponse.statusCode).toBe(200);
    expect(queueResponse.json()).toMatchObject({
      summary: {
        pendingStops: 1,
        retryableStops: 1
      },
      items: [
        {
          mapping: {
            id: 'open-proxy-stop-mapping',
            localTransactionId: 901,
            externalTransactionId: 10084,
            stoppedAt: null
          },
          session: {
            id: 'session-open-proxy-stop',
            status: 'stopped'
          },
          proxyTarget: {
            id: 'proxy-retry-stop',
            name: 'TapElectric',
            enabled: true
          },
          payload: {
            transactionId: 10084,
            idTag: 'TAG-RETRY',
            meterStop: 480341,
            timestamp: '2026-06-23T05:39:03.000Z',
            reason: 'EVDisconnected'
          }
        }
      ]
    });

    const retryResponse = await app.inject({
      method: 'POST',
      url: '/api/proxy-stop-recovery-queue/open-proxy-stop-mapping/retry',
      headers: { cookie }
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json()).toMatchObject({
      externalTransactionId: 10084,
      result: {
        proxyTargetId: 'proxy-retry-stop',
        proxyTargetName: 'TapElectric',
        externalTransactionId: 10084,
        attempted: true,
        ok: true
      }
    });
    expect(proxy.calls.find((call) => call.method === 'StopTransaction')?.params).toMatchObject({
      transactionId: 10084,
      idTag: 'TAG-RETRY',
      meterStop: 480341,
      timestamp: '2026-06-23T05:39:03.000Z',
      reason: 'EVDisconnected'
    });
    expect(tempDb.db.select().from(proxySessionMappings).where(eq(proxySessionMappings.id, 'open-proxy-stop-mapping')).get()?.stoppedAt).toBeInstanceOf(Date);
    expect(
      tempDb.db
        .select()
        .from(logs)
        .where(eq(logs.message, 'proxy stop transaction retry recovered'))
        .get()
    ).toMatchObject({ chargerId: 'SMART-EVSE-RETRY-STOP', transactionId: 901 });

    const emptyQueueResponse = await app.inject({
      method: 'GET',
      url: '/api/proxy-stop-recovery-queue?chargerId=SMART-EVSE-RETRY-STOP',
      headers: { cookie }
    });

    expect(emptyQueueResponse.statusCode).toBe(200);
    expect(emptyQueueResponse.json()).toMatchObject({
      summary: {
        pendingStops: 0,
        retryableStops: 0
      },
      items: []
    });

    await app.close();
  });

  it('returns active session audit warnings and proxy mapping context', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargingSessions).values({
      id: 'session-audit',
      chargerId: 'SMART-EVSE-AUDIT',
      connectorId: 1,
      transactionId: 501,
      idTag: 'AUDIT-TAG',
      startedAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();
    tempDb.db.insert(chargerConnections).values({
      id: 'connection-audit',
      chargerId: 'SMART-EVSE-AUDIT',
      connectedAt: new Date('2026-06-19T08:55:00.000Z'),
      disconnectedAt: new Date('2026-06-19T09:20:00.000Z')
    }).run();
    tempDb.db.insert(proxyTargets).values({
      id: 'proxy-audit',
      chargerId: 'SMART-EVSE-AUDIT',
      name: 'Audit CSMS',
      url: 'ws://127.0.0.1:65535',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      createdAt: new Date('2026-06-19T09:00:00.000Z'),
      updatedAt: new Date('2026-06-19T09:00:00.000Z')
    }).run();
    tempDb.db.insert(proxySessionMappings).values({
      id: 'mapping-audit',
      chargerId: 'SMART-EVSE-AUDIT',
      proxyTargetId: 'proxy-audit',
      localTransactionId: 501,
      externalTransactionId: 1501,
      createdAt: new Date('2026-06-19T09:01:00.000Z'),
      stoppedAt: null
    }).run();
    tempDb.db.insert(meterSamples).values({
      id: 'sample-audit-energy',
      chargerId: 'SMART-EVSE-AUDIT',
      connectorId: 1,
      transactionId: null,
      sampledAt: new Date('2026-06-19T09:10:00.000Z'),
      value: '1.4',
      numericValue: 1.4,
      normalizedValue: 1400,
      normalizedUnit: 'Wh',
      measurand: 'Energy.Active.Import.Register',
      unit: 'kWh'
    }).run();
    tempDb.db.insert(logs).values([
      {
        id: 'log-audit-status',
        level: 'info',
        category: 'status',
        message: 'charger status notification',
        chargerId: 'SMART-EVSE-AUDIT',
        transactionId: null,
        metadata: JSON.stringify({ connectorId: 1, status: 'Available', timestamp: '2026-06-19T09:15:00.000Z' }),
        createdAt: new Date('2026-06-19T09:15:00.000Z')
      }
    ]).run();
    tempDb.db.insert(remoteStopRequests).values({
      id: 'remote-stop-audit',
      sessionId: 'session-audit',
      chargerId: 'SMART-EVSE-AUDIT',
      transactionId: 501,
      status: 'accepted',
      responseStatus: 'Accepted',
      errorCode: null,
      requestedAt: new Date(Date.now() - 60_000),
      completedAt: null
    }).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/active-session-audit?chargerId=SMART-EVSE-AUDIT',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: {
        activeSessions: 1,
        flaggedSessions: 1
      },
      items: [
        {
          sessionId: 'session-audit',
          chargerId: 'SMART-EVSE-AUDIT',
          connectorId: 1,
          transactionId: 501,
          chargerConnected: false,
          disconnectSource: 'charger_disconnect',
          disconnectSourceAt: '2026-06-19T09:20:00.000Z',
          latestStatus: 'Available',
          latestMeterWh: 1400,
          forceCloseMeterSource: 'latest-meter-sample',
          recommendedAction: 'force_close_preview',
          remoteStop: {
            id: 'remote-stop-audit',
            status: 'timed_out',
            responseStatus: 'Accepted',
            errorCode: null,
            completedAt: expect.any(String)
          },
          proxyMappings: [
            {
              proxyTargetId: 'proxy-audit',
              proxyTargetName: 'Audit CSMS',
              externalTransactionId: 1501,
              stoppedAt: null
            }
          ],
          warnings: expect.arrayContaining([
            expect.objectContaining({ code: 'connector_available_without_stop_transaction' }),
            expect.objectContaining({ code: 'charger_disconnected_without_stop_transaction' }),
            expect.objectContaining({ code: 'remote_stop_accepted_waiting_for_stop_transaction' })
          ])
        }
      ]
    });

    await app.close();
  });

  it('rejects remote stop when the charger is not connected', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    tempDb.db.insert(chargingSessions).values({
      id: 'session-disconnected',
      chargerId: 'SMART-EVSE-DISCONNECTED',
      connectorId: 1,
      transactionId: 301,
      idTag: 'TAG-1',
      startedAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-disconnected/remote-stop',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'charger_not_connected' });
    expect(tempDb.db.select().from(logs).all().some((row) => row.message === 'remote stop transaction failed')).toBe(true);

    await app.close();
  });

  it('manually scans existing sessions for meter gaps without creating duplicates', async () => {
    const config = testConfig({ meterGapThresholdWh: 500 });
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    const now = new Date('2026-06-19T09:00:00.000Z');
    tempDb.db.insert(chargers).values({
      id: 'CHARGER-GAP-SCAN',
      label: 'Gap scan',
      enabled: true,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(chargingSessions).values([
      {
        id: 'gap-scan-previous',
        chargerId: 'CHARGER-GAP-SCAN',
        connectorId: 1,
        transactionId: 1,
        idTag: 'TAG',
        startedAt: new Date('2026-06-19T09:00:00.000Z'),
        stoppedAt: new Date('2026-06-19T09:30:00.000Z'),
        startMeterWh: 500,
        stopMeterWh: 1000,
        stopReason: 'Local',
        status: 'stopped'
      },
      {
        id: 'gap-scan-next',
        chargerId: 'CHARGER-GAP-SCAN',
        connectorId: 1,
        transactionId: 2,
        idTag: 'TAG',
        startedAt: new Date('2026-06-19T10:00:00.000Z'),
        stoppedAt: new Date('2026-06-19T10:30:00.000Z'),
        startMeterWh: 2500,
        stopMeterWh: 2800,
        stopReason: 'Local',
        status: 'stopped'
      }
    ]).run();

    const first = await app.inject({
      method: 'POST',
      url: '/api/chargers/CHARGER-GAP-SCAN/meter-gaps/scan',
      headers: { cookie },
      payload: {}
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ chargerId: 'CHARGER-GAP-SCAN', thresholdWh: 500, created: 1, existing: 0 });
    expect(tempDb.db.select().from(meterGapEvents).all()).toHaveLength(1);

    const second = await app.inject({
      method: 'POST',
      url: '/api/chargers/CHARGER-GAP-SCAN/meter-gaps/scan',
      headers: { cookie },
      payload: {}
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ created: 0, existing: 1 });
    expect(tempDb.db.select().from(meterGapEvents).all()).toHaveLength(1);

    await app.close();
  });

  it('does not create a manual meter gap before the first known charging session', async () => {
    const config = testConfig({ meterGapThresholdWh: 500 });
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    const now = new Date('2026-06-19T09:00:00.000Z');
    tempDb.db.insert(chargers).values({
      id: 'CHARGER-FIRST-GAP-SCAN',
      label: 'First gap scan',
      enabled: true,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(chargingSessions).values({
      id: 'first-gap-scan-session',
      chargerId: 'CHARGER-FIRST-GAP-SCAN',
      connectorId: 1,
      transactionId: 1,
      idTag: 'TAG',
      startedAt: new Date('2026-06-19T10:00:00.000Z'),
      stoppedAt: new Date('2026-06-19T10:30:00.000Z'),
      startMeterWh: 2500,
      stopMeterWh: 2800,
      stopReason: 'Local',
      status: 'stopped'
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/chargers/CHARGER-FIRST-GAP-SCAN/meter-gaps/scan',
      headers: { cookie },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ created: 0, existing: 0 });
    expect(tempDb.db.select().from(meterGapEvents).all()).toHaveLength(0);

    await app.close();
  });

  it('submits a pending meter gap as a synthetic transaction to recovery-enabled proxy targets', async () => {
    const config = testConfig();
    const tempDb = createTestDatabase();
    const proxy = await startRecordingProxyServer();
    closeDb = () => {
      proxy.close();
      tempDb.close();
    };
    const app = await buildApp({ config, db: tempDb.db });
    const cookie = await login(app);

    const now = new Date('2026-06-19T09:00:00.000Z');
    tempDb.db.insert(chargers).values({
      id: 'CHARGER-GAP-SUBMIT',
      label: 'Gap submit',
      enabled: true,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(chargingSessions).values([
      {
        id: 'gap-submit-previous',
        chargerId: 'CHARGER-GAP-SUBMIT',
        connectorId: 1,
        transactionId: 1,
        idTag: 'TAG-PREVIOUS',
        startedAt: new Date('2026-06-19T08:30:00.000Z'),
        stoppedAt: new Date('2026-06-19T09:00:00.000Z'),
        startMeterWh: 500,
        stopMeterWh: 1000,
        stopReason: 'Local',
        status: 'stopped'
      },
      {
        id: 'gap-submit-next',
        chargerId: 'CHARGER-GAP-SUBMIT',
        connectorId: 1,
        transactionId: 2,
        idTag: 'TAG-NEXT',
        startedAt: new Date('2026-06-19T10:00:00.000Z'),
        stoppedAt: null,
        startMeterWh: 2500,
        stopMeterWh: null,
        stopReason: null,
        status: 'active'
      }
    ]).run();
    tempDb.db.insert(proxyTargets).values({
      id: 'target-gap-submit',
      chargerId: 'CHARGER-GAP-SUBMIT',
      name: 'Recovery target',
      url: proxy.endpoint,
      username: null,
      stationId: 'REMOTE-GAP-SUBMIT',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      allowRecoverySubmissions: true,
      basicAuthPassword: null,
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(proxyTagMappings).values({
      id: 'mapping-gap-submit',
      proxyTargetId: 'target-gap-submit',
      localIdTag: 'TAG-NEXT',
      outboundIdTag: 'TAG-REMOTE',
      createdAt: now,
      updatedAt: now
    }).run();
    tempDb.db.insert(meterGapEvents).values({
      id: 'gap-submit-event',
      chargerId: 'CHARGER-GAP-SUBMIT',
      connectorId: 1,
      previousSessionId: 'gap-submit-previous',
      newSessionId: 'gap-submit-next',
      previousStoppedAt: new Date('2026-06-19T09:00:00.000Z'),
      newStartedAt: new Date('2026-06-19T10:00:00.000Z'),
      previousMeterWh: 1000,
      newMeterStartWh: 2500,
      deltaWh: 1500,
      thresholdWh: 500,
      status: 'pending',
      submissionResultJson: null,
      createdAt: now,
      updatedAt: now
    }).run();

    const preview = await app.inject({
      method: 'GET',
      url: '/api/meter-gap-events/gap-submit-event/recovery-preview',
      headers: { cookie }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      idTag: 'TAG-NEXT',
      meterStart: 1000,
      meterStop: 2500,
      targets: [expect.objectContaining({ proxyTargetName: 'Recovery target', canSubmit: true })]
    });

    const submitted = await app.inject({
      method: 'POST',
      url: '/api/meter-gap-events/gap-submit-event/submit',
      headers: { cookie },
      payload: {
        startAt: '2026-06-19T09:15:00.000Z',
        stopAt: '2026-06-19T09:45:00.000Z'
      }
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ status: 'submitted' });
    expect(tempDb.db.select().from(meterGapEvents).where(eq(meterGapEvents.id, 'gap-submit-event')).get()?.status).toBe('submitted');
    expect(proxy.calls.map((call) => call.method)).toEqual(['StartTransaction', 'StopTransaction']);
    expect(proxy.calls[0]).toMatchObject({
      identity: 'REMOTE-GAP-SUBMIT',
      params: {
        connectorId: 1,
        idTag: 'TAG-REMOTE',
        meterStart: 1000,
        timestamp: '2026-06-19T09:15:00.000Z'
      }
    });
    expect(proxy.calls[1]).toMatchObject({
      identity: 'REMOTE-GAP-SUBMIT',
      params: {
        transactionId: 4242,
        idTag: 'TAG-REMOTE',
        meterStop: 2500,
        timestamp: '2026-06-19T09:45:00.000Z',
        reason: 'Other'
      }
    });

    await app.close();
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

  it('upgrades existing proxy target tables with the recovery submission flag idempotently', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(`
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
          basic_auth_password text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
      `);

      applyMigrations(sqlite);
      applyMigrations(sqlite);

      const columns = sqlite.prepare('PRAGMA table_info(proxy_targets)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain('allow_recovery_submissions');
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

async function startRecordingProxyServer() {
  const calls: Array<{ identity?: string; method: string; params: Record<string, unknown> }> = [];
  const server = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: false
  });

  server.auth((accept) => accept());
  server.on('client', (client) => {
    client.handle(({ method, params }: { method: string; params: unknown }) => {
      calls.push({ identity: client.identity, method, params: params as Record<string, unknown> });

      if (method === 'StartTransaction') {
        return { transactionId: 4242, idTagInfo: { status: 'Accepted' } };
      }
      if (method === 'StopTransaction') {
        return { idTagInfo: { status: 'Accepted' } };
      }
      return {};
    });
  });

  const httpServer = (await server.listen(0, '127.0.0.1')) as Server;
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected proxy server to listen on a TCP port');
  }

  return {
    calls,
    endpoint: `ws://127.0.0.1:${address.port}`,
    close: () => server.close({})
  };
}
