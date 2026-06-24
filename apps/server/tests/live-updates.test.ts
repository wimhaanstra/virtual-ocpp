import { RPCClient, RPCServer } from 'ocpp-rpc';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CommunicationJournalService } from '../src/communication-journal.js';
import { createTestDatabase, testConfig } from './support/test-utils.js';
import { LiveUpdateBus } from '../src/live-updates.js';
import { OcppRepository } from '../src/ocpp/repository.js';

type Cleanup = () => Promise<void> | void;
type LiveApp = Awaited<ReturnType<typeof buildApp>>;

const decoder = new TextDecoder();

describe('live updates', () => {
  const cleanup: Cleanup[] = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it('streams authenticated events over SSE and replays buffered updates', async () => {
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

    const stream = await fetch(`http://127.0.0.1:${getPort(app)}/api/live-updates`, {
      headers: {
        cookie,
        accept: 'text/event-stream'
      }
    });

    expect(stream.status).toBe(200);

    const reader = stream.body?.getReader();
    if (!reader) {
      throw new Error('Expected SSE response body');
    }

    const nextEvent = createSseReader(reader);
    expect(await nextEvent()).toEqual({
      event: 'ready',
      data: { ok: true }
    });

    const envelope = app.liveUpdates.publish({
      type: 'charger.updated',
      chargerId: 'CHARGER-LIVE',
      updatedAt: new Date().toISOString(),
      reason: 'manual_test'
    });

    expect(await nextEvent()).toEqual({
      event: 'live-update',
      data: envelope
    });

    await reader.cancel();
  });

  it('publishes typed backend events for charger, session, meter, log, and journal changes', async () => {
    const tempDb = createTestDatabase();
    cleanup.push(() => {
      tempDb.close();
    });

    const bus = new LiveUpdateBus();
    const events: Array<string> = [];
    const envelopes: Array<string> = [];
    const unsubscribe = bus.subscribe((envelope) => {
      events.push(envelope.event.type);
      envelopes.push(envelope.id);
    });
    cleanup.push(unsubscribe);

    const journal = new CommunicationJournalService(tempDb.db, 24, bus);
    const repository = new OcppRepository(tempDb.db, journal, bus);

    const connectionId = repository.recordConnected('CHARGER-LIVE-1');
    repository.recordLog({
      category: 'charger',
      message: 'manual log entry',
      chargerId: 'CHARGER-LIVE-1'
    });
    repository.createSession({
      chargerId: 'CHARGER-LIVE-1',
      connectorId: 1,
      transactionId: 101,
      idTag: 'TAG-101',
      startedAt: new Date('2026-06-20T09:00:00.000Z'),
      meterStart: 1200
    });
    repository.recordMeterSample({
      chargerId: 'CHARGER-LIVE-1',
      connectorId: 1,
      transactionId: 101,
      sampledAt: new Date('2026-06-20T09:05:00.000Z'),
      value: '1.55',
      numericValue: 1.55,
      normalizedValue: 1550,
      normalizedUnit: 'Wh',
      measurand: 'Energy.Active.Import.Register',
      unit: 'kWh'
    });
    repository.stopSession({
      chargerId: 'CHARGER-LIVE-1',
      transactionId: 101,
      stoppedAt: new Date('2026-06-20T09:10:00.000Z'),
      reason: 'Local'
    });
    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-LIVE-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-LIVE-1',
      ocppMethod: 'Heartbeat',
      payload: { ok: true }
    });
    repository.recordDisconnected('CHARGER-LIVE-1', connectionId);

    expect(events).toEqual(
      expect.arrayContaining([
        'charger.connected',
        'log.recorded',
        'session.created',
        'meter.sample.recorded',
        'session.stopped',
        'journal.recorded',
        'charger.disconnected'
      ])
    );
    expect(new Set(envelopes).size).toBe(envelopes.length);
  });

  it('publishes proxy health changes when a proxy target warms up', async () => {
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

    const charger = await connectCharger(getBaseUrl(app), 'CHARGER-PROXY-LIVE');
    cleanup.push(async () => {
      await charger.close({});
    });

    await charger.call('BootNotification', {
      chargePointVendor: 'Smart EVSE',
      chargePointModel: 'SmartEVSE',
      firmwareVersion: '1.2.3'
    });

    const upstream = await startUpstreamProxyServer();
    cleanup.push(upstream.close);

    const observed = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for proxy health event')), 5000);
      cleanup.push(() => clearTimeout(timeout));
      const unsubscribe = app.liveUpdates.subscribe((envelope) => {
        if (envelope.event.type === 'proxy.health.changed') {
          clearTimeout(timeout);
          unsubscribe();
          resolve(envelope.event.reason);
        }
      });
      cleanup.push(unsubscribe);
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/proxy-targets',
      headers: { cookie },
      payload: {
        chargerId: 'CHARGER-PROXY-LIVE',
        name: 'Live upstream',
        url: upstream.endpoint,
        enabled: true,
        mode: 'monitor-only',
        outagePolicy: 'fail-open'
      }
    });

    expect(created.statusCode).toBe(201);
    expect(await observed).toBe('connected');
  });
});

async function listen(app: LiveApp) {
  await app.listen({ host: '127.0.0.1', port: 0 });
}

function getPort(app: LiveApp) {
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a listening TCP server');
  }

  return address.port;
}

function getBaseUrl(app: LiveApp) {
  return `ws://127.0.0.1:${getPort(app)}/ocpp`;
}

async function login(app: LiveApp) {
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

function createSseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let buffer = '';

  return async function nextEvent() {
    while (true) {
      const separatorIndex = buffer.indexOf('\n\n');
      if (separatorIndex >= 0) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        return parseSseFrame(frame);
      }

      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error('SSE stream ended before the next event arrived');
      }

      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
}

function parseSseFrame(frame: string) {
  let event = '';
  let data = '';

  for (const line of frame.split('\n')) {
    if (line.startsWith('event: ')) {
      event = line.slice('event: '.length);
      continue;
    }
    if (line.startsWith('data: ')) {
      data += line.slice('data: '.length);
    }
  }

  return {
    event,
    data: data ? JSON.parse(data) as unknown : null
  };
}

async function startUpstreamProxyServer() {
  const server = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: false
  });
  server.auth((accept) => accept());
  server.on('client', (client) => {
    client.handle('BootNotification', () => ({
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 60
    }));
    client.handle('StatusNotification', () => ({}));
    client.handle('Heartbeat', () => ({
      currentTime: new Date().toISOString()
    }));
  });

  const httpServer = (await server.listen(0, '127.0.0.1')) as Server;
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected upstream server to listen on a TCP port');
  }

  return {
    endpoint: `ws://127.0.0.1:${address.port}`,
    close: () => server.close({})
  };
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
