import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { RPCClient } from 'ocpp-rpc';
import type { CommunicationJournalService } from '../communication-journal.js';
import type { Database } from '../db/client.js';
import { chargerConnections, chargers, logs, proxySessionMappings, proxyTargets } from '../db/schema.js';
import type {
  AuthorizeRequest,
  BootNotificationRequest,
  HeartbeatRequest,
  MeterValuesRequest,
  StartTransactionRequest,
  StatusNotificationRequest,
  StopTransactionRequest
} from './types.js';

type ProxyTarget = typeof proxyTargets.$inferSelect;
type AuthorizationDecision = {
  allowed: boolean;
  reason?: string;
};
type ProxyResponse = {
  idTagInfo?: { status?: string };
  transactionId?: number;
};
type UpstreamConnection = {
  client: InstanceType<typeof RPCClient> | null;
  signature: string;
  connectPromise: Promise<void> | null;
  connected: boolean;
  hadSuccessfulConnection: boolean;
  suppressLifecycleLogs: boolean;
};
type ReconnectBackoff = {
  failures: number;
  nextAttemptAt: number;
};

export class ProxyAuthorizationService {
  private readonly connections = new Map<string, UpstreamConnection>();
  private readonly reconnectBackoffs = new Map<string, ReconnectBackoff>();

  constructor(
    private readonly db: Database,
    private readonly communicationJournal?: CommunicationJournalService
  ) {}

  async authorize(chargerId: string, params: AuthorizeRequest): Promise<AuthorizationDecision> {
    const result = await this.forwardToTargets(chargerId, 'Authorize', params, { canDeny: true });
    return result.decision;
  }

  async bootNotification(chargerId: string, params: BootNotificationRequest) {
    await this.forwardToTargets(chargerId, 'BootNotification', params, { canDeny: false });
  }

  async heartbeat(chargerId: string, params: HeartbeatRequest) {
    await this.forwardToTargets(chargerId, 'Heartbeat', params, { canDeny: false });
  }

  async startTransaction(
    chargerId: string,
    localTransactionId: number,
    params: StartTransactionRequest
  ): Promise<AuthorizationDecision> {
    const result = await this.forwardToTargets(chargerId, 'StartTransaction', params, { canDeny: true });
    if (!result.decision.allowed) return result.decision;

    for (const entry of result.responses) {
      if (typeof entry.response.transactionId !== 'number') continue;
      this.db.insert(proxySessionMappings).values({
        id: randomUUID(),
        chargerId,
        proxyTargetId: entry.target.id,
        localTransactionId,
        externalTransactionId: entry.response.transactionId,
        createdAt: new Date()
      }).run();
    }

    return { allowed: true };
  }

  async stopTransaction(chargerId: string, params: StopTransactionRequest) {
    if (typeof params.transactionId !== 'number') return;

    const mappings = this.getActiveMappings(chargerId, params.transactionId);
    for (const mapping of mappings) {
      const target = this.getEnabledTarget(chargerId, mapping.proxyTargetId);
      if (!target) continue;

      await this.callTarget(chargerId, target, 'StopTransaction', {
        ...params,
        transactionId: mapping.externalTransactionId
      });

      this.db
        .update(proxySessionMappings)
        .set({ stoppedAt: new Date() })
        .where(eq(proxySessionMappings.id, mapping.id))
        .run();
    }
  }

  async statusNotification(chargerId: string, params: StatusNotificationRequest) {
    await this.forwardToTargets(chargerId, 'StatusNotification', params, { canDeny: false });
  }

  async meterValues(chargerId: string, params: MeterValuesRequest) {
    if (typeof params.transactionId !== 'number') {
      await this.forwardToTargets(chargerId, 'MeterValues', params, { canDeny: false });
      return;
    }

    const mappings = this.getActiveMappings(chargerId, params.transactionId);
    for (const mapping of mappings) {
      const target = this.getEnabledTarget(chargerId, mapping.proxyTargetId);
      if (!target) continue;

      await this.callTarget(chargerId, target, 'MeterValues', {
        ...params,
        transactionId: mapping.externalTransactionId
      });
    }
  }

  async warmUpTarget(chargerId: string, proxyTargetId: string) {
    const target = this.getEnabledTarget(chargerId, proxyTargetId);
    if (!target || !this.hasActiveChargerConnection(chargerId)) return;

    const charger = this.db.select().from(chargers).where(eq(chargers.id, chargerId)).limit(1).get();
    const boot = await this.callTarget(chargerId, target, 'BootNotification', {
      chargePointVendor: charger?.chargePointVendor ?? 'Virtual OCPP',
      chargePointModel: charger?.chargePointModel ?? 'Forwarded Charger',
      firmwareVersion: charger?.firmwareVersion ?? undefined
    });

    if (!boot.ok) return;

    await this.callTarget(chargerId, target, 'StatusNotification', {
      connectorId: 1,
      errorCode: 'NoError',
      status: 'Available',
      timestamp: new Date().toISOString()
    });
    await this.callTarget(chargerId, target, 'Heartbeat', {});
  }

  async close() {
    const connections = [...this.connections.entries()];
    this.connections.clear();
    this.reconnectBackoffs.clear();

    await Promise.allSettled(
      connections.map(async ([key, connection]) => {
        try {
          connection.suppressLifecycleLogs = true;
          await connection.client?.close({ code: 1001, reason: 'Server shutting down', awaitPending: false });
        } catch (error) {
          const { chargerId, proxyTargetId } = parseConnectionKey(key);
          this.recordProxyLog({
            level: 'warn',
            message: 'proxy target connection close failed',
            chargerId,
            proxyTargetId,
            metadata: {
              errorType: error instanceof Error ? error.name : 'unknown_error',
              errorCode: getErrorCode(error)
            }
          });
        }
      })
    );
  }

  private async forwardToTargets(
    chargerId: string,
    method: string,
    params:
      | AuthorizeRequest
      | BootNotificationRequest
      | HeartbeatRequest
      | MeterValuesRequest
      | StartTransactionRequest
      | StatusNotificationRequest
      | StopTransactionRequest,
    options: { canDeny: boolean }
  ): Promise<{
    decision: AuthorizationDecision;
    responses: Array<{ target: ProxyTarget; response: ProxyResponse }>;
  }> {
    const responses: Array<{ target: ProxyTarget; response: ProxyResponse }> = [];
    const targets = this.enabledTargets(chargerId);

    for (const target of targets) {
      const response = await this.callTarget(chargerId, target, method, params);
      if (!response.ok) {
        if (options.canDeny && target.mode === 'deny-capable' && target.outagePolicy === 'fail-closed') {
          return {
            decision: {
              allowed: false,
              reason: `proxy target ${target.name} unavailable`
            },
            responses
          };
        }
        continue;
      }

      responses.push({ target, response: response.value });
      const status = response.value.idTagInfo?.status ?? 'Accepted';
      if (options.canDeny && target.mode === 'deny-capable' && status !== 'Accepted') {
        return {
          decision: {
            allowed: false,
            reason: `proxy target ${target.name} returned ${status}`
          },
          responses
        };
      }
    }

    return { decision: { allowed: true }, responses };
  }

  private async callTarget(
    chargerId: string,
    target: ProxyTarget,
    method: string,
    params: Record<string, unknown>
  ): Promise<{ ok: true; value: ProxyResponse } | { ok: false }> {
    const correlationId = randomUUID();
    this.communicationJournal?.recordProxyCall({
      chargerId,
      proxyTargetId: target.id,
      ocppMethod: method,
      payload: params,
      correlationId,
      idTag: extractIdTag(params),
      transactionId: extractTransactionId(params)
    });

    let response: ProxyResponse | undefined;
    let caughtError: unknown;
    try {
      const client = await this.getConnectedClient(chargerId, target);
      response = (await client.call(method, params, { callTimeoutMs: 5000 })) as ProxyResponse;
    } catch (error) {
      caughtError = error;
    }

    if (caughtError) {
      await this.evictConnection(chargerId, target, 'proxy target connection evicted after call failure');
      this.communicationJournal?.recordProxyError({
        chargerId,
        proxyTargetId: target.id,
        ocppMethod: method,
        payload: createErrorPayload(caughtError),
        errorCode: getErrorCode(caughtError),
        errorDescription: getErrorDescription(caughtError),
        correlationId,
        idTag: extractIdTag(params),
        transactionId: extractTransactionId(params)
      });

      this.recordProxyLog({
        level: target.outagePolicy === 'fail-closed' ? 'error' : 'warn',
        message:
          target.outagePolicy === 'fail-closed'
            ? 'proxy target unavailable, failing closed'
            : 'proxy target unavailable, failing open',
        chargerId,
        proxyTargetId: target.id,
        metadata: {
          method,
          errorType: caughtError instanceof Error ? caughtError.name : 'unknown_error',
          errorCode: getErrorCode(caughtError)
        }
      });

      return { ok: false };
    }

    const status = response?.idTagInfo?.status ?? 'Accepted';
    this.communicationJournal?.recordProxyResult({
      chargerId,
      proxyTargetId: target.id,
      ocppMethod: method,
      payload: response ?? {},
      correlationId,
      idTag: extractIdTag(params),
      transactionId: extractTransactionId(params) ?? extractTransactionId(response)
    });

    this.recordProxyLog({
      level: status === 'Accepted' ? 'info' : 'warn',
      message: status === 'Accepted' ? 'proxy target call accepted' : 'proxy target call returned rejection',
      chargerId,
      proxyTargetId: target.id,
      metadata: { method, status }
    });

    return { ok: true, value: response ?? {} };
  }

  private enabledTargets(chargerId: string) {
    const targets = this.db
      .select()
      .from(proxyTargets)
      .where(
        and(
          eq(proxyTargets.chargerId, chargerId),
          eq(proxyTargets.enabled, true)
        )
      )
      .all();

    this.closeStaleConnections(chargerId, new Set(targets.map((target) => this.connectionKey(chargerId, target.id))));
    return targets;
  }

  private getEnabledTarget(chargerId: string, proxyTargetId: string) {
    return this.db
      .select()
      .from(proxyTargets)
      .where(
        and(
          eq(proxyTargets.id, proxyTargetId),
          eq(proxyTargets.chargerId, chargerId),
          eq(proxyTargets.enabled, true)
        )
      )
      .limit(1)
      .get();
  }

  private getActiveMappings(chargerId: string, localTransactionId: number) {
    return this.db
      .select()
      .from(proxySessionMappings)
      .where(
        and(
          eq(proxySessionMappings.chargerId, chargerId),
          eq(proxySessionMappings.localTransactionId, localTransactionId),
          isNull(proxySessionMappings.stoppedAt)
        )
      )
      .all();
  }

  private hasActiveChargerConnection(chargerId: string) {
    return Boolean(
      this.db
        .select({ id: chargerConnections.id })
        .from(chargerConnections)
        .where(and(eq(chargerConnections.chargerId, chargerId), isNull(chargerConnections.disconnectedAt)))
        .limit(1)
        .get()
    );
  }

  private recordProxyLog(input: {
    level: 'info' | 'warn' | 'error';
    message: string;
    chargerId: string;
    proxyTargetId: string;
    metadata: Record<string, unknown>;
  }) {
    this.db.insert(logs).values({
      id: randomUUID(),
      level: input.level,
      category: 'proxy',
      message: input.message,
      chargerId: input.chargerId,
      metadata: JSON.stringify({
        proxyTargetId: input.proxyTargetId,
        ...input.metadata
      }),
      createdAt: new Date()
    }).run();
  }

  private async getConnectedClient(chargerId: string, target: ProxyTarget) {
    const key = this.connectionKey(chargerId, target.id);
    const signature = this.connectionSignature(chargerId, target);
    let connection = this.connections.get(key);
    const signatureChanged = Boolean(connection && connection.signature !== signature);
    const backoff = this.reconnectBackoffs.get(key);

    if (signatureChanged) {
      this.reconnectBackoffs.delete(key);
    } else if (backoff && backoff.nextAttemptAt > Date.now()) {
      throw new Error('proxy target reconnect backoff active');
    }

    if (!connection || connection.signature !== signature || !connection.client || connection.client.state === RPCClient.CLOSED) {
      const hadSuccessfulConnection = connection?.hadSuccessfulConnection ?? false;
      if (connection) {
        await this.closeConnection(key, connection, chargerId, target.id, 'proxy target connection replaced');
      }

      connection = {
        client: null,
        signature,
        connectPromise: null,
        connected: false,
        hadSuccessfulConnection,
        suppressLifecycleLogs: false
      };
      connection.client = this.createClient(chargerId, target, connection);
      this.connections.set(key, connection);
    }

    if (!connection.client || connection.client.state !== RPCClient.OPEN) {
      connection.connectPromise ??= this.connectClient(chargerId, target, connection);
      await connection.connectPromise;
    }

    return connection.client as InstanceType<typeof RPCClient>;
  }

  private async connectClient(chargerId: string, target: ProxyTarget, connection: UpstreamConnection) {
    try {
      await connection.client?.connect();
      this.reconnectBackoffs.delete(this.connectionKey(chargerId, target.id));
    } catch (error) {
      this.recordProxyLog({
        level: 'warn',
        message: connection.hadSuccessfulConnection
          ? 'proxy target connection reconnect failed'
          : 'proxy target connection failed',
        chargerId,
        proxyTargetId: target.id,
        metadata: {
          errorType: error instanceof Error ? error.name : 'unknown_error',
          errorCode: getErrorCode(error)
        }
      });
      throw error;
    } finally {
      connection.connectPromise = null;
    }
  }

  private createClient(chargerId: string, target: ProxyTarget, connection: UpstreamConnection) {
    const client = new RPCClient({
      endpoint: target.url,
      identity: target.stationId ?? chargerId,
      password: target.basicAuthPassword ?? undefined,
      protocols: ['ocpp1.6'],
      strictMode: false,
      callTimeoutMs: 5000,
      reconnect: false
    } as ConstructorParameters<typeof RPCClient>[0]) as InstanceType<typeof RPCClient>;

    client.on('open', () => {
      if (connection.suppressLifecycleLogs) return;
      connection.connected = true;
      const reconnecting = connection.hadSuccessfulConnection;
      connection.hadSuccessfulConnection = true;
      this.recordProxyLog({
        level: 'info',
        message: reconnecting ? 'proxy target connection reconnected' : 'proxy target connection established',
        chargerId,
        proxyTargetId: target.id,
        metadata: {
          identity: target.stationId ?? chargerId
        }
      });
    });

    client.on('disconnect', ({ code, reason }) => {
      if (connection.suppressLifecycleLogs) return;
      connection.connected = false;
      this.recordProxyLog({
        level: 'warn',
        message: 'proxy target connection disconnected',
        chargerId,
        proxyTargetId: target.id,
        metadata: {
          code,
          hasReason: Boolean(normalizeReason(reason)),
          identity: target.stationId ?? chargerId
        }
      });
    });

    return client;
  }

  private async evictConnection(chargerId: string, target: ProxyTarget, message: string) {
    const key = this.connectionKey(chargerId, target.id);
    const connection = this.connections.get(key);
    this.scheduleReconnectBackoff(key);
    if (!connection) return;

    await this.closeConnection(key, connection, chargerId, target.id, message);
    this.recordProxyLog({
      level: 'warn',
      message: 'proxy target connection reset after call failure',
      chargerId,
      proxyTargetId: target.id,
      metadata: {
        connectionKey: key
      }
    });
  }

  private closeStaleConnections(chargerId: string, activeKeys: Set<string>) {
    for (const [key, connection] of this.connections) {
      if (!key.startsWith(`${chargerId}:`) || activeKeys.has(key)) continue;
      this.connections.delete(key);
      this.reconnectBackoffs.delete(key);
      const { proxyTargetId } = parseConnectionKey(key);
      void this.closeConnection(key, connection, chargerId, proxyTargetId, 'proxy target connection closed because target is no longer enabled');
    }
  }

  async invalidateTarget(chargerId: string, proxyTargetId: string, message = 'proxy target connection invalidated') {
    const key = this.connectionKey(chargerId, proxyTargetId);
    const connection = this.connections.get(key);
    this.connections.delete(key);
    this.reconnectBackoffs.delete(key);
    if (!connection) return;

    await this.closeConnection(key, connection, chargerId, proxyTargetId, message);
  }

  private scheduleReconnectBackoff(key: string) {
    const current = this.reconnectBackoffs.get(key);
    const failures = (current?.failures ?? 0) + 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** (failures - 1));
    this.reconnectBackoffs.set(key, {
      failures,
      nextAttemptAt: Date.now() + delayMs
    });
  }

  private async closeConnection(
    key: string,
    connection: UpstreamConnection,
    chargerId: string,
    proxyTargetId: string,
    message: string
  ) {
    try {
      connection.suppressLifecycleLogs = true;
      connection.connected = false;
      await connection.client?.close({ code: 1000, reason: message, awaitPending: false });
    } catch (error) {
      this.recordProxyLog({
        level: 'warn',
        message: 'proxy target connection close failed',
        chargerId,
        proxyTargetId,
        metadata: {
          connectionKey: key,
          errorType: error instanceof Error ? error.name : 'unknown_error',
          errorCode: getErrorCode(error)
        }
      });
    } finally {
      connection.client = null;
      connection.connectPromise = null;
      connection.connected = false;
      connection.suppressLifecycleLogs = false;
    }
  }

  private connectionKey(chargerId: string, proxyTargetId: string) {
    return `${chargerId}:${proxyTargetId}`;
  }

  private connectionSignature(chargerId: string, target: ProxyTarget) {
    return JSON.stringify({
      url: target.url,
      identity: target.stationId ?? chargerId,
      password: target.basicAuthPassword ?? null
    });
  }
}

function parseConnectionKey(key: string) {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex === -1) {
    return { chargerId: key, proxyTargetId: key };
  }

  return {
    chargerId: key.slice(0, separatorIndex),
    proxyTargetId: key.slice(separatorIndex + 1)
  };
}

function normalizeReason(reason: unknown) {
  const value = Buffer.isBuffer(reason) ? reason.toString('utf8') : reason;
  if (typeof value !== 'string') return null;
  return value.slice(0, 120);
}

function createErrorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: 'proxy target call failed',
      code: getErrorCode(error)
    };
  }

  return {
    message: 'proxy target call failed'
  };
}

function extractIdTag(params: Record<string, unknown>) {
  if (!params || typeof params !== 'object') return null;
  const idTag = (params as { idTag?: unknown }).idTag;
  return typeof idTag === 'string' ? idTag : null;
}

function extractTransactionId(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const transactionId = (value as { transactionId?: unknown }).transactionId;
  return typeof transactionId === 'number' ? transactionId : null;
}

function getErrorDescription(error: unknown) {
  if (error instanceof Error) {
    return error.name;
  }

  return 'unknown_error';
}

function getErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }

  return null;
}
