import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ApiClient } from './http-client.js';
import { executeTool, listToolDefinitions } from './tools.js';

export function createMcpServer(client: ApiClient) {
  const server = new Server(
    {
      name: '@virtual-ocpp/mcp',
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
    const result = await executeTool(client, request.params.name, request.params.arguments ?? {});
    return result;
  });

  return server;
}

export async function connectStdioServer(server: Server) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
