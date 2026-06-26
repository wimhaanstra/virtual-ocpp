import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import { getTenantId, requireAdmin, verifyAdminPassword } from './auth.js';
import type { Database } from './db/client.js';
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
  tagChargerAccess
} from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';
import { recordLogEntry } from './log-writer.js';
import type { ProxyAuthorizationService } from './ocpp/proxy-service.js';
import type { ChargerCommandService } from './ocpp/charger-command-service.js';
import { OcppRepository } from './ocpp/repository.js';

const ListChargersQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

const UpdateChargerSchema = z.object({
  label: z.string().trim().min(1).max(120).nullable().optional(),
  enabled: z.boolean().optional()
});

const DeleteChargerSchema = z.object({
  adminPassword: z.string().min(1),
  chargerIdConfirmation: z.string().trim().min(1)
});
const ScanMeterGapsSchema = z.object({
  thresholdWh: z.coerce.number().int().positive().optional()
});

type ChargerConnectionState = 'connected' | 'recently_seen' | 'silent' | 'disabled';

export function registerChargerRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  liveUpdates?: LiveUpdateBus,
  chargerCommands?: ChargerCommandService,
  proxyAuthorization?: ProxyAuthorizationService
) {
  app.get('/api/chargers', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;
    const tenantId = getTenantId(request);

    const parsed = ListChargersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_charger_query', details: parsed.error.flatten() });
    }

    const rows = db
      .select()
      .from(chargers)
      .where(eq(chargers.tenantId, tenantId))
      .orderBy(desc(chargers.lastSeenAt))
      .all()
      .filter((row) => {
        if (parsed.data.chargerId && row.id !== parsed.data.chargerId) return false;
        return true;
      });

    return rows.map((charger) => {
      const activeConnection = db
        .select()
        .from(chargerConnections)
        .where(and(eq(chargerConnections.chargerId, charger.id), isNull(chargerConnections.disconnectedAt)))
        .orderBy(desc(chargerConnections.connectedAt))
        .limit(1)
        .get();
      const lastMessageAt = charger.lastSeenAt;
      const connectionState = getChargerConnectionState({
        enabled: charger.enabled,
        active: Boolean(activeConnection),
        lastMessageAt,
        silentAfterMs: config.chargerSilentAfterSeconds * 1000
      });
      const connectionWarning = getChargerConnectionWarning(connectionState, lastMessageAt);

      return {
        id: charger.id,
        label: charger.label,
        enabled: charger.enabled,
        firstSeenAt: charger.firstSeenAt.toISOString(),
        lastSeenAt: charger.lastSeenAt.toISOString(),
        lastBootAt: charger.lastBootAt?.toISOString() ?? null,
        chargePointVendor: charger.chargePointVendor,
        chargePointModel: charger.chargePointModel,
        firmwareVersion: charger.firmwareVersion,
        active: Boolean(activeConnection),
        activeConnectionId: activeConnection?.id ?? null,
        connectedAt: activeConnection?.connectedAt.toISOString() ?? null,
        disconnectedAt: activeConnection?.disconnectedAt?.toISOString() ?? null,
        connectionState,
        lastMessageAt: lastMessageAt.toISOString(),
        connectionWarning,
        createdAt: charger.createdAt.toISOString(),
        updatedAt: charger.updatedAt.toISOString()
      };
    });
  });

  app.patch<{ Params: { id: string } }>('/api/chargers/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;
    const tenantId = getTenantId(request);

    const body = UpdateChargerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_charger', details: body.error.flatten() });
    }

    const existing = db.select().from(chargers).where(and(eq(chargers.tenantId, tenantId), eq(chargers.id, request.params.id))).limit(1).get();
    if (!existing) {
      return reply.code(404).send({ error: 'charger_not_found' });
    }

    const update = {
      label: body.data.label === undefined ? existing.label : body.data.label,
      enabled: body.data.enabled ?? existing.enabled,
      updatedAt: new Date()
    };

    db.update(chargers).set(update).where(and(eq(chargers.tenantId, tenantId), eq(chargers.id, request.params.id))).run();

    recordLogEntry(db, liveUpdates, {
      level: 'info',
      category: 'charger',
      message: 'charger updated',
      chargerId: request.params.id,
      metadata: {
        enabled: update.enabled,
        label: update.label
      }
    });
    liveUpdates?.publish({
      type: 'charger.updated',
      chargerId: request.params.id,
      updatedAt: update.updatedAt.toISOString(),
      reason: 'admin_update'
    });

    return {
      id: request.params.id,
      label: update.label,
      enabled: update.enabled,
      firstSeenAt: existing.firstSeenAt.toISOString(),
      lastSeenAt: existing.lastSeenAt.toISOString(),
      lastBootAt: existing.lastBootAt?.toISOString() ?? null,
      chargePointVendor: existing.chargePointVendor,
      chargePointModel: existing.chargePointModel,
      firmwareVersion: existing.firmwareVersion,
      createdAt: existing.createdAt.toISOString(),
      updatedAt: update.updatedAt.toISOString()
    };
  });

  app.post<{ Params: { id: string } }>('/api/chargers/:id/meter-gaps/scan', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;
    const tenantId = getTenantId(request);

    const body = ScanMeterGapsSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_meter_gap_scan', details: body.error.flatten() });
    }

    const charger = db.select().from(chargers).where(and(eq(chargers.tenantId, tenantId), eq(chargers.id, request.params.id))).limit(1).get();
    if (!charger) {
      return reply.code(404).send({ error: 'charger_not_found' });
    }

    const thresholdWh = body.data.thresholdWh ?? config.meterGapThresholdWh;
    const repository = new OcppRepository(db, undefined, liveUpdates);
    const result = repository.scanMeterGaps({
      chargerId: request.params.id,
      thresholdWh
    });

    recordLogEntry(db, liveUpdates, {
      level: result.created > 0 ? 'warn' : 'info',
      category: 'session',
      message: 'manual meter gap scan completed',
      chargerId: request.params.id,
      metadata: {
        thresholdWh,
        ...result
      }
    });
    liveUpdates?.publish('charging-stats', request.params.id);

    return {
      chargerId: request.params.id,
      thresholdWh,
      ...result
    };
  });

  app.delete<{ Params: { id: string } }>('/api/chargers/:id', async (request, reply) => {
    if (await requireAdmin(request, reply, db, 'write')) return;
    const tenantId = getTenantId(request);

    const body = DeleteChargerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_charger_delete', details: body.error.flatten() });
    }

    if (body.data.chargerIdConfirmation !== request.params.id) {
      return reply.code(409).send({ error: 'charger_id_confirmation_mismatch' });
    }

    if (!verifyAdminPassword(config, body.data.adminPassword)) {
      recordLogEntry(db, liveUpdates, {
        level: 'warn',
        category: 'auth',
        message: 'charger delete admin password rejected',
        metadata: { chargerId: request.params.id }
      });
      return reply.code(403).send({ error: 'invalid_admin_password' });
    }

    const charger = db.select().from(chargers).where(and(eq(chargers.tenantId, tenantId), eq(chargers.id, request.params.id))).limit(1).get();
    if (!charger) {
      return reply.code(404).send({ error: 'charger_not_found' });
    }

    const proxyTargetIds = db
      .select({ id: proxyTargets.id })
      .from(proxyTargets)
      .where(and(eq(proxyTargets.tenantId, tenantId), eq(proxyTargets.chargerId, request.params.id)))
      .all()
      .map((row) => row.id);

    await chargerCommands?.closeCharger(request.params.id, 'charger deleted by admin');
    await Promise.allSettled(
      proxyTargetIds.map((proxyTargetId) =>
        proxyAuthorization?.invalidateTarget(request.params.id, proxyTargetId, 'charger deleted by admin')
      )
    );

    const now = new Date();
    const deletedCounts = db.transaction((tx) => {
      const counts = {
        chargerProxyAssignments: tx.delete(chargerProxyAssignments).where(and(eq(chargerProxyAssignments.tenantId, tenantId), eq(chargerProxyAssignments.chargerId, request.params.id))).run().changes,
        tagChargerAccess: tx.delete(tagChargerAccess).where(and(eq(tagChargerAccess.tenantId, tenantId), eq(tagChargerAccess.chargerId, request.params.id))).run().changes,
        proxySessionMappings: tx.delete(proxySessionMappings).where(and(eq(proxySessionMappings.tenantId, tenantId), eq(proxySessionMappings.chargerId, request.params.id))).run().changes,
        chargingSessions: tx.delete(chargingSessions).where(and(eq(chargingSessions.tenantId, tenantId), eq(chargingSessions.chargerId, request.params.id))).run().changes,
        meterSamples: tx.delete(meterSamples).where(and(eq(meterSamples.tenantId, tenantId), eq(meterSamples.chargerId, request.params.id))).run().changes,
        chargerConnections: tx.delete(chargerConnections).where(and(eq(chargerConnections.tenantId, tenantId), eq(chargerConnections.chargerId, request.params.id))).run().changes,
        logs: tx.delete(logs).where(and(eq(logs.tenantId, tenantId), eq(logs.chargerId, request.params.id))).run().changes,
        communicationJournal: tx
          .delete(communicationJournal)
          .where(
            and(
              eq(communicationJournal.tenantId, tenantId),
              or(
                eq(communicationJournal.chargerId, request.params.id),
                proxyTargetIds.length > 0 ? inArray(communicationJournal.proxyTargetId, proxyTargetIds) : eq(communicationJournal.proxyTargetId, '__never__')
              )
            )
          )
          .run().changes,
        proxyTagMappings: proxyTargetIds.length
          ? tx.delete(proxyTagMappings).where(and(eq(proxyTagMappings.tenantId, tenantId), inArray(proxyTagMappings.proxyTargetId, proxyTargetIds))).run().changes
          : 0,
        proxyTargets: tx.delete(proxyTargets).where(and(eq(proxyTargets.tenantId, tenantId), eq(proxyTargets.chargerId, request.params.id))).run().changes,
        chargers: tx.delete(chargers).where(and(eq(chargers.tenantId, tenantId), eq(chargers.id, request.params.id))).run().changes
      };

      return counts;
    });

    recordLogEntry(db, liveUpdates, {
      level: 'warn',
      category: 'charger',
      message: 'charger deleted',
      metadata: {
        chargerId: request.params.id,
        label: charger.label,
        deletedCounts,
        proxyTargetsClosed: proxyTargetIds.length
      },
      createdAt: now
    });

    liveUpdates?.publish({
      type: 'charger.updated',
      chargerId: request.params.id,
      updatedAt: now.toISOString(),
      reason: 'admin_delete'
    });
    liveUpdates?.publish('proxy-targets', request.params.id);
    liveUpdates?.publish('proxy-health', request.params.id);
    liveUpdates?.publish('sessions', request.params.id);
    liveUpdates?.publish('charging-stats', request.params.id);
    liveUpdates?.publish('tags', request.params.id);
    liveUpdates?.publish('communication', request.params.id);

    return { ok: true, chargerId: request.params.id, deleted: deletedCounts };
  });
}

function getChargerConnectionState(input: {
  enabled: boolean;
  active: boolean;
  lastMessageAt: Date;
  silentAfterMs: number;
}): ChargerConnectionState {
  if (!input.enabled) return 'disabled';
  if (input.active) return 'connected';

  const ageMs = Date.now() - input.lastMessageAt.getTime();
  if (ageMs <= input.silentAfterMs) return 'recently_seen';

  return 'silent';
}

function getChargerConnectionWarning(state: ChargerConnectionState, lastMessageAt: Date) {
  if (state !== 'silent') return null;

  return {
    code: 'no_recent_ocpp_traffic',
    severity: 'warn',
    message: 'No recent OCPP traffic received. Check that OCPP is enabled on the charger, the URL and station id are correct, and the charger can reach this server.',
    lastMessageAt: lastMessageAt.toISOString()
  };
}
