import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargerProxyAssignments, proxySessionMappings, proxyTargets } from './db/schema.js';
import { recordLogEntry } from './log-writer.js';

const ModeSchema = z.enum(['monitor-only', 'deny-capable']);
const OutagePolicySchema = z.enum(['fail-open', 'fail-closed']);

const AssignmentListQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional(),
  proxyTargetId: z.string().trim().min(1).optional()
});

const CreateAssignmentSchema = z.object({
  chargerId: z.string().trim().min(1),
  proxyTargetId: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  stationId: z.string().trim().min(1).nullable().optional(),
  mode: ModeSchema.default('monitor-only'),
  outagePolicy: OutagePolicySchema.default('fail-open')
});

const UpdateAssignmentSchema = z.object({
  enabled: z.boolean().optional(),
  stationId: z.string().trim().min(1).nullable().optional(),
  mode: ModeSchema.optional(),
  outagePolicy: OutagePolicySchema.optional()
});

export function registerChargerProxyAssignmentRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/charger-proxy-assignments', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = AssignmentListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_assignment_query', details: parsed.error.flatten() });
    }

    const rows = db
      .select({
        assignment: chargerProxyAssignments,
        target: proxyTargets
      })
      .from(chargerProxyAssignments)
      .innerJoin(proxyTargets, eq(chargerProxyAssignments.proxyTargetId, proxyTargets.id))
      .all()
      .filter((row) => {
        if (parsed.data.chargerId && row.assignment.chargerId !== parsed.data.chargerId) return false;
        if (parsed.data.proxyTargetId && row.assignment.proxyTargetId !== parsed.data.proxyTargetId) return false;
        return true;
      })
      .map(({ assignment, target }) => toPublicAssignment(assignment, target));

    return rows;
  });

  app.post('/api/charger-proxy-assignments', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;

    const body = CreateAssignmentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_assignment', details: body.error.flatten() });
    }

    const target = db.select().from(proxyTargets).where(eq(proxyTargets.id, body.data.proxyTargetId)).limit(1).get();
    if (!target) {
      return reply.code(404).send({ error: 'proxy_target_not_found' });
    }

    const now = new Date();
    const id = randomUUID();
    const assignment = {
      id,
      chargerId: body.data.chargerId,
      proxyTargetId: body.data.proxyTargetId,
      enabled: body.data.enabled,
      stationId: body.data.stationId ?? null,
      mode: body.data.mode,
      outagePolicy: body.data.outagePolicy,
      createdAt: now,
      updatedAt: now
    };

    try {
      db.insert(chargerProxyAssignments).values(assignment).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'assignment_exists' });
      }
      throw error;
    }

    recordAssignmentLog(db, 'charger proxy assignment created', {
      assignmentId: id,
      chargerId: assignment.chargerId,
      proxyTargetId: assignment.proxyTargetId,
      enabled: assignment.enabled,
      mode: assignment.mode,
      outagePolicy: assignment.outagePolicy
    });

    return reply.code(201).send(toPublicAssignment(assignment, target));
  });

  app.patch<{ Params: { id: string } }>('/api/charger-proxy-assignments/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;

    const body = UpdateAssignmentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_assignment', details: body.error.flatten() });
    }

    const existing = db.select().from(chargerProxyAssignments).where(eq(chargerProxyAssignments.id, request.params.id)).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'assignment_not_found' });
    }

    if (hasActiveProxyMappings(db, existing.chargerId, existing.proxyTargetId)) {
      return reply.code(409).send({ error: 'assignment_has_active_sessions' });
    }

    const target = db.select().from(proxyTargets).where(eq(proxyTargets.id, existing.proxyTargetId)).limit(1).get();
    if (!target) {
      return reply.code(404).send({ error: 'proxy_target_not_found' });
    }

    const update = {
      enabled: body.data.enabled ?? existing.enabled,
      stationId: body.data.stationId === undefined ? existing.stationId : body.data.stationId || null,
      mode: body.data.mode ?? existing.mode,
      outagePolicy: body.data.outagePolicy ?? existing.outagePolicy,
      updatedAt: new Date()
    };

    try {
      db.update(chargerProxyAssignments).set(update).where(eq(chargerProxyAssignments.id, request.params.id)).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'assignment_exists' });
      }
      throw error;
    }

    recordAssignmentLog(db, 'charger proxy assignment updated', {
      assignmentId: request.params.id,
      chargerId: existing.chargerId,
      proxyTargetId: existing.proxyTargetId,
      enabled: update.enabled,
      mode: update.mode,
      outagePolicy: update.outagePolicy
    });

    return toPublicAssignment({ ...existing, ...update }, target);
  });

  app.delete<{ Params: { id: string } }>('/api/charger-proxy-assignments/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;

    const existing = db.select().from(chargerProxyAssignments).where(eq(chargerProxyAssignments.id, request.params.id)).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'assignment_not_found' });
    }

    if (hasActiveProxyMappings(db, existing.chargerId, existing.proxyTargetId)) {
      return reply.code(409).send({ error: 'assignment_has_active_sessions' });
    }

    db.delete(chargerProxyAssignments).where(eq(chargerProxyAssignments.id, request.params.id)).run();
    recordAssignmentLog(db, 'charger proxy assignment deleted', {
      assignmentId: request.params.id,
      chargerId: existing.chargerId,
      proxyTargetId: existing.proxyTargetId
    });

    return { ok: true };
  });
}

function toPublicAssignment(
  assignment: typeof chargerProxyAssignments.$inferSelect,
  target: typeof proxyTargets.$inferSelect
) {
  return {
    id: assignment.id,
    chargerId: assignment.chargerId,
    proxyTargetId: assignment.proxyTargetId,
    proxyTargetName: target.name,
    enabled: assignment.enabled,
    stationId: assignment.stationId,
    mode: assignment.mode,
    outagePolicy: assignment.outagePolicy,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString()
  };
}

function recordAssignmentLog(db: Database, message: string, metadata: Record<string, unknown>) {
  recordLogEntry(db, undefined, {
    level: 'info',
    category: 'proxy',
    message,
    metadata
  });
}

function hasActiveProxyMappings(db: Database, chargerId: string, proxyTargetId: string) {
  return Boolean(
    db
      .select({ id: proxySessionMappings.id })
      .from(proxySessionMappings)
      .where(
        and(
          eq(proxySessionMappings.chargerId, chargerId),
          eq(proxySessionMappings.proxyTargetId, proxyTargetId),
          isNull(proxySessionMappings.stoppedAt)
        )
      )
      .limit(1)
      .get()
  );
}
