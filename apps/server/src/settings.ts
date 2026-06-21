import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { onboardingSettings } from './db/schema.js';

const SingletonSettingsId = 'onboarding';

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

export function registerSettingsRoutes(app: FastifyInstance, db: Database) {
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
