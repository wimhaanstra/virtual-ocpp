import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireApiAccess } from './auth.js';
import type { Database } from './db/client.js';
import { createVirtualOcppMcpServer } from './mcp/server.js';
import type { McpApiClient } from './mcp/tools.js';

type QueryValue = string | number | boolean | null | undefined;
type InjectMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type InjectedResponse = {
  statusCode: number;
  body: string;
  json(): unknown;
};

export function registerMcpRoutes(app: FastifyInstance, db: Database) {
  app.post('/mcp', async (request, reply) => {
    if (await requireMcpBearer(request, reply, db)) return;

    const authorization = request.headers.authorization;
    if (!authorization) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const server = createVirtualOcppMcpServer(createInjectedApiClient(app, authorization));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(toWebRequest(request), { parsedBody: request.body });
      for (const [key, value] of response.headers.entries()) {
        reply.header(key, value);
      }
      const body = Buffer.from(await response.arrayBuffer());
      return reply.code(response.status).send(body);
    } catch (error) {
      request.log.error({ err: error }, 'mcp request failed');
      return reply.code(500).send({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.get('/mcp', async (request, reply) => {
    if (await requireMcpBearer(request, reply, db)) return;
    return methodNotAllowed(reply);
  });

  app.delete('/mcp', async (request, reply) => {
    if (await requireMcpBearer(request, reply, db)) return;
    return methodNotAllowed(reply);
  });
}

function toWebRequest(request: FastifyRequest) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, String(value));
    }
  }

  return new Request(`http://localhost${request.url}`, {
    method: request.method,
    headers
  });
}

async function requireMcpBearer(request: FastifyRequest, reply: FastifyReply, db: Database) {
  const authorization = request.headers.authorization?.trim();
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  return requireApiAccess(request, reply, db, 'read');
}

function methodNotAllowed(reply: FastifyReply) {
  return reply
    .code(405)
    .header('content-type', 'application/json')
    .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
}

function createInjectedApiClient(app: FastifyInstance, authorization: string): McpApiClient {
  return {
    getJson: (path, query) => requestJson(app, authorization, 'GET', path, undefined, query),
    getText: (path, query) => requestText(app, authorization, 'GET', path, undefined, query),
    postJson: (path, body) => requestJson(app, authorization, 'POST', path, body),
    patchJson: (path, body) => requestJson(app, authorization, 'PATCH', path, body),
    putJson: (path, body) => requestJson(app, authorization, 'PUT', path, body),
    deleteJson: (path) => requestJson(app, authorization, 'DELETE', path)
  };
}

async function requestJson<T>(
  app: FastifyInstance,
  authorization: string,
  method: InjectMethod,
  path: string,
  payload?: unknown,
  query?: Record<string, QueryValue>
) {
  const response = await inject(app, authorization, method, path, payload, query);
  if (response.statusCode === 204) {
    return undefined as T;
  }
  if (response.statusCode >= 400) {
    throw new Error(`Virtual OCPP API returned HTTP ${response.statusCode}.`);
  }
  return response.json() as T;
}

async function requestText(
  app: FastifyInstance,
  authorization: string,
  method: InjectMethod,
  path: string,
  payload?: unknown,
  query?: Record<string, QueryValue>
) {
  const response = await inject(app, authorization, method, path, payload, query);
  if (response.statusCode >= 400) {
    throw new Error(`Virtual OCPP API returned HTTP ${response.statusCode}.`);
  }
  return response.body;
}

async function inject(
  app: FastifyInstance,
  authorization: string,
  method: InjectMethod,
  path: string,
  payload?: unknown,
  query?: Record<string, QueryValue>
): Promise<InjectedResponse> {
  const url = buildUrl(path, query);
  const response = await app.inject({
    method,
    url,
    headers: {
      authorization,
      accept: 'application/json'
    },
    payload: payload as string | object | Buffer | undefined
  });
  return response as InjectedResponse;
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}
