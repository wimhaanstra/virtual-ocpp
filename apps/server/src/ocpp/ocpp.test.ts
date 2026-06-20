import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { RPCClient, RPCServer } from 'ocpp-rpc';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import {
  chargerConnections,
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

async function startRecordingProxyServer(port = 0) {
  const calls: Array<{ identity?: string; method: string; params: Record<string, unknown> }> = [];
  const clients: string[] = [];
  const closedClients: string[] = [];
  const server = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: false
  });

  server.auth((accept) => accept());
  server.on('client', (client) => {
    clients.push(client.identity ?? '');
    const recordClose = () => {
      if (closedClients.includes(client.identity ?? '')) return;
      closedClients.push(client.identity ?? '');
    };
    client.on('close', recordClose);
    client.on('disconnect', recordClose);
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

  const httpServer = (await server.listen(port, '127.0.0.1')) as Server;
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected proxy server to listen on a TCP port');
  }

  return {
    calls,
    clients,
    closedClients,
    port: address.port,
    endpoint: `ws://127.0.0.1:${address.port}`,
    close: () => server.close({})
  };
}

async function loginAdmin(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      username: 'admin',
      password: 'correct-password'
    }
  });

  const cookie = response.headers['set-cookie'];
  if (!cookie) {
    throw new Error('Expected login response to set a cookie');
  }

  return Array.isArray(cookie) ? cookie[0] : cookie;
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

  it('maps local tags to proxy-specific outbound tags for authorization and starts', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const tagId = createTag(server.db, { uuid: 'LOCAL-TAG' });
    grantTagAccess(server.db, { tagId, chargerId: 'SMART-EVSE-MAPPED' });
    insertProxyTarget(server.db, {
      id: 'proxy-mapped',
      chargerId: 'SMART-EVSE-MAPPED',
      name: 'Mapped proxy',
      url: proxy.endpoint,
      mode: 'deny-capable'
    });
    server.db.insert(proxyTagMappings).values({
      id: 'mapping-1',
      proxyTargetId: 'proxy-mapped',
      localIdTag: 'LOCAL-TAG',
      outboundIdTag: 'REMOTE-TAG',
      createdAt: new Date(),
      updatedAt: new Date()
    }).run();

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-MAPPED');
    cleanup.push(async () => { await charger.close({}); });

    const authorize = await charger.call('Authorize', { idTag: 'LOCAL-TAG' });
    const start = await charger.call('StartTransaction', {
      connectorId: 1,
      idTag: 'LOCAL-TAG',
      meterStart: 100,
      timestamp: '2026-06-19T10:00:00.000Z'
    });

    expect(authorize).toEqual({ idTagInfo: { status: 'Accepted' } });
    expect(start).toMatchObject({ idTagInfo: { status: 'Accepted' } });
    expect(proxy.calls.find((call) => call.method === 'Authorize')?.params).toMatchObject({ idTag: 'REMOTE-TAG' });
    expect(proxy.calls.find((call) => call.method === 'StartTransaction')?.params).toMatchObject({ idTag: 'REMOTE-TAG' });
    expect(server.db.select().from(chargingSessions).get()).toMatchObject({ idTag: 'LOCAL-TAG' });
    expect(
      server.db
        .select()
        .from(communicationJournal)
        .all()
        .some(
          (row) =>
            row.direction === 'outbound' &&
            row.targetType === 'proxy' &&
            row.ocppMethod === 'StartTransaction' &&
            row.idTag === 'REMOTE-TAG' &&
            JSON.parse(row.payloadJson).idTag === 'REMOTE-TAG'
        )
    ).toBe(true);
  });

  it('can map one local tag differently for separate proxy targets', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const tagId = createTag(server.db, { uuid: 'LOCAL-TAG' });
    grantTagAccess(server.db, { tagId, chargerId: 'SMART-EVSE-MULTI-MAP' });
    insertProxyTarget(server.db, {
      id: 'proxy-mapped-a',
      chargerId: 'SMART-EVSE-MULTI-MAP',
      name: 'Mapped proxy A',
      url: proxy.endpoint,
      mode: 'monitor-only'
    });
    insertProxyTarget(server.db, {
      id: 'proxy-mapped-b',
      chargerId: 'SMART-EVSE-MULTI-MAP',
      name: 'Mapped proxy B',
      url: proxy.endpoint,
      mode: 'monitor-only'
    });
    server.db.insert(proxyTagMappings).values([
      {
        id: 'mapping-a',
        proxyTargetId: 'proxy-mapped-a',
        localIdTag: 'LOCAL-TAG',
        outboundIdTag: 'REMOTE-A',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'mapping-b',
        proxyTargetId: 'proxy-mapped-b',
        localIdTag: 'LOCAL-TAG',
        outboundIdTag: 'REMOTE-B',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]).run();

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-MULTI-MAP');
    cleanup.push(async () => { await charger.close({}); });

    const authorize = await charger.call('Authorize', { idTag: 'LOCAL-TAG' });

    expect(authorize).toEqual({ idTagInfo: { status: 'Accepted' } });
    expect(proxy.calls.filter((call) => call.method === 'Authorize').map((call) => call.params.idTag).sort()).toEqual(['REMOTE-A', 'REMOTE-B']);
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

  it('sends RemoteStopTransaction to the connected charger for an active session', async () => {
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const remoteStopCalls: Array<Record<string, unknown>> = [];
    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-REMOTE-STOP');
    charger.handle('RemoteStopTransaction', async ({ params }) => {
      remoteStopCalls.push(params ?? {});
      return { status: 'Accepted' };
    });
    cleanup.push(async () => { await charger.close({}); });

    server.db.insert(chargingSessions).values({
      id: 'session-remote-stop',
      chargerId: 'SMART-EVSE-REMOTE-STOP',
      connectorId: 1,
      transactionId: 9001,
      idTag: 'TAG-1',
      startedAt: new Date('2026-06-19T09:00:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();

    const cookie = await loginAdmin(server.app);
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/sessions/session-remote-stop/remote-stop',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, status: 'Accepted' });
    expect(remoteStopCalls).toEqual([{ transactionId: 9001 }]);
    expect(server.db.select().from(chargingSessions).get()).toMatchObject({ status: 'active', stoppedAt: null });
    expect(
      server.db
        .select()
        .from(communicationJournal)
        .all()
        .some(
          (row) =>
            row.direction === 'outbound' &&
            row.targetType === 'charger' &&
            row.ocppMethod === 'RemoteStopTransaction' &&
            row.transactionId === 9001
        )
    ).toBe(true);
    expect(server.db.select().from(logs).all().some((row) => row.message === 'remote stop transaction requested')).toBe(true);
  });

  it('reuses one persistent upstream proxy connection for repeated calls', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-REUSE',
      name: 'Persistent CSMS',
      url: proxy.endpoint,
      basicAuthPassword: 'proxy-secret',
      stationId: 'UPSTREAM-REUSE',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-REUSE');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });
    await charger.call('Heartbeat', {});

    expect(proxy.calls.map((call) => call.method)).toContain('Heartbeat');
    expect(proxy.clients).toEqual(['UPSTREAM-REUSE']);
    expect(JSON.stringify(server.db.select().from(logs).all())).not.toContain('proxy-secret');
  });

  it('closes the cached upstream connection when a proxy target is disabled', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const targetId = randomUUID();
    insertProxyTarget(server.db, {
      id: targetId,
      chargerId: 'SMART-EVSE-DISABLE',
      name: 'Disable CSMS',
      url: proxy.endpoint,
      stationId: 'UPSTREAM-DISABLE',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-DISABLE');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });
    expect(proxy.clients).toEqual(['UPSTREAM-DISABLE']);

    const cookie = await loginAdmin(server.app);
    const response = await server.app.inject({
      method: 'PATCH',
      url: `/api/proxy-targets/${targetId}`,
      headers: { cookie },
      payload: { enabled: false }
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(proxy.closedClients).toEqual(['UPSTREAM-DISABLE']);
  });

  it('warms up a newly created proxy target for an already connected charger', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-WARM');
    cleanup.push(async () => { await charger.close({}); });
    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE',
      firmwareVersion: '3.7'
    });

    const cookie = await loginAdmin(server.app);
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/proxy-targets',
      headers: { cookie },
      payload: {
        chargerId: 'SMART-EVSE-WARM',
        name: 'Warm CSMS',
        url: proxy.endpoint,
        stationId: 'UPSTREAM-WARM',
        enabled: true,
        mode: 'monitor-only',
        outagePolicy: 'fail-open'
      }
    });

    expect(response.statusCode).toBe(201);
    expect(proxy.clients).toEqual(['UPSTREAM-WARM']);
    expect(proxy.calls.map((call) => call.method)).toEqual(['BootNotification', 'StatusNotification', 'Heartbeat']);
    expect(proxy.calls[0]?.params).toMatchObject({
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE',
      firmwareVersion: '3.7'
    });
  });

  it('warms enabled proxy targets when a charger connects', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-CONNECT-WARM',
      name: 'Connect warm CSMS',
      url: proxy.endpoint,
      stationId: 'UPSTREAM-CONNECT-WARM',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-CONNECT-WARM');
    cleanup.push(async () => { await charger.close({}); });

    await waitForCondition(() => {
      expect(proxy.clients).toEqual(['UPSTREAM-CONNECT-WARM']);
      expect(proxy.calls.map((call) => call.method)).toEqual(['BootNotification', 'StatusNotification', 'Heartbeat']);
    });
  });

  it('reconnects on demand after an upstream target disconnects and comes back', async () => {
    const firstProxy = await startRecordingProxyServer();
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-RECONNECT',
      name: 'Reconnect CSMS',
      url: firstProxy.endpoint,
      stationId: 'UPSTREAM-RECONNECT',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-RECONNECT');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });

    await firstProxy.close();
    const secondProxy = await startRecordingProxyServer(firstProxy.port);
    cleanup.push(secondProxy.close);

    await charger.call('Heartbeat', {});
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const heartbeat = await charger.call('Heartbeat', {});

    expect(heartbeat).toHaveProperty('currentTime');
    expect(secondProxy.clients).toEqual(['UPSTREAM-RECONNECT']);
    expect(server.db.select().from(logs).all().some((row) => row.message === 'proxy target connection reconnected')).toBe(true);
    expect(JSON.stringify(server.db.select().from(logs).all())).not.toContain('proxy-secret');
  });

  it('reconnects upstream targets in the background after a disconnect', async () => {
    const firstProxy = await startRecordingProxyServer();
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-BACKGROUND-RECONNECT',
      name: 'Background reconnect CSMS',
      url: firstProxy.endpoint,
      stationId: 'UPSTREAM-BACKGROUND-RECONNECT',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-BACKGROUND-RECONNECT');
    cleanup.push(async () => { await charger.close({}); });

    await waitForCondition(() => {
      expect(firstProxy.clients).toEqual(['UPSTREAM-BACKGROUND-RECONNECT']);
    });

    await firstProxy.close();
    const secondProxy = await startRecordingProxyServer(firstProxy.port);
    cleanup.push(secondProxy.close);

    await waitForCondition(() => {
      expect(secondProxy.clients).toEqual(['UPSTREAM-BACKGROUND-RECONNECT']);
      expect(secondProxy.calls.map((call) => call.method)).toEqual(['BootNotification', 'StatusNotification', 'Heartbeat']);
    }, 4000);
    expect(server.db.select().from(logs).all().some((row) => row.message === 'proxy target connection reconnected')).toBe(true);
  });

  it('fails open when an established deny-capable proxy connection is unavailable', async () => {
    const proxy = await startRecordingProxyServer();
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const tagId = createTag(server.db, { uuid: 'FAIL-OPEN-TAG' });
    grantTagAccess(server.db, { tagId, chargerId: 'SMART-EVSE-FAIL-OPEN' });
    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-FAIL-OPEN',
      name: 'Unavailable fail-open CSMS',
      url: proxy.endpoint,
      enabled: true,
      mode: 'deny-capable',
      outagePolicy: 'fail-open'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-FAIL-OPEN');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });
    await proxy.close();

    const response = await charger.call('Authorize', { idTag: 'FAIL-OPEN-TAG' });

    expect(response).toEqual({ idTagInfo: { status: 'Accepted' } });
    expect(server.db.select().from(logs).all().some((row) => row.message === 'proxy target unavailable, failing open')).toBe(true);
  });

  it('fails closed when an established deny-capable proxy connection is unavailable', async () => {
    const proxy = await startRecordingProxyServer();
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    const tagId = createTag(server.db, { uuid: 'FAIL-CLOSED-TAG' });
    grantTagAccess(server.db, { tagId, chargerId: 'SMART-EVSE-FAIL-CLOSED' });
    insertProxyTarget(server.db, {
      id: randomUUID(),
      chargerId: 'SMART-EVSE-FAIL-CLOSED',
      name: 'Unavailable fail-closed CSMS',
      url: proxy.endpoint,
      enabled: true,
      mode: 'deny-capable',
      outagePolicy: 'fail-closed'
    });

    const charger = await connectCharger(server.endpoint, 'SMART-EVSE-FAIL-CLOSED');
    cleanup.push(async () => { await charger.close({}); });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE'
    });
    await proxy.close();

    const response = await charger.call('Authorize', { idTag: 'FAIL-CLOSED-TAG' });

    expect(response).toEqual({ idTagInfo: { status: 'Invalid' } });
    expect(server.db.select().from(logs).all().some((row) => row.message === 'proxy target unavailable, failing closed')).toBe(true);
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

    expect(proxy.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining([
        'BootNotification',
        'StatusNotification',
        'StartTransaction',
        'MeterValues',
        'StopTransaction'
      ])
    );
    expect(proxy.calls.find((call) => call.method === 'StartTransaction')?.identity).toBe('UPSTREAM-STATION-1');
    expect(proxy.clients).toEqual(['UPSTREAM-STATION-1']);
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
    const recordedSamples = server.db.select().from(meterSamples).all();
    expect(recordedSamples).toHaveLength(1);
    expect(recordedSamples[0]).toMatchObject({
      value: '2.5',
      numericValue: 2.5,
      normalizedValue: 2500,
      normalizedUnit: 'Wh',
      measurand: 'Energy.Active.Import.Register',
      unit: 'kWh'
    });
    expect(server.db.select().from(chargingSessions).all()).toHaveLength(1);
  });

  it('force closes lingering sessions by sending StopTransaction to proxy targets first', async () => {
    const proxy = await startRecordingProxyServer();
    cleanup.push(proxy.close);
    const server = await startTestServer();
    cleanup.push(() => { server.closeDb(); }, async () => { await server.app.close(); });

    insertProxyTarget(server.db, {
      id: 'proxy-force-close',
      chargerId: 'SMART-EVSE-FORCE-CLOSE',
      name: 'Force close CSMS',
      url: proxy.endpoint,
      stationId: 'UPSTREAM-FORCE-CLOSE',
      enabled: true,
      mode: 'monitor-only',
      outagePolicy: 'fail-open'
    });
    server.db.insert(chargingSessions).values({
      id: 'session-force-close',
      chargerId: 'SMART-EVSE-FORCE-CLOSE',
      connectorId: 1,
      transactionId: 700,
      idTag: 'FORCE-TAG',
      startedAt: new Date('2026-06-19T10:00:00.000Z'),
      stoppedAt: null,
      startMeterWh: 1000,
      stopMeterWh: null,
      stopReason: null,
      status: 'active'
    }).run();
    server.db.insert(proxySessionMappings).values({
      id: 'mapping-force-close',
      chargerId: 'SMART-EVSE-FORCE-CLOSE',
      proxyTargetId: 'proxy-force-close',
      localTransactionId: 700,
      externalTransactionId: 1700,
      createdAt: new Date('2026-06-19T10:00:00.000Z'),
      stoppedAt: null
    }).run();
    server.db.insert(meterSamples).values({
      id: 'meter-force-close',
      chargerId: 'SMART-EVSE-FORCE-CLOSE',
      connectorId: 1,
      transactionId: null,
      sampledAt: new Date('2026-06-19T10:05:00.000Z'),
      value: '2.75',
      numericValue: 2.75,
      normalizedValue: 2750,
      normalizedUnit: 'Wh',
      measurand: 'Energy.Active.Import.Register',
      unit: 'kWh'
    }).run();

    const cookie = await loginAdmin(server.app);
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/sessions/session-force-close/force-close',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(proxy.calls.find((call) => call.method === 'StopTransaction')?.params).toMatchObject({
      transactionId: 1700,
      idTag: 'FORCE-TAG',
      meterStop: 2750,
      timestamp: '2026-06-19T10:05:00.000Z',
      reason: 'Local'
    });
    expect(server.db.select().from(chargingSessions).where(eq(chargingSessions.id, 'session-force-close')).get()).toMatchObject({
      status: 'stopped',
      stopMeterWh: 2750,
      stopReason: 'OperatorForceClosed'
    });
    expect(server.db.select().from(proxySessionMappings).where(eq(proxySessionMappings.id, 'mapping-force-close')).get()?.stoppedAt).toBeInstanceOf(Date);
  });
});
