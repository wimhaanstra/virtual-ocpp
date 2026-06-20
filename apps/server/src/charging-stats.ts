import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import type { Database } from './db/client.js';
import { chargingSessions, meterSamples } from './db/schema.js';

const RECENT_SESSION_LIMIT = 20;

const ChargingStatsQuerySchema = z.object({
  chargerId: z.string().trim().min(1).optional()
});

type MeterSampleRow = typeof meterSamples.$inferSelect;

export function registerChargingStatsRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/charging-stats', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const parsed = ChargingStatsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_charging_stats_query', details: parsed.error.flatten() });
    }

    const query = db.select().from(chargingSessions);
    const rows = parsed.data.chargerId
      ? query
          .where(and(eq(chargingSessions.status, 'active'), eq(chargingSessions.chargerId, parsed.data.chargerId)))
          .orderBy(desc(chargingSessions.startedAt))
          .limit(RECENT_SESSION_LIMIT)
          .all()
      : query.where(eq(chargingSessions.status, 'active')).orderBy(desc(chargingSessions.startedAt)).limit(RECENT_SESSION_LIMIT).all();

    return rows.map((session) => {
      const latestEnergy = latestSampleForSession(db, session.chargerId, session.transactionId, 'Energy.Active.Import.Register', {
        includePhaseScopedFallback: true
      });
      const latestPower = latestSampleForSession(db, session.chargerId, session.transactionId, 'Power.Active.Import', {
        includePhaseScopedFallback: true
      });
      const latestCurrent = latestSampleForSession(db, session.chargerId, session.transactionId, 'Current.Import', {
        includePhaseScopedFallback: false
      });
      const latestVoltage = latestSampleForSession(db, session.chargerId, session.transactionId, 'Voltage', {
        includePhaseScopedFallback: false
      });
      const latestSamples = [latestEnergy, latestPower, latestCurrent, latestVoltage].filter((sample): sample is MeterSampleRow => sample !== null);
      const latestSampleAt = latestSampleTimestamp(latestSamples);
      const latestMeterWh = latestEnergy ? normalizeEnergyWh(latestEnergy) : null;
      const energyUsedWh = latestMeterWh !== null && typeof session.startMeterWh === 'number' ? Math.max(0, latestMeterWh - session.startMeterWh) : null;

      return {
        sessionId: session.id,
        chargerId: session.chargerId,
        connectorId: session.connectorId,
        transactionId: session.transactionId,
        idTag: session.idTag,
        startedAt: session.startedAt.toISOString(),
        elapsedSeconds: Math.max(0, Math.floor((Date.now() - session.startedAt.getTime()) / 1000)),
        startMeterWh: session.startMeterWh ?? null,
        latestMeterWh,
        energyUsedWh,
        latestPowerW: latestPower ? normalizePowerW(latestPower) : null,
        latestCurrentA: latestCurrent ? normalizeRawNumber(latestCurrent) : null,
        latestVoltageV: latestVoltage ? normalizeRawNumber(latestVoltage) : null,
        latestSampleAt: latestSampleAt?.toISOString() ?? null,
        latestEnergyContext: latestEnergy?.context ?? null,
        latestPowerContext: latestPower?.context ?? null
      };
    });
  });
}

function latestSampleForSession(
  db: Database,
  chargerId: string,
  transactionId: number,
  measurand: string,
  options: { includePhaseScopedFallback: boolean }
) {
  const unphased = db
    .select()
    .from(meterSamples)
    .where(
      and(
        eq(meterSamples.chargerId, chargerId),
        eq(meterSamples.transactionId, transactionId),
        measurandFilter(measurand),
        or(isNull(meterSamples.phase), eq(meterSamples.phase, ''))
      )
    )
    .orderBy(desc(meterSamples.sampledAt))
    .limit(1)
    .get();

  if (unphased || !options.includePhaseScopedFallback) return unphased ?? null;

  return (
    db
      .select()
      .from(meterSamples)
      .where(and(eq(meterSamples.chargerId, chargerId), eq(meterSamples.transactionId, transactionId), measurandFilter(measurand)))
      .orderBy(desc(meterSamples.sampledAt))
      .limit(1)
      .get() ?? null
  );
}

function measurandFilter(measurand: string) {
  if (measurand === 'Energy.Active.Import.Register') {
    return or(eq(meterSamples.measurand, measurand), isNull(meterSamples.measurand), eq(meterSamples.measurand, ''));
  }

  return eq(meterSamples.measurand, measurand);
}

function latestSampleTimestamp(samples: MeterSampleRow[]) {
  return samples.reduce<Date | null>((latest, sample) => {
    if (!latest || sample.sampledAt > latest) return sample.sampledAt;
    return latest;
  }, null);
}

function normalizeEnergyWh(sample: MeterSampleRow) {
  if (sample.normalizedUnit === 'Wh' && typeof sample.normalizedValue === 'number') return sample.normalizedValue;
  const value = normalizeRawNumber(sample);
  if (value === null) return null;
  const unit = sample.unit?.trim().toLowerCase();
  if (unit === 'kwh') return value * 1000;
  return value;
}

function normalizePowerW(sample: MeterSampleRow) {
  if (sample.normalizedUnit === 'W' && typeof sample.normalizedValue === 'number') return sample.normalizedValue;
  const value = normalizeRawNumber(sample);
  if (value === null) return null;
  const unit = sample.unit?.trim().toLowerCase();
  if (unit === 'kw') return value * 1000;
  return value;
}

function normalizeRawNumber(sample: MeterSampleRow) {
  if (typeof sample.normalizedValue === 'number') return sample.normalizedValue;
  if (typeof sample.numericValue === 'number') return sample.numericValue;
  const value = Number.parseFloat(sample.value);
  return Number.isFinite(value) ? value : null;
}
