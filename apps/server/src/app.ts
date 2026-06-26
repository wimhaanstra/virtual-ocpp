import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { registerAccessTokenRoutes } from './access-tokens.js';
import { registerAuthRoutes } from './auth.js';
import { registerChargingStatsRoutes } from './charging-stats.js';
import { CommunicationJournalService } from './communication-journal.js';
import { registerCommunicationJournalRoutes } from './communication-journal-routes.js';
import { registerChargerRoutes } from './chargers.js';
import { registerDashboardConfigRoutes } from './dashboard-config.js';
import { LiveUpdateBus } from './live-updates.js';
import { registerLiveUpdateRoutes } from './live-updates-routes.js';
import { registerMcpRoutes } from './mcp-routes.js';
import { ChargerCommandService } from './ocpp/charger-command-service.js';
import { ProxyAuthorizationService } from './ocpp/proxy-service.js';
import { registerOcppServer } from './ocpp/server.js';
import { registerProxyTargetRoutes } from './proxy-targets.js';
import { getCommunicationRetentionHours, registerSettingsRoutes } from './settings.js';
import { registerSmartEvseDiagnosticsRoutes } from './smartevse-diagnostics.js';
import { registerVisibilityRoutes } from './visibility.js';
import { registerTagRoutes } from './tags.js';
import { closeStaleChargerConnections } from './startup-maintenance.js';
import { registerStaticAssetRoutes } from './static-assets.js';
import { sessions } from './db/schema.js';

type BuildAppOptions = {
  config: AppConfig;
  db: Database;
};

type AppWithLiveUpdates = FastifyInstance & { liveUpdates: LiveUpdateBus };

export async function buildApp({ config, db }: BuildAppOptions): Promise<AppWithLiveUpdates> {
  const liveUpdates = new LiveUpdateBus();
  const communicationJournal = new CommunicationJournalService(db, () => getCommunicationRetentionHours(db), liveUpdates);
  const proxyAuthorization = new ProxyAuthorizationService(db, communicationJournal, liveUpdates);
  const chargerCommands = new ChargerCommandService(communicationJournal);
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: ['req.headers.authorization', 'request.headers.authorization', '*.password']
    }
  }) as unknown as AppWithLiveUpdates;
  app.liveUpdates = liveUpdates;

  await app.register(cookie, {
    secret: config.sessionSecret
  });

  app.get('/health', async () => ({
    ok: true
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await db.select({ id: sessions.id }).from(sessions).limit(1);
      return { ok: true, database: 'ready' };
    } catch (error) {
      requestLogReadyError(app, error);
      return reply.code(503).send({ ok: false, database: 'unavailable' });
    }
  });

  communicationJournal.purgeExpired();
  closeStaleChargerConnections(db, liveUpdates);

  registerAuthRoutes(app, config, db, liveUpdates);
  registerAccessTokenRoutes(app, db);
  registerLiveUpdateRoutes(app, db, liveUpdates);
  registerDashboardConfigRoutes(app, config, db);
  registerSettingsRoutes(app, db, communicationJournal);
  registerChargingStatsRoutes(app, db);
  registerChargerRoutes(app, config, db, liveUpdates, chargerCommands, proxyAuthorization);
  registerTagRoutes(app, db, liveUpdates);
  registerProxyTargetRoutes(app, db, proxyAuthorization, liveUpdates);
  registerCommunicationJournalRoutes(app, db, communicationJournal);
  registerSmartEvseDiagnosticsRoutes(app, db);
  registerVisibilityRoutes(app, db, chargerCommands, proxyAuthorization, liveUpdates);
  registerMcpRoutes(app, db);
  await registerOcppServer(app, config, db, communicationJournal, proxyAuthorization, chargerCommands, liveUpdates);
  if (config.nodeEnv === 'production') {
    registerStaticAssetRoutes(app);
  }

  return app;
}

function requestLogReadyError(app: FastifyInstance, error: unknown) {
  app.log.warn({ err: error }, 'readiness check failed');
}
