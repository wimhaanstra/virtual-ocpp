import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { appSettings, communicationJournal, onboardingSettings } from '../src/db/schema.js';
import { createTestDatabase, testConfig } from './support/test-utils.js';

describe('onboarding settings api', () => {
  let closeDb: (() => void) | undefined;

  afterEach(() => {
    closeDb?.();
    closeDb = undefined;
  });

  it('requires admin auth', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config: testConfig(), db: tempDb.db });

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/onboarding'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });

    const communicationResponse = await app.inject({
      method: 'GET',
      url: '/api/settings/communication'
    });
    expect(communicationResponse.statusCode).toBe(401);

    await app.close();
  });

  it('returns the default onboarding state and persists completion, skip, and reset updates', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);
    const initial = await app.inject({
      method: 'GET',
      url: '/api/settings/onboarding',
      headers: { cookie }
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({
      completed: false,
      completedAt: null,
      skippedAt: null
    });

    const completed = await app.inject({
      method: 'PATCH',
      url: '/api/settings/onboarding',
      headers: { cookie },
      payload: {
        completed: true
      }
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      completed: true,
      completedAt: expect.any(String),
      skippedAt: null
    });
    expect(tempDb.db.select().from(onboardingSettings).all()).toEqual([
      expect.objectContaining({
        id: 'onboarding',
        completedAt: expect.any(Date),
        skippedAt: null
      })
    ]);

    const skipped = await app.inject({
      method: 'PATCH',
      url: '/api/settings/onboarding',
      headers: { cookie },
      payload: {
        skipped: true
      }
    });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json()).toMatchObject({
      completed: false,
      completedAt: null,
      skippedAt: expect.any(String)
    });
    expect(tempDb.db.select().from(onboardingSettings).all()).toEqual([
      expect.objectContaining({
        id: 'onboarding',
        completedAt: null,
        skippedAt: expect.any(Date)
      })
    ]);

    const reset = await app.inject({
      method: 'PATCH',
      url: '/api/settings/onboarding',
      headers: { cookie },
      payload: {
        reset: true
      }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({
      completed: false,
      completedAt: null,
      skippedAt: null
    });
    expect(tempDb.db.select().from(onboardingSettings).all()).toEqual([
      expect.objectContaining({
        id: 'onboarding',
        completedAt: null,
        skippedAt: null
      })
    ]);

    await app.close();
  });

  it('rejects invalid onboarding payloads', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);

    const invalidPayloads = [
      {},
      { completed: false },
      { skipped: false },
      { reset: false },
      { completed: true, skipped: true },
      { completed: true, reset: true },
      { completed: true, extra: true }
    ];

    for (const payload of invalidPayloads) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/onboarding',
        headers: { cookie },
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'invalid_onboarding_settings' });
    }

    expect(tempDb.db.select().from(onboardingSettings).all()).toHaveLength(0);

    await app.close();
  });

  it('returns and updates communication settings', async () => {
    const tempDb = createTestDatabase();
    closeDb = tempDb.close;
    const app = await buildApp({ config: testConfig(), db: tempDb.db });
    const cookie = await login(app);
    const journalCreatedAt = new Date('2026-06-20T10:00:00.000Z');
    tempDb.db
      .insert(communicationJournal)
      .values({
        id: randomUUID(),
        createdAt: journalCreatedAt,
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: 'CHARGER-1',
        targetType: 'server',
        targetId: 'server',
        chargerId: 'CHARGER-1',
        proxyTargetId: null,
        messageType: 'call',
        ocppMethod: 'Heartbeat',
        transactionId: null,
        idTag: null,
        payloadJson: '{}',
        errorCode: null,
        errorDescription: null,
        correlationId: null
      })
      .run();

    const initial = await app.inject({
      method: 'GET',
      url: '/api/settings/communication',
      headers: { cookie }
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({
      retentionHours: 24,
      defaultRetentionHours: 24,
      storage: {
        rowCount: 1,
        oldestCreatedAt: journalCreatedAt.toISOString(),
        newestCreatedAt: journalCreatedAt.toISOString(),
        retentionHours: 24
      },
      lastPurge: {
        purgedAt: expect.any(String),
        deletedCount: 0,
        retentionHours: 24,
        scope: 'retention'
      }
    });

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/settings/communication',
      headers: { cookie },
      payload: { retentionHours: 72 }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      retentionHours: 72,
      defaultRetentionHours: 24,
      storage: {
        rowCount: 1,
        oldestCreatedAt: journalCreatedAt.toISOString(),
        newestCreatedAt: journalCreatedAt.toISOString(),
        retentionHours: 72
      },
      lastPurge: {
        purgedAt: expect.any(String),
        deletedCount: 0,
        retentionHours: 24,
        scope: 'retention'
      }
    });
    expect(tempDb.db.select().from(appSettings).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'communication.lastPurge',
        value: expect.stringContaining('"deletedCount":0'),
        updatedAt: expect.any(Date)
      }),
      expect.objectContaining({
        key: 'communication.retentionHours',
        value: '72',
        updatedAt: expect.any(Date)
      })
    ]));

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/settings/communication',
      headers: { cookie },
      payload: { retentionHours: 0 }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'invalid_communication_settings' });

    await app.close();
  });
});

async function login(app: FastifyInstance) {
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
    throw new Error('missing session cookie');
  }

  return Array.isArray(cookie) ? cookie[0].split(';')[0] : cookie.split(';')[0];
}
