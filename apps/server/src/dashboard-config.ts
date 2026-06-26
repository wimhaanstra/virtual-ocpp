import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireTenantRole } from './auth.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { chargerPairingSessions, chargers, tenants } from './db/schema.js';
import { and, eq } from 'drizzle-orm';

const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: string };
const PAIRING_TTL_MS = 1000 * 60 * 15;
const CreatePairingSchema = z.object({
  basicAuth: z.boolean().default(false)
});

export function registerDashboardConfigRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  app.get('/api/dashboard-config', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'viewer');
    if (!auth) return;

    return {
      ocppWebSocketUrl: buildOcppWebSocketUrl(config),
      ocppProtocol: 'ocpp1.6',
      ocppBasicAuthRequired: false,
      ocppBasicAuthUsername: null,
      appVersion: packageJson.version ?? 'unknown'
    };
  });

  app.post('/api/charger-pairings', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'admin');
    if (!auth) return;

    const body = CreatePairingSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_charger_pairing', details: body.error.flatten() });
    }

    const tenant = db.select().from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1).get();
    if (!tenant) {
      return reply.code(404).send({ error: 'tenant_not_found' });
    }

    const pairingCode = randomBytes(18).toString('base64url');
    const basicAuthUsername = body.data.basicAuth ? 'charger' : null;
    const basicAuthPassword = body.data.basicAuth ? randomBytes(18).toString('base64url') : null;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    const id = randomUUID();
    db.insert(chargerPairingSessions).values({
      id,
      tenantId: auth.tenantId,
      pairingCodeHash: hashSecret(pairingCode),
      basicAuthUsername,
      basicAuthPasswordHash: basicAuthPassword ? hashSecret(basicAuthPassword) : null,
      createdByUserId: auth.userId ?? '',
      createdAt: now,
      expiresAt
    }).run();

    const ocppWebSocketUrl = buildTenantPairingUrl(config, tenant.publicId, pairingCode);
    return reply.code(201).send({
      id,
      ocppWebSocketUrl,
      ocppProtocol: 'ocpp1.6',
      expiresAt: expiresAt.toISOString(),
      basicAuthRequired: body.data.basicAuth,
      basicAuthUsername,
      basicAuthPassword
    });
  });

  app.get<{ Params: { id: string } }>('/api/charger-pairings/:id', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'viewer');
    if (!auth) return;

    const pairing = db
      .select()
      .from(chargerPairingSessions)
      .where(and(eq(chargerPairingSessions.tenantId, auth.tenantId), eq(chargerPairingSessions.id, request.params.id)))
      .limit(1)
      .get();
    if (!pairing) {
      return reply.code(404).send({ error: 'charger_pairing_not_found' });
    }

    const charger = pairing.chargerId
      ? db.select().from(chargers).where(and(eq(chargers.tenantId, auth.tenantId), eq(chargers.id, pairing.chargerId))).limit(1).get()
      : null;

    return {
      id: pairing.id,
      consumedAt: pairing.consumedAt?.toISOString() ?? null,
      expiresAt: pairing.expiresAt.toISOString(),
      charger: charger
        ? {
            id: charger.id,
            chargerId: charger.id,
            label: charger.label,
            enabled: charger.enabled,
            active: false,
            firstSeenAt: charger.firstSeenAt.toISOString(),
            lastSeenAt: charger.lastSeenAt.toISOString(),
            lastBootAt: charger.lastBootAt?.toISOString() ?? null,
            chargePointVendor: charger.chargePointVendor,
            chargePointModel: charger.chargePointModel,
            firmwareVersion: charger.firmwareVersion,
            connectionId: null,
            connectedAt: null,
            disconnectedAt: null
          }
        : null
    };
  });
}

function buildOcppWebSocketUrl(config: AppConfig) {
  if (config.ocppPublicUrl) return config.ocppPublicUrl;

  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  return `ws://${host}:${config.port}/ocpp/:chargerId`;
}

function buildTenantPairingUrl(config: AppConfig, tenantPublicId: string, pairingCode: string) {
  const base = config.ocppPublicUrl?.replace(/\/ocpp\/?:chargerId$/, '') ?? buildOcppWebSocketUrl(config).replace(/\/ocpp\/?:chargerId$/, '');
  return `${base}/ocpp/t/${encodeURIComponent(tenantPublicId)}/${encodeURIComponent(pairingCode)}/:chargerId`;
}

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}
