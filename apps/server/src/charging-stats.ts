import { and, desc, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
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
type ChargingSessionRow = typeof chargingSessions.$inferSelect;
type SampleAssociation = 'transaction-id' | 'connector-time-window' | 'none';
type SampleLookupResult = {
  sample: MeterSampleRow | null;
  association: SampleAssociation;
};

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
      const latestEnergy = latestSampleForSession(db, session, 'Energy.Active.Import.Register', {
        includePhaseScopedFallback: true
      });
      const latestPower = latestSampleForSession(db, session, 'Power.Active.Import', {
        includePhaseScopedFallback: true
      });
      const latestCurrent = latestSampleForSession(db, session, 'Current.Import', {
        includePhaseScopedFallback: false
      });
      const latestVoltage = latestSampleForSession(db, session, 'Voltage', {
        includePhaseScopedFallback: false
      });
      const latestTemperature = latestSampleForSession(db, session, 'Temperature', {
        includePhaseScopedFallback: false
      });
      const latestCurrentPhasesA = latestPhaseValuesForSession(db, session, 'Current.Import');
      const latestSamples = [latestEnergy.sample, latestPower.sample, latestCurrent.sample, latestVoltage.sample, latestTemperature.sample].filter((sample): sample is MeterSampleRow => sample !== null);
      const latestSampleAt = latestSampleTimestamp(latestSamples);
      const latestMeterWh = latestEnergy.sample ? normalizeEnergyWh(latestEnergy.sample) : null;
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
        latestPowerW: latestPower.sample ? normalizePowerW(latestPower.sample) : null,
        latestCurrentA: latestCurrent.sample ? normalizeRawNumber(latestCurrent.sample) : null,
        latestCurrentPhasesA,
        latestVoltageV: latestVoltage.sample ? normalizeRawNumber(latestVoltage.sample) : null,
        latestTemperatureC: latestTemperature.sample ? normalizeTemperatureC(latestTemperature.sample) : null,
        latestSampleAt: latestSampleAt?.toISOString() ?? null,
        sampleAssociation: strongestAssociation([latestEnergy, latestPower, latestCurrent, latestVoltage, latestTemperature]),
        latestEnergyContext: latestEnergy.sample?.context ?? null,
        latestPowerContext: latestPower.sample?.context ?? null
      };
    });
  });
}

function latestSampleForSession(
  db: Database,
  session: ChargingSessionRow,
  measurand: string,
  options: { includePhaseScopedFallback: boolean }
): SampleLookupResult {
  const exact = latestExactSampleForSession(db, session, measurand, options);
  if (exact) {
    return {
      sample: exact,
      association: 'transaction-id'
    };
  }

  const fallback = latestTransactionlessSampleForSession(db, session, measurand, options);
  if (fallback) {
    return {
      sample: fallback,
      association: 'connector-time-window'
    };
  }

  return {
    sample: null,
    association: 'none'
  };
}

function latestExactSampleForSession(
  db: Database,
  session: ChargingSessionRow,
  measurand: string,
  options: { includePhaseScopedFallback: boolean }
) {
  const unphased = db
    .select()
    .from(meterSamples)
    .where(
      and(
        eq(meterSamples.chargerId, session.chargerId),
        eq(meterSamples.transactionId, session.transactionId),
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
      .where(and(eq(meterSamples.chargerId, session.chargerId), eq(meterSamples.transactionId, session.transactionId), measurandFilter(measurand)))
      .orderBy(desc(meterSamples.sampledAt))
      .limit(1)
      .get() ?? null
  );
}

function latestTransactionlessSampleForSession(
  db: Database,
  session: ChargingSessionRow,
  measurand: string,
  options: { includePhaseScopedFallback: boolean }
) {
  const unphased = latestTransactionlessCandidateForSession(db, session, measurand, false);
  if (unphased || !options.includePhaseScopedFallback) return unphased ?? null;
  return latestTransactionlessCandidateForSession(db, session, measurand, true);
}

function latestTransactionlessCandidateForSession(
  db: Database,
  session: ChargingSessionRow,
  measurand: string,
  includePhaseScopedFallback: boolean
) {
  const conditions = [
    eq(meterSamples.chargerId, session.chargerId),
    eq(meterSamples.connectorId, session.connectorId),
    isNull(meterSamples.transactionId),
    measurandFilter(measurand),
    gte(meterSamples.sampledAt, session.startedAt)
  ];

  if (!includePhaseScopedFallback) {
    conditions.push(or(isNull(meterSamples.phase), eq(meterSamples.phase, '')));
  }

  if (session.stoppedAt) {
    conditions.push(lte(meterSamples.sampledAt, session.stoppedAt));
  }

  const candidates = db
    .select()
    .from(meterSamples)
    .where(and(...conditions))
    .orderBy(desc(meterSamples.sampledAt))
    .limit(20)
    .all();

  for (const sample of candidates) {
    if (!hasAmbiguousSessionAt(db, session, sample.sampledAt)) return sample;
  }

  return null;
}

function latestPhaseValuesForSession(db: Database, session: ChargingSessionRow, measurand: string) {
  const phases: Record<string, number> = {};
  const seen = new Set<string>();
  const rows = [
    ...latestExactPhaseRowsForSession(db, session, measurand),
    ...latestTransactionlessPhaseRowsForSession(db, session, measurand)
  ];

  for (const sample of rows) {
    const phase = sample.phase?.trim();
    if (!phase || seen.has(phase)) continue;
    if (sample.transactionId === null && hasAmbiguousSessionAt(db, session, sample.sampledAt)) continue;
    const value = normalizeRawNumber(sample);
    if (value === null) continue;
    phases[phase] = value;
    seen.add(phase);
  }

  return Object.keys(phases).length > 0 ? phases : null;
}

function latestExactPhaseRowsForSession(db: Database, session: ChargingSessionRow, measurand: string) {
  return db
    .select()
    .from(meterSamples)
    .where(and(eq(meterSamples.chargerId, session.chargerId), eq(meterSamples.transactionId, session.transactionId), measurandFilter(measurand)))
    .orderBy(desc(meterSamples.sampledAt))
    .limit(20)
    .all();
}

function latestTransactionlessPhaseRowsForSession(db: Database, session: ChargingSessionRow, measurand: string) {
  const conditions = [
    eq(meterSamples.chargerId, session.chargerId),
    eq(meterSamples.connectorId, session.connectorId),
    isNull(meterSamples.transactionId),
    measurandFilter(measurand),
    gte(meterSamples.sampledAt, session.startedAt)
  ];

  if (session.stoppedAt) {
    conditions.push(lte(meterSamples.sampledAt, session.stoppedAt));
  }

  return db
    .select()
    .from(meterSamples)
    .where(and(...conditions))
    .orderBy(desc(meterSamples.sampledAt))
    .limit(60)
    .all();
}

function hasAmbiguousSessionAt(db: Database, session: ChargingSessionRow, sampledAt: Date) {
  const overlap = db
    .select()
    .from(chargingSessions)
    .where(
      and(
        eq(chargingSessions.chargerId, session.chargerId),
        eq(chargingSessions.connectorId, session.connectorId),
        ne(chargingSessions.id, session.id),
        lte(chargingSessions.startedAt, sampledAt),
        or(isNull(chargingSessions.stoppedAt), gte(chargingSessions.stoppedAt, sampledAt))
      )
    )
    .limit(1)
    .get();

  return Boolean(overlap);
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

function normalizeTemperatureC(sample: MeterSampleRow) {
  const value = normalizeRawNumber(sample);
  if (value === null) return null;
  const unit = sample.unit?.trim().toLowerCase();
  if (unit === 'fahrenheit') return (value - 32) * (5 / 9);
  if (unit === 'k') return value - 273.15;
  return value;
}

function normalizeRawNumber(sample: MeterSampleRow) {
  if (typeof sample.normalizedValue === 'number') return sample.normalizedValue;
  if (typeof sample.numericValue === 'number') return sample.numericValue;
  const value = Number.parseFloat(sample.value);
  return Number.isFinite(value) ? value : null;
}

function strongestAssociation(results: SampleLookupResult[]): SampleAssociation {
  if (results.some((result) => result.association === 'transaction-id')) return 'transaction-id';
  if (results.some((result) => result.association === 'connector-time-window')) return 'connector-time-window';
  return 'none';
}
