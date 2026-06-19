import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { registerAuthRoutes } from './auth.js';
import { CommunicationJournalService } from './communication-journal.js';
import { registerCommunicationJournalRoutes } from './communication-journal-routes.js';
import { registerChargerRoutes } from './chargers.js';
import { registerDashboardConfigRoutes } from './dashboard-config.js';
import { registerOcppServer } from './ocpp/server.js';
import { registerProxyTargetRoutes } from './proxy-targets.js';
import { registerVisibilityRoutes } from './visibility.js';
import { registerTagRoutes } from './tags.js';

type BuildAppOptions = {
  config: AppConfig;
  db: Database;
};

export async function buildApp({ config, db }: BuildAppOptions): Promise<FastifyInstance> {
  const communicationJournal = new CommunicationJournalService(db, config.communicationLogRetentionHours);
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: ['req.headers.authorization', 'request.headers.authorization', '*.password']
    }
  });

  await app.register(cookie, {
    secret: config.sessionSecret
  });

  app.get('/health', async () => ({
    ok: true
  }));

  communicationJournal.purgeExpired();

  registerAuthRoutes(app, config, db);
  registerDashboardConfigRoutes(app, config, db);
  registerChargerRoutes(app, db);
  registerTagRoutes(app, db);
  registerProxyTargetRoutes(app, db);
  registerCommunicationJournalRoutes(app, db, communicationJournal);
  registerVisibilityRoutes(app, db);
  await registerOcppServer(app, config, db, communicationJournal);

  return app;
}
