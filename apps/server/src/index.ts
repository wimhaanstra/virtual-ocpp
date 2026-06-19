import { buildApp } from './app.js';
import { loadConfigFromProcess } from './config.js';
import { createDatabase } from './db/client.js';

const config = loadConfigFromProcess();
const db = createDatabase(config);
const app = await buildApp({ config, db });

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
