import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { CommunicationJournalService } from './communication-journal.js';
import type { Database } from './db/client.js';
import { appSettings, onboardingSettings } from './db/schema.js';

const SingletonSettingsId = 'onboarding';
const CommunicationRetentionKey = 'communication.retentionHours';
const DefaultCommunicationRetentionHours = 24;
const MaxCommunicationRetentionHours = 8760;

const UpdateOnboardingSettingsSchema = z
  .object({
    completed: z.literal(true).optional(),
    skipped: z.literal(true).optional(),
    reset: z.literal(true).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(Boolean(value.completed)) + Number(Boolean(value.skipped)) + Number(Boolean(value.reset)) !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Set exactly one onboarding action'
      });
    }
  });

const UpdateCommunicationSettingsSchema = z
  .object({
    retentionHours: z.coerce.number().int().min(1).max(MaxCommunicationRetentionHours)
  })
  .strict();

export function registerSettingsRoutes(app: FastifyInstance, db: Database, journal?: CommunicationJournalService) {
  app.get('/api/settings/onboarding', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    return getOnboardingSettings(db);
  });

  app.patch('/api/settings/onboarding', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = UpdateOnboardingSettingsSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_onboarding_settings', details: body.error.flatten() });
    }

    const now = new Date();
    const patch = body.data.completed
      ? {
          completedAt: now,
          skippedAt: null
        }
      : body.data.skipped
        ? {
            completedAt: null,
            skippedAt: now
          }
        : {
            completedAt: null,
            skippedAt: null
          };

    const existing = db.select().from(onboardingSettings).where(eq(onboardingSettings.id, SingletonSettingsId)).limit(1).get();
    if (existing) {
      db.update(onboardingSettings).set(patch).where(eq(onboardingSettings.id, SingletonSettingsId)).run();
    } else {
      db.insert(onboardingSettings)
        .values({
          id: SingletonSettingsId,
          ...patch
        })
        .run();
    }

    return serializeOnboardingSettings({
      id: SingletonSettingsId,
      ...patch
    });
  });

  app.get('/api/settings/communication', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    return getCommunicationSettings(db, journal);
  });

  app.patch('/api/settings/communication', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const body = UpdateCommunicationSettingsSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_communication_settings', details: body.error.flatten() });
    }

    const now = new Date();
    const value = String(body.data.retentionHours);
    const existing = db.select().from(appSettings).where(eq(appSettings.key, CommunicationRetentionKey)).limit(1).get();
    if (existing) {
      db.update(appSettings).set({ value, updatedAt: now }).where(eq(appSettings.key, CommunicationRetentionKey)).run();
    } else {
      db.insert(appSettings).values({ key: CommunicationRetentionKey, value, updatedAt: now }).run();
    }

    return getCommunicationSettings(db, journal);
  });
}

export function getCommunicationRetentionHours(db: Database) {
  const row = db.select().from(appSettings).where(eq(appSettings.key, CommunicationRetentionKey)).limit(1).get();
  const parsed = Number(row?.value ?? DefaultCommunicationRetentionHours);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MaxCommunicationRetentionHours ? parsed : DefaultCommunicationRetentionHours;
}

function getCommunicationSettings(db: Database, journal?: CommunicationJournalService) {
  return {
    retentionHours: getCommunicationRetentionHours(db),
    defaultRetentionHours: DefaultCommunicationRetentionHours,
    storage: journal?.getStorageSummary() ?? null,
    lastPurge: journal?.getLastPurgeSummary() ?? null
  };
}

function getOnboardingSettings(db: Database) {
  const row = db.select().from(onboardingSettings).where(eq(onboardingSettings.id, SingletonSettingsId)).limit(1).get();
  return serializeOnboardingSettings(row ?? null);
}

function serializeOnboardingSettings(
  row: typeof onboardingSettings.$inferSelect | null
): {
  completed: boolean;
  completedAt: string | null;
  skippedAt: string | null;
} {
  return {
    completed: Boolean(row?.completedAt),
    completedAt: row?.completedAt?.toISOString() ?? null,
    skippedAt: row?.skippedAt?.toISOString() ?? null
  };
}
