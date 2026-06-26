import { createApiClient } from './http-client.js';
import { loadConfig } from './config.js';
import { connectStdioServer, createMcpServer } from './server.js';

const config = loadConfig();
const client = createApiClient({
  baseUrl: config.apiUrl,
  token: config.apiToken
});

const server = createMcpServer(client);

try {
  await connectStdioServer(server);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to start the MCP server.';
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
