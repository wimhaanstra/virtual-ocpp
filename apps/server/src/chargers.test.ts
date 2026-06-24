import { RPCClient, RPCServer } from 'ocpp-rpc';
import { and, eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import {
  chargerConnections,
  chargerProxyAssignments,
  chargers,
  chargingSessions,
  communicationJournal,
  logs,
  meterSamples,
  proxySessionMappings,
  proxyTagMappings,
  proxyTargets,
  tagChargerAccess,
  tags
} from './db/schema.js';
import { createTestDatabase, testConfig } from './test-utils.js';

type Cleanup = () => Promise<void> | void;

describe('charger management', () => {
  const cleanup: Cleanup[] = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it('renames charger labels through the operator API', async () => {
    const tempDb = createTestDatabase();
    cleanup.push(() => {
      tempDb.close();
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    cleanup.push(async () => {
      await app.close();
    });

    const cookie = await login(app);
    tempDb.db.insert(chargers).values({
      id: 'CHARGER-RENAME',
      label: 'Original label',
      enabled: true,
      firstSeenAt: new Date('2026-06-20T09:00:00.000Z'),
      lastSeenAt: new Date('2026-06-20T09:00:00.000Z'),
      createdAt: new Date('2026-06-20T09:00:00.000Z'),
      updatedAt: new Date('2026-06-20T09:00:00.000Z')
    }).run();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/chargers/CHARGER-RENAME',
      headers: { cookie },
      payload: {
        label: 'Renamed label'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'CHARGER-RENAME',
      label: 'Renamed label'
    });
    expect(tempDb.db.select().from(chargers).where(eqById('CHARGER-RENAME')).get()?.label).toBe('Renamed label');
  });

  it('requires the exact charger id and admin password before destructive delete', async () => {
    const tempDb = createTestDatabase();
    cleanup.push(() => {
      tempDb.close();
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    cleanup.push(async () => {
      await app.close();
    });

    const cookie = await login(app);
    tempDb.db.insert(chargers).values({
      id: 'CHARGER-DELETE',
      label: 'Delete me',
      enabled: true,
      firstSeenAt: new Date('2026-06-20T09:00:00.000Z'),
      lastSeenAt: new Date('2026-06-20T09:00:00.000Z'),
      createdAt: new Date('2026-06-20T09:00:00.000Z'),
      updatedAt: new Date('2026-06-20T09:00:00.000Z')
    }).run();

    const mismatch = await app.inject({
      method: 'DELETE',
      url: '/api/chargers/CHARGER-DELETE',
      headers: { cookie },
      payload: {
        adminPassword: 'correct-password',
        chargerIdConfirmation: 'CHARGER-WRONG'
      }
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toEqual({ error: 'charger_id_confirmation_mismatch' });

    const wrongPassword = await app.inject({
      method: 'DELETE',
      url: '/api/chargers/CHARGER-DELETE',
      headers: { cookie },
      payload: {
        adminPassword: 'wrong-password',
        chargerIdConfirmation: 'CHARGER-DELETE'
      }
    });
    expect(wrongPassword.statusCode).toBe(403);
    expect(wrongPassword.json()).toEqual({ error: 'invalid_admin_password' });

    expect(tempDb.db.select().from(chargers).all()).toHaveLength(1);
  });

  it('destructively deletes charger-owned data and closes live connections', async () => {
    const tempDb = createTestDatabase();
    cleanup.push(() => {
      tempDb.close();
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    cleanup.push(async () => {
      await app.close();
    });

    await listen(app);
    const cookie = await login(app);

    const charger = await connectCharger(getBaseUrl(app), 'CHARGER-DELETE-ALL');
    cleanup.push(async () => {
      await charger.close({});
    });

    let chargerClosed = false;
    const markChargerClosed = () => {
      chargerClosed = true;
    };
    charger.on('close', markChargerClosed);
    charger.on('disconnect', markChargerClosed);

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE',
      firmwareVersion: '1.2.3'
    });

    const upstream = await startRecordingProxyServer();
    cleanup.push(upstream.close);

    const created = await app.inject({
      method: 'POST',
      url: '/api/proxy-targets',
      headers: { cookie },
      payload: {
        chargerId: 'CHARGER-DELETE-ALL',
        name: 'Delete target',
        url: upstream.endpoint,
        enabled: true,
        mode: 'monitor-only',
        outagePolicy: 'fail-open',
        tagMappings: [
          {
            localIdTag: 'LOCAL-TAG',
            outboundIdTag: 'REMOTE-TAG'
          }
        ]
      }
    });
    expect(created.statusCode).toBe(201);
    const proxyTargetId = created.json().id as string;

    tempDb.db.insert(tags).values({
      id: 'tag-delete',
      uuid: 'TAG-DELETE',
      label: 'Delete tag',
      enabled: true,
      createdAt: new Date('2026-06-20T09:00:00.000Z')
    }).run();
    tempDb.db.insert(tagChargerAccess).values({
      id: 'tag-access-delete',
      tagId: 'tag-delete',
      chargerId: 'CHARGER-DELETE-ALL',
      enabled: true,
      createdAt: new Date('2026-06-20T09:00:00.000Z'),
      updatedAt: new Date('2026-06-20T09:00:00.000Z')
    }).run();
    tempDb.db.insert(chargerProxyAssignments).values({
      id: 'assignment-delete',
      chargerId: 'CHARGER-DELETE-ALL',
      proxyTargetId,
      enabled: true,
      stationId: null,
      mode: 'monitor-only',
      outagePolicy: 'fail-open',
      createdAt: new Date('2026-06-20T09:00:00.000Z'),
      updatedAt: new Date('2026-06-20T09:00:00.000Z')
    }).run();
    tempDb.db.insert(proxySessionMappings).values({
      id: 'proxy-session-delete',
      chargerId: 'CHARGER-DELETE-ALL',
      proxyTargetId,
      localTransactionId: 7,
      externalTransactionId: 77,
      createdAt: new Date('2026-06-20T09:05:00.000Z'),
      stoppedAt: null
    }).run();
    tempDb.db.insert(chargingSessions).values({
      id: 'session-delete',
      chargerId: 'CHARGER-DELETE-ALL',
      connectorId: 1,
      transactionId: 7,
      idTag: 'TAG-DELETE',
      startedAt: new Date('2026-06-20T09:05:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();
    tempDb.db.insert(meterSamples).values({
      id: 'meter-delete',
      chargerId: 'CHARGER-DELETE-ALL',
      connectorId: 1,
      transactionId: 7,
      sampledAt: new Date('2026-06-20T09:10:00.000Z'),
      value: '1.25',
      numericValue: 1.25,
      normalizedValue: 1250,
      normalizedUnit: 'Wh',
      measurand: 'Energy.Active.Import.Register',
      unit: 'kWh'
    }).run();
    tempDb.db.insert(logs).values({
      id: 'log-delete',
      level: 'info',
      category: 'charger',
      message: 'charger connected',
      chargerId: 'CHARGER-DELETE-ALL',
      transactionId: null,
      metadata: JSON.stringify({ source: 'test' }),
      createdAt: new Date('2026-06-20T09:10:00.000Z')
    }).run();
    tempDb.db.insert(communicationJournal).values({
      id: 'journal-delete',
      createdAt: new Date('2026-06-20T09:10:00.000Z'),
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-DELETE-ALL',
      targetType: 'server',
      targetId: 'server',
      chargerId: 'CHARGER-DELETE-ALL',
      proxyTargetId: proxyTargetId,
      messageType: 'call',
      ocppMethod: 'Heartbeat',
      transactionId: 7,
      idTag: 'TAG-DELETE',
      payloadJson: '{"ok":true}',
      errorCode: null,
      errorDescription: null,
      correlationId: 'corr-1'
    }).run();

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/chargers/CHARGER-DELETE-ALL',
      headers: { cookie },
      payload: {
        adminPassword: 'correct-password',
        chargerIdConfirmation: 'CHARGER-DELETE-ALL'
      }
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      ok: true,
      chargerId: 'CHARGER-DELETE-ALL',
      deleted: {
        chargers: 1,
        proxyTargets: 1,
        tagChargerAccess: 1
      }
    });
    await waitForCondition(() => expect(chargerClosed).toBe(true));
    await waitForCondition(() => expect(upstream.closedClients).toContain('CHARGER-DELETE-ALL'));

    expect(tempDb.db.select().from(chargers).where(eqById('CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(chargerConnections).where(eq(chargerConnections.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(chargingSessions).where(eq(chargingSessions.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(meterSamples).where(eq(meterSamples.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(proxyTargets).where(eq(proxyTargets.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(proxyTagMappings).where(eqByProxyTargetId(proxyTargetId)).all()).toHaveLength(0);
    expect(tempDb.db.select().from(proxySessionMappings).where(eq(proxySessionMappings.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(chargerProxyAssignments).where(eq(chargerProxyAssignments.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(tagChargerAccess).where(eq(tagChargerAccess.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(logs).where(eq(logs.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(communicationJournal).where(eq(communicationJournal.chargerId, 'CHARGER-DELETE-ALL')).all()).toHaveLength(0);
    expect(tempDb.db.select().from(communicationJournal).where(eq(communicationJournal.proxyTargetId, proxyTargetId)).all()).toHaveLength(0);

    const systemLog = tempDb.db.select().from(logs).where(eqByCategoryAndMessage('charger', 'charger deleted')).all();
    expect(systemLog).toHaveLength(1);
  });

  it('forwards charger commands through authenticated API routes and journals the exchange', async () => {
    const tempDb = createTestDatabase();
    cleanup.push(() => {
      tempDb.close();
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    cleanup.push(async () => {
      await app.close();
    });

    const cookie = await login(app);
    await listen(app);
    const charger = await connectCharger(getBaseUrl(app), 'CHARGER-COMMANDS');
    cleanup.push(async () => {
      await charger.close({});
    });

    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    charger.handle('GetConfiguration', async ({ params }) => {
      calls.push({ method: 'GetConfiguration', params: (params ?? {}) as Record<string, unknown> });
      return {
        configurationKey: [
          {
            key: 'MeterValueSampleInterval',
            readonly: false,
            value: '60'
          }
        ],
        unknownKey: ['MissingKey']
      };
    });
    charger.handle('ChangeConfiguration', async ({ params }) => {
      calls.push({ method: 'ChangeConfiguration', params: (params ?? {}) as Record<string, unknown> });
      return { status: 'Accepted' };
    });
    charger.handle('TriggerMessage', async ({ params }) => {
      calls.push({ method: 'TriggerMessage', params: (params ?? {}) as Record<string, unknown> });
      return { status: 'Accepted' };
    });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE',
      firmwareVersion: '4.2.0'
    });

    const configuration = await app.inject({
      method: 'POST',
      url: '/api/chargers/CHARGER-COMMANDS/commands/get-configuration',
      headers: { cookie },
      payload: {
        key: ['MeterValueSampleInterval']
      }
    });
    expect(configuration.statusCode).toBe(200);
    expect(configuration.json()).toEqual({
      configurationKey: [
        {
          key: 'MeterValueSampleInterval',
          readonly: false,
          value: '60'
        }
      ],
      unknownKey: ['MissingKey']
    });

    const change = await app.inject({
      method: 'POST',
      url: '/api/chargers/CHARGER-COMMANDS/commands/change-configuration',
      headers: { cookie },
      payload: {
        key: 'HeartbeatInterval',
        value: 'true'
      }
    });
    expect(change.statusCode).toBe(200);
    expect(change.json()).toEqual({
      status: 'Accepted'
    });

    const trigger = await app.inject({
      method: 'POST',
      url: '/api/chargers/CHARGER-COMMANDS/commands/trigger-message',
      headers: { cookie },
      payload: {
        requestedMessage: 'Heartbeat',
        connectorId: 1
      }
    });
    expect(trigger.statusCode).toBe(200);
    expect(trigger.json()).toEqual({
      status: 'Accepted'
    });

    expect(calls).toEqual([
      {
        method: 'GetConfiguration',
        params: {
          key: ['MeterValueSampleInterval']
        }
      },
      {
        method: 'ChangeConfiguration',
        params: {
          key: 'HeartbeatInterval',
          value: 'true'
        }
      },
      {
        method: 'TriggerMessage',
        params: {
          requestedMessage: 'Heartbeat',
          connectorId: 1
        }
      }
    ]);
    expect(
      tempDb.db
        .select()
        .from(communicationJournal)
        .all()
        .filter(
          (row) =>
            row.chargerId === 'CHARGER-COMMANDS' &&
            row.direction === 'outbound' &&
            row.sourceType === 'server' &&
            row.messageType === 'call'
        )
        .map((row) => row.ocppMethod)
    ).toEqual(['GetConfiguration', 'ChangeConfiguration', 'TriggerMessage']);
    expect(
      tempDb.db
        .select()
        .from(communicationJournal)
        .all()
        .filter(
          (row) =>
            row.chargerId === 'CHARGER-COMMANDS' &&
            row.direction === 'inbound' &&
            row.sourceType === 'charger' &&
            row.messageType === 'callResult'
        )
        .map((row) => row.ocppMethod)
    ).toEqual(['GetConfiguration', 'ChangeConfiguration', 'TriggerMessage']);
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

async function connectCharger(endpoint: string, identity: string) {
  const client = new RPCClient({
    endpoint,
    identity,
    protocols: ['ocpp1.6'],
    strictMode: true
  } as ConstructorParameters<typeof RPCClient>[0]);
  await client.connect();
  return client;
}

async function startRecordingProxyServer(port = 0) {
  const closedClients: string[] = [];
  const server = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: false
  });

  server.auth((accept) => accept());
  server.on('client', (client) => {
    client.on('close', () => {
      closedClients.push(client.identity ?? '');
    });
    client.handle((call: { method: string }) => {
      const { method } = call;
      if (method === 'BootNotification') {
        return { status: 'Accepted', currentTime: new Date().toISOString(), interval: 60 };
      }
      if (method === 'Heartbeat') {
        return { currentTime: new Date().toISOString() };
      }
      return {};
    });
  });

  const httpServer = (await server.listen(port, '127.0.0.1')) as Server;
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected proxy server to listen on a TCP port');
  }

  return {
    endpoint: `ws://127.0.0.1:${address.port}`,
    closedClients,
    close: () => server.close({})
  };
}

async function listen(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.listen({ host: '127.0.0.1', port: 0 });
}

function getBaseUrl(app: Awaited<ReturnType<typeof buildApp>>) {
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a listening TCP server');
  }

  return `ws://127.0.0.1:${address.port}/ocpp`;
}

async function waitForCondition(assertion: () => void | Promise<void>, timeoutMs = 3000) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  if (lastError) throw lastError;
}

function eqById(id: string) {
  return eq(chargers.id, id);
}

function eqByProxyTargetId(proxyTargetId: string) {
  return eq(proxyTagMappings.proxyTargetId, proxyTargetId);
}

function eqByCategoryAndMessage(category: string, message: string) {
  return and(eq(logs.category, category), eq(logs.message, message));
}
