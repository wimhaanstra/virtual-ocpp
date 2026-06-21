import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRPCError, RPCServer } from 'ocpp-rpc';
import type { FastifyInstance } from 'fastify';
import type { Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config.js';
import type { CommunicationJournalService } from '../communication-journal.js';
import type { Database } from '../db/client.js';
import type { LiveUpdateBus } from '../live-updates.js';
import { ChargerCommandService } from './charger-command-service.js';
import { OcppHandlers } from './handlers.js';
import { ProxyAuthorizationService } from './proxy-service.js';
import { OcppRepository } from './repository.js';

type RpcCall<TParams> = {
  params: TParams;
};

type RpcClient = {
  identity: string;
  session?: { chargerId?: string };
  call: (method: string, params: Record<string, unknown>, options?: { callTimeoutMs?: number }) => Promise<unknown>;
  close: (options?: { code?: number; reason?: string; awaitPending?: boolean }) => Promise<unknown>;
  handle: (method: string | ((call: { method: string; params: unknown }) => unknown), handler?: (call: RpcCall<never>) => unknown) => void;
  on: (event: 'close', handler: () => void) => void;
};

export async function registerOcppServer(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  communicationJournal?: CommunicationJournalService,
  proxyAuthorization = new ProxyAuthorizationService(db, communicationJournal),
  chargerCommands = new ChargerCommandService(communicationJournal),
  liveUpdates?: LiveUpdateBus
) {
  const repository = new OcppRepository(db, communicationJournal, liveUpdates);
  const handlers = new OcppHandlers(repository, proxyAuthorization);
  const rpcServer = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: false,
    respondWithDetailedErrors: false,
    maxBadMessages: 5
  });

  rpcServer.auth((accept, reject, handshake) => {
    const chargerId = getChargerIdFromHandshake(handshake.endpoint, handshake.identity);

    if (!chargerId) {
      reject(404, 'Unknown OCPP endpoint');
      return;
    }

    if (config.ocppBasicAuthPassword && !passwordMatches(handshake.password, config.ocppBasicAuthPassword)) {
      reject(401, 'Invalid OCPP credentials');
      return;
    }

    accept({ chargerId }, 'ocpp1.6');
  });

  rpcServer.on('client', (client: RpcClient) => {
    const context = { chargerId: client.session?.chargerId ?? client.identity };
    const connectionId = repository.recordConnected(context.chargerId);
    chargerCommands.register(context.chargerId, client);
    void proxyAuthorization.warmUpTargets(context.chargerId);

    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'BootNotification', (params: Parameters<typeof handlers.bootNotification>[1]) =>
      handlers.bootNotification(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'Heartbeat', (params: Parameters<typeof handlers.heartbeat>[1]) =>
      handlers.heartbeat(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'Authorize', (params: Parameters<typeof handlers.authorize>[1]) =>
      handlers.authorize(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'StartTransaction', (params: Parameters<typeof handlers.startTransaction>[1]) =>
      handlers.startTransaction(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'StopTransaction', (params: Parameters<typeof handlers.stopTransaction>[1]) =>
      handlers.stopTransaction(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'StatusNotification', (params: Parameters<typeof handlers.statusNotification>[1]) =>
      handlers.statusNotification(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'MeterValues', (params: Parameters<typeof handlers.meterValues>[1]) =>
      handlers.meterValues(context, params)
    );
    client.handle(({ method, params }) => {
      repository.recordSeen(context.chargerId);
      const correlationId = randomUUID();
      communicationJournal?.recordChargerCall({
        chargerId: context.chargerId,
        ocppMethod: method,
        payload: params,
        correlationId
      });

      const error = createRPCError('NotImplemented', `${method} is not implemented`);
      communicationJournal?.recordChargerError({
        chargerId: context.chargerId,
        ocppMethod: method,
        payload: {
          name: 'RPCError',
          code: 'NotImplemented',
          message: `${method} is not implemented`
        },
        errorCode: 'NotImplemented',
        errorDescription: `${method} is not implemented`,
        correlationId
      });
      repository.recordLog({
        level: 'warn',
        category: 'ocpp',
        message: 'unsupported ocpp method',
        chargerId: context.chargerId,
        metadata: { method }
      });
      throw error;
    });

    client.on('close', () => {
      chargerCommands.unregister(context.chargerId, client);
      repository.recordDisconnected(context.chargerId, connectionId);
    });
  });

  app.server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!request.url?.startsWith('/ocpp/')) return;
    void rpcServer.handleUpgrade(request, socket, head);
  });

  app.addHook('onClose', async () => {
    await proxyAuthorization.close();
    await rpcServer.close({ code: 1001, reason: 'Server shutting down' });
  });
}

function passwordMatches(password: Buffer | undefined, expected: string) {
  if (!password) return false;

  const left = createHash('sha256').update(password).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function registerTrackedHandler<TParams, TResult>(
  repository: OcppRepository,
  client: RpcClient,
  communicationJournal: CommunicationJournalService | undefined,
  chargerId: string,
  method: string,
  handler: (params: TParams) => TResult | Promise<TResult>
) {
  client.handle(method, async ({ params }: RpcCall<TParams>) => {
    repository.recordSeen(chargerId);
    const correlationId = randomUUID();
    communicationJournal?.recordChargerCall({
      chargerId,
      ocppMethod: method,
      payload: params,
      correlationId,
      idTag: extractIdTag(params),
      transactionId: extractTransactionId(params)
    });

    try {
      const result = await handler(params);
      communicationJournal?.recordChargerResult({
        chargerId,
        ocppMethod: method,
        payload: result,
        correlationId,
        idTag: extractIdTag(params),
        transactionId: extractTransactionId(params) ?? extractTransactionId(result)
      });
      return result;
    } catch (error) {
      communicationJournal?.recordChargerError({
        chargerId,
        ocppMethod: method,
        payload: serializeErrorPayload(error),
        errorCode: getErrorCode(error),
        errorDescription: getErrorDescription(error),
        correlationId,
        idTag: extractIdTag(params),
        transactionId: extractTransactionId(params)
      });
      throw error;
    }
  });
}

function extractIdTag(params: unknown) {
  if (!params || typeof params !== 'object') return null;
  const idTag = (params as { idTag?: unknown }).idTag;
  return typeof idTag === 'string' ? idTag : null;
}

function extractTransactionId(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const transactionId = (value as { transactionId?: unknown }).transactionId;
  return typeof transactionId === 'number' ? transactionId : null;
}

function serializeErrorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      code: getErrorCode(error),
      message: error.message
    };
  }

  return {
    message: 'unknown_error'
  };
}

function getErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }

  return null;
}

function getErrorDescription(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'unknown_error';
}

function getChargerIdFromHandshake(endpoint: string, identity: string | undefined) {
  if (endpoint === '/ocpp') return identity;
  if (!endpoint.startsWith('/ocpp/')) return null;

  const chargerId = decodeURIComponent(endpoint.slice('/ocpp/'.length)).trim();
  return chargerId || null;
}
