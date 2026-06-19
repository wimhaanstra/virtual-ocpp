import { randomUUID } from 'node:crypto';
import RawDatabase from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.js';
import { communicationJournal } from './db/schema.js';
import { createDatabase } from './db/client.js';
import { CommunicationJournalService, redactCommunicationPayload } from './communication-journal.js';
import { createTestDatabase, testConfig } from './test-utils.js';

describe('communication journal', () => {
  let closeDb: (() => void) | undefined;

  afterEach(() => {
    closeDb?.();
    closeDb = undefined;
  });

  it('requires admin auth for journal reads and purge', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config: testConfig(), db: tempDb.db });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/communication-journal'
    });
    const purgeResponse = await app.inject({
      method: 'POST',
      url: '/api/communication-journal/purge'
    });

    expect(listResponse.statusCode).toBe(401);
    expect(listResponse.json()).toEqual({ error: 'unauthorized' });
    expect(purgeResponse.statusCode).toBe(401);
    expect(purgeResponse.json()).toEqual({ error: 'unauthorized' });

    await app.close();
  });

  it('redacts nested secrets and filters journal rows', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;

    const journal = new CommunicationJournalService(tempDb.db, 24);
    const createdAt = new Date('2026-06-19T10:00:00.000Z');
    expect(
      redactCommunicationPayload({
        password: 'root-secret',
        nested: {
          token: 'abc123',
          list: [
            {
              authorization: 'bearer abc123'
            }
          ]
        }
      })
    ).toEqual({
      password: '[redacted]',
      nested: {
        token: '[redacted]',
        list: [
          {
            authorization: '[redacted]'
          }
        ]
      }
    });

    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-1',
      ocppMethod: 'Authorize',
      payload: {
        idTag: 'TAG-001',
        authorization: {
          token: 'secret-token',
          nested: [
            {
              password: 'super-secret'
            }
          ]
        }
      },
      createdAt
    });

    journal.recordEntry({
      direction: 'outbound',
      sourceType: 'proxy',
      sourceId: 'proxy-target',
      targetType: 'server',
      targetId: 'server',
      messageType: 'callResult',
      chargerId: 'CHARGER-1',
      proxyTargetId: 'proxy-target',
      ocppMethod: 'Authorize',
      payload: {
        idTagInfo: {
          status: 'Accepted'
        }
      },
      createdAt: new Date('2026-06-19T10:05:00.000Z')
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/communication-journal?sourceType=charger&ocppMethod=Authorize&messageType=call&limit=10',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: expect.any(String),
          createdAt: '2026-06-19T10:00:00.000Z',
          direction: 'inbound',
          sourceType: 'charger',
          sourceId: 'CHARGER-1',
          targetType: 'server',
          targetId: 'server',
          chargerId: 'CHARGER-1',
          proxyTargetId: null,
          messageType: 'call',
          ocppMethod: 'Authorize',
          transactionId: null,
          idTag: null,
          payload: {
          idTag: 'TAG-001',
          authorization: '[redacted]'
        },
          errorCode: null,
          errorDescription: null,
          correlationId: null
        }
      ],
      retentionHours: 24
    });
    expect(response.body).not.toContain('secret-token');
    expect(response.body).not.toContain('super-secret');

    await app.close();
  });

  it('purges stale rows on startup and via the admin endpoint', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const staleRowId = randomUUID();
    const freshRowId = randomUUID();
    const now = Date.now();
    const staleDate = new Date(now - 25 * 60 * 60 * 1000);
    const freshDate = new Date(now - 60 * 60 * 1000);

    tempDb.db.insert(communicationJournal).values([
      {
        id: staleRowId,
        createdAt: staleDate,
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: 'CHARGER-OLD',
        targetType: 'server',
        targetId: 'server',
        chargerId: 'CHARGER-OLD',
        proxyTargetId: null,
        messageType: 'call',
        ocppMethod: 'Heartbeat',
        transactionId: null,
        idTag: null,
        payloadJson: '{"ok":true}',
        errorCode: null,
        errorDescription: null,
        correlationId: null
      },
      {
        id: freshRowId,
        createdAt: freshDate,
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: 'CHARGER-NEW',
        targetType: 'server',
        targetId: 'server',
        chargerId: 'CHARGER-NEW',
        proxyTargetId: null,
        messageType: 'call',
        ocppMethod: 'Heartbeat',
        transactionId: null,
        idTag: null,
        payloadJson: '{"ok":true}',
        errorCode: null,
        errorDescription: null,
        correlationId: null
      }
    ]).run();

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);

    expect(tempDb.db.select().from(communicationJournal).all().map((row) => row.id)).toEqual([freshRowId]);

    tempDb.db.insert(communicationJournal).values({
      id: staleRowId,
      createdAt: staleDate,
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-OLD-2',
      targetType: 'server',
      targetId: 'server',
      chargerId: 'CHARGER-OLD-2',
      proxyTargetId: null,
      messageType: 'call',
      ocppMethod: 'Heartbeat',
      transactionId: null,
      idTag: null,
      payloadJson: '{"ok":true}',
      errorCode: null,
      errorDescription: null,
      correlationId: null
    }).run();

    const purgeResponse = await app.inject({
      method: 'POST',
      url: '/api/communication-journal/purge',
      headers: { cookie }
    });

    expect(purgeResponse.statusCode).toBe(200);
    expect(purgeResponse.json()).toEqual({
      ok: true,
      deletedCount: 1,
      retentionHours: 24
    });
    expect(tempDb.db.select().from(communicationJournal).all()).toHaveLength(1);

    await app.close();
  });

  it('can start against an existing database before the communication journal migration has run', async () => {
    const sqlitePath = join(tmpdir(), `virtual-ocpp-premigration-${randomUUID()}.sqlite`);
    const rawDb = new RawDatabase(sqlitePath);
    rawDb.exec(`
      CREATE TABLE sessions (
        id text PRIMARY KEY NOT NULL,
        username text NOT NULL,
        created_at integer NOT NULL,
        expires_at integer NOT NULL,
        revoked_at integer
      );
    `);
    rawDb.close();

    const db = createDatabase(testConfig({ sqlitePath }));
    const app = await buildApp({ config: testConfig({ sqlitePath }), db });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await app.close();
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
