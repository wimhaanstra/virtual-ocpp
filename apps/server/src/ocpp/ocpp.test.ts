import { randomUUID } from 'node:crypto';
import { RPCClient, RPCServer } from 'ocpp-rpc';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import {
  chargerConnections,
  chargers,
  chargingSessions,
  logs,
  meterSamples,
  proxySessionMappings,
  proxyTargets,
  tagChargerAccess,
  tags
} from '../db/schema.js';
import { createTestDatabase, testConfig } from '../test-utils.js';

type OcppClient = InstanceType<typeof RPCClient>;
type Cleanup = () => Promise<void> | void;

async function startTestServer(configOverrides: Partial<ReturnType<typeof testConfig>> = {}) {
  const tempDb = createTestDatabase();
  const config = testConfig(configOverrides);
  const app = await buildApp({ config, db: tempDb.db });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on a TCP port');
  }

  return {
    app,
    db: tempDb.db,
    closeDb: tempDb.close,
    endpoint: `ws://127.0.0.1:${address.port}/ocpp`
  };
}

async function connectCharger(endpoint: string, identity = `CP-${randomUUID()}`, password?: string) {
  const client = new RPCClient({
    endpoint,
    identity,
    password,
    protocols: ['ocpp1.6'],
    strictMode: true
  } as ConstructorParameters<typeof RPCClient>[0]);
  await client.connect();
  return client as OcppClient;
}

async function startProxyServer(status: 'Accepted' | 'Invalid') {
  const server = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: false
  });
  server.auth((accept) => accept());
  server.on('client', (client) => {
    client.handle('Authorize', () => ({ idTagInfo: { status } }));
    client.handle('StartTransaction', () => ({ transactionId: 99, idTagInfo: { status } }));
  });

  const httpServer = (await server.listen(0, '127.0.0.1')) as Server;
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected proxy server to listen on a TCP port');
  }

  return {
    endpoint: `ws://127.0.0.1:${address.port}`,
    close: () => server.close({})
  };
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

      if (method === 'BootNotification') {
        return { status: 'Accepted', currentTime: new Date().toISOString(), interval: 60 };
      }
      if (method === 'Heartbeat') {
        return { currentTime: new Date().toISOString() };
      }
      if (method === 'Authorize') {
        return { idTagInfo: { status: 'Accepted' } };
      }
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

function insertProxyTarget(
  db: ReturnType<typeof createTestDatabase>['db'],
  values: Partial<typeof proxyTargets.$inferInsert> & Pick<typeof proxyTargets.$inferInsert, 'id' | 'chargerId' | 'name' | 'url'>
) {
  const now = new Date();
  const target = {
    enabled: true,
    username: null,
    stationId: null,
    mode: 'monitor-only',
    outagePolicy: 'fail-open',
    basicAuthPassword: null,
    createdAt: now,
    updatedAt: now,
    ...values
  };

  db.insert(proxyTargets).values(target).run();
  return target;
}

function createTag(
  db: ReturnType<typeof createTestDatabase>['db'],
  values: { uuid: string; label?: string; enabled?: boolean }
) {
  const id = randomUUID();
  db.insert(tags).values({
    id,
    uuid: values.uuid,
    label: values.label ?? values.uuid,
    enabled: values.enabled ?? true,
    createdAt: new Date()
  }).run();
  return id;
}

function grantTagAccess(
  db: ReturnType<typeof createTestDatabase>['db'],
  values: { tagId: string; chargerId: string; enabled?: boolean }
) {
  db.insert(tagChargerAccess).values({
    id: randomUUID(),
    tagId: values.tagId,
    chargerId: values.chargerId,
    enabled: values.enabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date()
  }).run();
}

describe('OCPP 1.6 local primary', () => {
  const cleanup: Cleanup[] = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it('auto-registers a charger on connect and boot', async () => {
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-1');
    cleanup.push(async () => { await charger.close({}); });

    const boot = await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE',
      firmwareVersion: '1.2.3'
    });
    const heartbeat = await charger.call('Heartbeat', {});

    expect(boot).toMatchObject({ status: 'Accepted', interval: 60 });
    expect(heartbeat).toHaveProperty('currentTime');

    expect(server.db.select().from(chargers).all()).toHaveLength(1);
    expect(server.db.select().from(chargers).all()[0]).toMatchObject({
      id: 'SMART-EVSE-1',
      enabled: true,
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE',
      firmwareVersion: '1.2.3'
    });
    expect(server.db.select().from(chargerConnections).all()).toHaveLength(1);
    expect(server.db.select().from(logs).all().some((row) => row.message === 'boot notification accepted')).toBe(true);
  });

  it('uses the /ocpp/:chargerId path as the registered charger context', async () => {
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const charger = await connectCharger(`${server.endpoint}/PATH-CHARGER`, 'WEBSOCKET-IDENTITY');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });

    expect(server.db.select().from(chargers).all()).toHaveLength(1);
    expect(server.db.select().from(chargers).all()[0]?.id).toBe('PATH-CHARGER');
    expect(server.db.select().from(chargerConnections).all()[0]?.chargerId).toBe('PATH-CHARGER');
  });

  it('requires charger-specific tag access before authorizing a tag', async () => {
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-TAGS');
    cleanup.push(async () => { await charger.close({}); });

    const tagId = createTag(server.db, { uuid: 'TAG-NO-ACCESS' });

    const denied = await charger.call('Authorize', { idTag: 'TAG-NO-ACCESS' });
    expect(denied).toEqual({ idTagInfo: { status: 'Invalid' } });

    grantTagAccess(server.db, { tagId, chargerId: 'SMART-EVSE-TAGS' });
    const accepted = await charger.call('Authorize', { idTag: 'TAG-NO-ACCESS' });
    expect(accepted).toEqual({ idTagInfo: { status: 'Accepted' } });
  });

  it('denies when a deny-capable proxy target rejects authorization for that charger', async () => {
    const proxy = await startProxyServer('Invalid');
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const tagId = createTag(server.db, { uuid: 'PROXY-DENIED' });
    grantTagAccess(server.db, { tagId, chargerId: 'SMART-EVSE-PROXY-DENY' });
    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-PROXY-DENY',
      name: 'Rejecting CSMS',
      url: proxy.endpoint,
      enabled: true,
      mode: 'deny-capable',
      outagePolicy: 'fail-closed'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-PROXY-DENY');
    cleanup.push(async () => { await charger.close({}); });

    const response = await charger.call('Authorize', { idTag: 'PROXY-DENIED' });

    expect(response).toEqual({ idTagInfo: { status: 'Invalid' } });
    expect(server.db.select().from(logs).all().some((row) => row.message === 'proxy target denied tag')).toBe(true);
  });

  it('does not forward charger traffic to proxy targets registered for another charger', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'OTHER-CHARGER',
      name: 'Other charger target',
      url: proxy.endpoint,
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-UNASSIGNED');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });
    await charger.call('Heartbeat', {});

    expect(proxy.calls).toHaveLength(0);
  });

  it('mirrors session traffic to charger-scoped proxy targets', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const tagId = createTag(server.db, { uuid: 'MIRROR-TAG' });
    grantTagAccess(server.db, { tagId, chargerId: 'SMART-EVSE-MIRROR' });
    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-MIRROR',
      name: 'Mirror CSMS',
      url: proxy.endpoint,
      username: 'proxy-user',
      stationId: 'UPSTREAM-STATION-1',
      enabled: true,
      mode: 'deny-capable',
      outagePolicy: 'fail-closed'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-MIRROR');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });
    await charger.call('StatusNotification', {
      connectorId: 1,
      errorCode: 'NoError',
      status: 'Preparing',
      timestamp: '2026-06-19T10:01:00.000Z'
    });
    const start = (await charger.call('StartTransaction', {
      connectorId: 1,
      idTag: 'MIRROR-TAG',
      meterStart: 100,
      timestamp: '2026-06-19T10:00:00.000Z'
    })) as { transactionId: number; idTagInfo: { status: string } };
    await charger.call('MeterValues', {
      connectorId: 1,
      transactionId: start.transactionId,
      meterValue: [
        {
          timestamp: '2026-06-19T10:05:00.000Z',
          sampledValue: [{ value: '2.5', measurand: 'Energy.Active.Import.Register', unit: 'kWh' }]
        }
      ]
    });
    await charger.call('StopTransaction', {
      transactionId: start.transactionId,
      meterStop: 250,
      timestamp: '2026-06-19T10:10:00.000Z',
      reason: 'Local'
    });

    expect(proxy.calls.map((call) => call.method)).toEqual([
      'BootNotification',
      'StatusNotification',
      'StartTransaction',
      'MeterValues',
      'StopTransaction'
    ]);
    expect(proxy.calls.find((call) => call.method === 'StartTransaction')?.identity).toBe('UPSTREAM-STATION-1');
    expect(proxy.calls.find((call) => call.method === 'StartTransaction')?.params).toMatchObject({
      idTag: 'MIRROR-TAG',
      meterStart: 100
    });
    expect(proxy.calls.find((call) => call.method === 'MeterValues')?.params).toMatchObject({
      transactionId: 4242
    });
    expect(proxy.calls.find((call) => call.method === 'StopTransaction')?.params).toMatchObject({
      transactionId: 4242,
      meterStop: 250
    });
    expect(server.db.select().from(proxySessionMappings).all()).toHaveLength(1);
    expect(server.db.select().from(proxySessionMappings).all()[0]).toMatchObject({
      chargerId: 'SMART-EVSE-MIRROR',
      localTransactionId: start.transactionId,
      externalTransactionId: 4242
    });
    expect(server.db.select().from(meterSamples).all()).toHaveLength(1);
    expect(server.db.select().from(chargingSessions).all()).toHaveLength(1);
  });
});
