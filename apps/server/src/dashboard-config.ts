import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { requireAdmin } from './auth.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';

const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: string };

export function registerDashboardConfigRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  app.get('/api/dashboard-config', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    return {
      ocppWebSocketUrl: buildOcppWebSocketUrl(config),
      ocppProtocol: 'ocpp1.6',
      ocppBasicAuthRequired: Boolean(config.ocppBasicAuthPassword),
      ocppBasicAuthUsername: config.ocppBasicAuthPassword ? 'charger id' : null,
      appVersion: packageJson.version ?? 'unknown'
    };
  });
}

function buildOcppWebSocketUrl(config: AppConfig) {
  if (config.ocppPublicUrl) return config.ocppPublicUrl;

  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  return `ws://${host}:${config.port}/ocpp/:chargerId`;
}
