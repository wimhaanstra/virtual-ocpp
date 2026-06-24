import { randomUUID } from 'node:crypto';
import RawDatabase from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.js';
import { communicationJournal } from '../src/db/schema.js';
import { createDatabase } from '../src/db/client.js';
import { CommunicationJournalService, redactCommunicationPayload } from '../src/communication-journal.js';
import { createTestDatabase, testConfig } from './support/test-utils.js';

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
    const createdAt = new Date(Date.now() - 60_000);
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
      createdAt: new Date(createdAt.getTime() + 5_000)
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
          createdAt: createdAt.toISOString(),
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
      retentionHours: 24,
      nextCursor: null,
      hasMore: false
    });
    expect(response.body).not.toContain('secret-token');
    expect(response.body).not.toContain('super-secret');

    await app.close();
  });

  it('rejects invalid journal dates', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);

    const invalidDate = await app.inject({
      method: 'GET',
      url: '/api/communication-journal?from=not-a-date',
      headers: { cookie }
    });
    const invertedRange = await app.inject({
      method: 'GET',
      url: `/api/communication-journal?from=${encodeURIComponent(new Date('2026-01-02T00:00:00Z').toISOString())}&to=${encodeURIComponent(new Date('2026-01-01T00:00:00Z').toISOString())}`,
      headers: { cookie }
    });

    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.json()).toEqual({ error: 'invalid_communication_journal_query' });
    expect(invertedRange.statusCode).toBe(400);
    expect(invertedRange.json()).toEqual({ error: 'invalid_communication_journal_query' });

    await app.close();
  });

  it('paginates journal rows with a stable cursor', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const journal = new CommunicationJournalService(tempDb.db, 24);
    const createdAt = new Date(Date.now() - 60_000);

    for (let index = 0; index < 3; index += 1) {
      journal.recordEntry({
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: 'CHARGER-1',
        targetType: 'server',
        targetId: 'server',
        messageType: 'call',
        chargerId: 'CHARGER-1',
        ocppMethod: `Method${index}`,
        payload: {},
        createdAt: new Date(createdAt.getTime() + index * 1_000)
      });
    }

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);
    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/communication-journal?chargerId=CHARGER-1&limit=2',
      headers: { cookie }
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      hasMore: true,
      nextCursor: expect.any(String)
    });
    expect(firstPage.json().items.map((item: { ocppMethod: string }) => item.ocppMethod)).toEqual(['Method2', 'Method1']);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/communication-journal?chargerId=CHARGER-1&limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
      headers: { cookie }
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({
      hasMore: false,
      nextCursor: null
    });
    expect(secondPage.json().items.map((item: { ocppMethod: string }) => item.ocppMethod)).toEqual(['Method0']);

    await app.close();
  });

  it('filters journal rows by transaction id', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;

    const journal = new CommunicationJournalService(tempDb.db, 24);
    const createdAt = new Date(Date.now() - 60_000);

    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-1',
      ocppMethod: 'StartTransaction',
      transactionId: 42,
      payload: { transactionId: 42 },
      createdAt
    });
    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-1',
      ocppMethod: 'Heartbeat',
      transactionId: null,
      payload: {},
      createdAt: new Date(createdAt.getTime() + 1_000)
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/communication-journal?transactionId=42',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({
      ocppMethod: 'StartTransaction',
      transactionId: 42
    });

    await app.close();
  });

  it('filters journal rows by partial OCPP method', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const journal = new CommunicationJournalService(tempDb.db, 24);
    const createdAt = new Date(Date.now() - 60_000);

    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-1',
      ocppMethod: 'Heartbeat',
      payload: {},
      createdAt
    });
    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-1',
      ocppMethod: 'BootNotification',
      payload: {},
      createdAt: new Date(createdAt.getTime() + 1_000)
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/communication-journal?ocppMethod=heart',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({
      ocppMethod: 'Heartbeat'
    });

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
      retentionHours: 24,
      scope: 'retention'
    });
    expect(tempDb.db.select().from(communicationJournal).all()).toHaveLength(1);

    await app.close();
  });

  it('exports filtered redacted journal rows as CSV', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const journal = new CommunicationJournalService(tempDb.db, 24);
    const createdAt = new Date(Date.now() - 60_000);

    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-1',
      ocppMethod: 'Authorize',
      payload: { password: 'secret-password', idTag: 'TAG-1' },
      createdAt
    });
    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-2',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-2',
      ocppMethod: 'Heartbeat',
      payload: {},
      createdAt
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/communication-journal/export?chargerId=CHARGER-1&ocppMethod=Authorize',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('communication-journal-');
    expect(response.body).toContain('createdAt,direction,sourceType');
    expect(response.body).toContain('CHARGER-1');
    expect(response.body).toContain('[redacted]');
    expect(response.body).not.toContain('secret-password');
    expect(response.body).not.toContain('CHARGER-2');

    await app.close();
  });

  it('requires confirmation and explicit scope for filtered journal purge', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const journal = new CommunicationJournalService(tempDb.db, 24);
    const createdAt = new Date(Date.now() - 60_000);

    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-1',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-1',
      ocppMethod: 'Authorize',
      payload: {},
      createdAt
    });
    journal.recordEntry({
      direction: 'inbound',
      sourceType: 'charger',
      sourceId: 'CHARGER-2',
      targetType: 'server',
      targetId: 'server',
      messageType: 'call',
      chargerId: 'CHARGER-2',
      ocppMethod: 'Heartbeat',
      payload: {},
      createdAt
    });

    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);
    const missingConfirmation = await app.inject({
      method: 'POST',
      url: '/api/communication-journal/purge',
      headers: { cookie },
      payload: { scope: 'filters', filters: { chargerId: 'CHARGER-1' } }
    });
    const emptyScope = await app.inject({
      method: 'POST',
      url: '/api/communication-journal/purge',
      headers: { cookie },
      payload: { scope: 'filters', confirm: 'PURGE', filters: {} }
    });
    const purgeResponse = await app.inject({
      method: 'POST',
      url: '/api/communication-journal/purge',
      headers: { cookie },
      payload: { scope: 'filters', confirm: 'PURGE', filters: { chargerId: 'CHARGER-1' } }
    });

    expect(missingConfirmation.statusCode).toBe(400);
    expect(missingConfirmation.json()).toEqual({ error: 'purge_confirmation_required' });
    expect(emptyScope.statusCode).toBe(400);
    expect(emptyScope.json()).toEqual({ error: 'invalid_communication_journal_purge' });
    expect(purgeResponse.statusCode).toBe(200);
    expect(purgeResponse.json()).toEqual({
      ok: true,
      deletedCount: 1,
      retentionHours: 24,
      scope: 'filters'
    });
    expect(tempDb.db.select().from(communicationJournal).all()).toHaveLength(1);
    expect(tempDb.db.select().from(communicationJournal).all()[0]?.chargerId).toBe('CHARGER-2');

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
