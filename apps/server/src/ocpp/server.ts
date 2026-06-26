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
import { and, eq, gt } from 'drizzle-orm';
import { chargerPairingSessions, chargers, tenants } from '../db/schema.js';

type RpcCall<TParams> = {
  params: TParams;
};

type RpcClient = {
  identity: string;
  session?: { tenantId?: string; chargerId?: string };
  call: (method: string, params: Record<string, unknown>, options?: { callTimeoutMs?: number }) => Promise<unknown>;
  close: (options?: { code?: number; reason?: string; awaitPending?: boolean }) => Promise<unknown>;
  handle: (method: string | ((call: { method: string; params: unknown }) => unknown), handler?: (call: RpcCall<never>) => unknown) => void;
  on: {
    (event: 'close', handler: () => void): void;
    (event: 'badMessage', handler: (event: { buffer: Buffer; error: unknown; response: unknown }) => void): void;
  };
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
  const handlers = new OcppHandlers(repository, proxyAuthorization, config.meterGapThresholdWh);
  const rpcServer = new RPCServer({
    protocols: ['ocpp1.6'],
    strictMode: false,
    respondWithDetailedErrors: false,
    maxBadMessages: 5
  });

  rpcServer.auth((accept, reject, handshake) => {
    const context = resolveHandshakeContext(db, handshake.endpoint, handshake.identity, handshake.password);

    if (!context) {
      reject(404, 'Unknown OCPP endpoint');
      return;
    }

    if (context.requiresGlobalPassword && config.ocppBasicAuthPassword && !passwordMatches(handshake.password, config.ocppBasicAuthPassword)) {
      reject(401, 'Invalid OCPP credentials');
      return;
    }

    accept({ tenantId: context.tenantId, chargerId: context.chargerId }, 'ocpp1.6');
  });

  rpcServer.on('client', (client: RpcClient) => {
    const context = { tenantId: client.session?.tenantId ?? 'default', chargerId: client.session?.chargerId ?? client.identity };
    const connectionId = repository.recordConnected(context.chargerId, context.tenantId);
    chargerCommands.register(context.chargerId, client);
    void proxyAuthorization.warmUpTargets(context.chargerId);
    registerProtocolDiagnostics(repository, client, communicationJournal, context.chargerId);

    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'BootNotification', (params: Parameters<typeof handlers.bootNotification>[1]) =>
      handlers.bootNotification(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'Heartbeat', (params: Parameters<typeof handlers.heartbeat>[1]) =>
      handlers.heartbeat(context, params)
    );
    registerTrackedHandler(repository, client, communicationJournal, context.chargerId, 'FirmwareStatusNotification', (params: Record<string, unknown>) =>
      handlers.firmwareStatusNotification(context, params)
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
      repository.recordSeen(context.chargerId, context.tenantId);
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

function registerProtocolDiagnostics(
  repository: OcppRepository,
  client: RpcClient,
  communicationJournal: CommunicationJournalService | undefined,
  chargerId: string
) {
  client.on('badMessage', ({ buffer, error, response }) => {
    const correlationId = randomUUID();
    const payload = {
      direction: 'inbound',
      bytes: buffer.byteLength,
      preview: sanitizeRawMessagePreview(buffer),
      response: summarizeBadMessageResponse(response)
    };
    const errorCode = getErrorCode(error);
    const errorDescription = getErrorDescription(error);

    communicationJournal?.recordChargerRaw({
      chargerId,
      payload,
      errorCode,
      errorDescription,
      correlationId
    });
    repository.recordLog({
      level: 'warn',
      category: 'ocpp',
      message: 'invalid raw ocpp message received',
      chargerId,
      metadata: {
        correlationId,
        errorCode,
        errorDescription,
        bytes: payload.bytes,
        preview: payload.preview,
        response: payload.response
      }
    });
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
  if (error && typeof error === 'object' && 'rpcErrorCode' in error && typeof (error as { rpcErrorCode?: unknown }).rpcErrorCode === 'string') {
    return (error as { rpcErrorCode: string }).rpcErrorCode;
  }
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

function sanitizeRawMessagePreview(buffer: Buffer) {
  const text = buffer.toString('utf8').replace(/[\u0000-\u001f\u007f]/g, (char) => {
    if (char === '\t' || char === '\n' || char === '\r') return char;
    return ' ';
  });
  const truncated = text.length > 500 ? `${text.slice(0, 500)}...` : text;
  return truncated.replace(/(Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]');
}

function summarizeBadMessageResponse(response: unknown) {
  if (!Array.isArray(response)) return null;
  const [messageType, messageId, errorCode, errorDescription] = response;
  return {
    messageType,
    messageId,
    errorCode,
    errorDescription
  };
}

function resolveHandshakeContext(db: Database, endpoint: string, identity: string | undefined, password: Buffer | undefined) {
  const paired = getPairedChargerContext(db, endpoint, password);
  if (paired) return paired;

  const chargerId = getChargerIdFromHandshake(endpoint, identity);
  if (!chargerId) return null;
  const existing = db.select().from(chargers).where(eq(chargers.id, chargerId)).limit(1).get();
  if (existing?.credentialHash && !passwordHashMatches(password, existing.credentialHash)) {
    return null;
  }
  return {
    tenantId: existing?.tenantId ?? 'default',
    chargerId,
    requiresGlobalPassword: true
  };
}

function getPairedChargerContext(db: Database, endpoint: string, password: Buffer | undefined) {
  const parts = endpoint.split('/').filter(Boolean);
  if (parts[0] !== 'ocpp' || parts[1] !== 't') return null;
  if (parts.length !== 5) return null;

  const [, , encodedTenantPublicId, encodedPairingCode, encodedChargerId] = parts;
  const tenantPublicId = decodeURIComponent(encodedTenantPublicId ?? '').trim();
  const pairingCode = decodeURIComponent(encodedPairingCode ?? '').trim();
  const chargerIdentity = decodeURIComponent(encodedChargerId ?? '').trim();
  if (!tenantPublicId || !pairingCode || !chargerIdentity) return null;

  const tenant = db.select().from(tenants).where(eq(tenants.publicId, tenantPublicId)).limit(1).get();
  if (!tenant) return null;

  const pairing = db
    .select()
    .from(chargerPairingSessions)
    .where(and(eq(chargerPairingSessions.tenantId, tenant.id), eq(chargerPairingSessions.pairingCodeHash, hashSecret(pairingCode)), gt(chargerPairingSessions.expiresAt, new Date())))
    .limit(1)
    .get();
  if (!pairing) return null;
  if (pairing.basicAuthPasswordHash && !passwordHashMatches(password, pairing.basicAuthPasswordHash)) return null;
  const chargerId = createTenantScopedChargerId(tenant.publicId, chargerIdentity);
  if (pairing.chargerId && pairing.chargerId !== chargerId) return null;

  const now = new Date();
  const existing = db.select().from(chargers).where(eq(chargers.id, chargerId)).limit(1).get();
  if (!existing) {
    db.insert(chargers).values({
      id: chargerId,
      tenantId: tenant.id,
      credentialHash: pairing.basicAuthPasswordHash,
      enabled: true,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    }).run();
  } else {
    db.update(chargers)
      .set({
        tenantId: tenant.id,
        credentialHash: pairing.basicAuthPasswordHash,
        lastSeenAt: now,
        updatedAt: now
      })
      .where(eq(chargers.id, chargerId))
      .run();
  }
  if (!pairing.chargerId || !pairing.consumedAt) {
    db.update(chargerPairingSessions).set({ chargerId, consumedAt: now }).where(eq(chargerPairingSessions.id, pairing.id)).run();
  }

  return {
    tenantId: tenant.id,
    chargerId,
    requiresGlobalPassword: false
  };
}

function getChargerIdFromHandshake(endpoint: string, identity: string | undefined) {
  if (endpoint === '/ocpp') return identity;
  if (!endpoint.startsWith('/ocpp/')) return null;

  const chargerId = decodeURIComponent(endpoint.slice('/ocpp/'.length)).trim();
  return chargerId || null;
}

function createTenantScopedChargerId(tenantPublicId: string, chargerIdentity: string) {
  return `${tenantPublicId}/${chargerIdentity}`;
}

function passwordHashMatches(password: Buffer | undefined, expectedHash: string) {
  if (!password) return false;
  return safeHashEquals(createHash('sha256').update(password).digest('hex'), expectedHash);
}

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function safeHashEquals(left: string, right: string) {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
