import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { registerAuthRoutes } from './auth.js';
import { registerChargingStatsRoutes } from './charging-stats.js';
import { CommunicationJournalService } from './communication-journal.js';
import { registerCommunicationJournalRoutes } from './communication-journal-routes.js';
import { registerChargerRoutes } from './chargers.js';
import { registerDashboardConfigRoutes } from './dashboard-config.js';
import { LiveUpdateBus } from './live-updates.js';
import { registerLiveUpdateRoutes } from './live-updates-routes.js';
import { ChargerCommandService } from './ocpp/charger-command-service.js';
import { ProxyAuthorizationService } from './ocpp/proxy-service.js';
import { registerOcppServer } from './ocpp/server.js';
import { registerProxyTargetRoutes } from './proxy-targets.js';
import { registerVisibilityRoutes } from './visibility.js';
import { registerTagRoutes } from './tags.js';
import { closeStaleChargerConnections } from './startup-maintenance.js';
import { registerStaticAssetRoutes } from './static-assets.js';

type BuildAppOptions = {
  config: AppConfig;
  db: Database;
};

type AppWithLiveUpdates = FastifyInstance & { liveUpdates: LiveUpdateBus };

export async function buildApp({ config, db }: BuildAppOptions): Promise<AppWithLiveUpdates> {
  const liveUpdates = new LiveUpdateBus();
  const communicationJournal = new CommunicationJournalService(db, config.communicationLogRetentionHours, liveUpdates);
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

  communicationJournal.purgeExpired();
  closeStaleChargerConnections(db, liveUpdates);

  registerAuthRoutes(app, config, db, liveUpdates);
  registerLiveUpdateRoutes(app, db, liveUpdates);
  registerDashboardConfigRoutes(app, config, db);
  registerChargingStatsRoutes(app, db);
  registerChargerRoutes(app, config, db, liveUpdates, chargerCommands, proxyAuthorization);
  registerTagRoutes(app, db, liveUpdates);
  registerProxyTargetRoutes(app, db, proxyAuthorization, liveUpdates);
  registerCommunicationJournalRoutes(app, db, communicationJournal);
  registerVisibilityRoutes(app, db, chargerCommands, proxyAuthorization, liveUpdates);
  await registerOcppServer(app, config, db, communicationJournal, proxyAuthorization, chargerCommands, liveUpdates);
  if (config.nodeEnv === 'production') {
    registerStaticAssetRoutes(app);
  }

  return app;
}
