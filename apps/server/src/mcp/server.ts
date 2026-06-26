import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpApiClient } from './tools.js';
import { executeTool, listToolDefinitions } from './tools.js';

export function createVirtualOcppMcpServer(client: McpApiClient) {
  const server = new Server(
    {
      name: '@virtual-ocpp/server-mcp',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolDefinitions()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return executeTool(client, request.params.name, request.params.arguments ?? {});
  });

  return server;
}
