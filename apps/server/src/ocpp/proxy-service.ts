import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { RPCClient } from 'ocpp-rpc';
import type { CommunicationJournalService } from '../communication-journal.js';
import type { Database } from '../db/client.js';
import { chargerConnections, chargers, proxySessionMappings, proxyTagMappings, proxyTargets } from '../db/schema.js';
import type { LiveUpdateBus } from '../live-updates.js';
import { recordLogEntry } from '../log-writer.js';
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
type ProxyStopResult = {
  proxyTargetId: string;
  proxyTargetName: string;
  externalTransactionId: number;
  attempted: boolean;
  ok: boolean;
};
type RecoverySubmitResult = {
  proxyTargetId: string;
  proxyTargetName: string;
  attempted: boolean;
  ok: boolean;
  reason?: string;
  externalTransactionId?: number;
};
type ManualStopResult = {
  proxyTargetId: string;
  proxyTargetName: string;
  externalTransactionId: number;
  attempted: boolean;
  ok: boolean;
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
type ReconnectTimer = ReturnType<typeof setTimeout>;
type RuntimeHealth = {
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastErrorCode: string | null;
};

export class ProxyAuthorizationService {
  private readonly connections = new Map<string, UpstreamConnection>();
  private readonly reconnectBackoffs = new Map<string, ReconnectBackoff>();
  private readonly reconnectTimers = new Map<string, ReconnectTimer>();
  private readonly runtimeHealth = new Map<string, RuntimeHealth>();
  private closed = false;

  constructor(
    private readonly db: Database,
    private readonly communicationJournal?: CommunicationJournalService,
    private readonly liveUpdates?: LiveUpdateBus
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

    await this.stopTransactionForMappings(chargerId, params);
  }

  async forceStopTransaction(chargerId: string, params: StopTransactionRequest): Promise<ProxyStopResult[]> {
    if (typeof params.transactionId !== 'number') return [];

    return this.stopTransactionForMappings(chargerId, params);
  }

  async manualStopTransaction(
    chargerId: string,
    proxyTargetId: string,
    localTransactionId: number,
    params: StopTransactionRequest
  ): Promise<ManualStopResult> {
    if (typeof params.transactionId !== 'number') {
      return {
        proxyTargetId,
        proxyTargetName: proxyTargetId,
        externalTransactionId: 0,
        attempted: false,
        ok: false
      };
    }

    const externalTransactionId = params.transactionId;
    const target = this.getEnabledTarget(chargerId, proxyTargetId);
    if (!target) {
      return {
        proxyTargetId,
        proxyTargetName: proxyTargetId,
        externalTransactionId,
        attempted: false,
        ok: false
      };
    }

    const response = await this.callTarget(chargerId, target, 'StopTransaction', this.applyTagMapping(target.id, 'StopTransaction', params));
    if (response.ok) {
      this.upsertManualStoppedMapping(chargerId, target.id, localTransactionId, externalTransactionId);
    }

    return {
      proxyTargetId: target.id,
      proxyTargetName: target.name,
      externalTransactionId,
      attempted: true,
      ok: response.ok
    };
  }

  getRecoverySubmissionTargets(
    chargerId: string,
    input?: {
      connectorId: number;
      idTag: string;
      meterStart: number;
      meterStop: number;
      startAt: string;
      stopAt: string;
    }
  ) {
    return this.db
      .select()
      .from(proxyTargets)
      .where(and(eq(proxyTargets.chargerId, chargerId), eq(proxyTargets.enabled, true), eq(proxyTargets.allowRecoverySubmissions, true)))
      .all()
      .map((target) => {
        const startTransaction = input
          ? (this.applyTagMapping(target.id, 'StartTransaction', {
              connectorId: input.connectorId,
              idTag: input.idTag,
              meterStart: input.meterStart,
              timestamp: input.startAt
            }) as StartTransactionRequest)
          : null;
        const stopTransaction = input
          ? (this.applyTagMapping(target.id, 'StopTransaction', {
              idTag: startTransaction?.idTag ?? input.idTag,
              meterStop: input.meterStop,
              timestamp: input.stopAt,
              reason: 'Other'
            }) as Omit<StopTransactionRequest, 'transactionId'>)
          : null;

        return {
          proxyTargetId: target.id,
          proxyTargetName: target.name,
          hasActiveTransaction: this.hasActiveProxyMapping(chargerId, target.id),
          ...(startTransaction && stopTransaction ? { startTransaction, stopTransaction } : {})
        };
      });
  }

  async submitRecoveryTransaction(
    chargerId: string,
    input: {
      connectorId: number;
      idTag: string;
      meterStart: number;
      meterStop: number;
      startAt: string;
      stopAt: string;
    }
  ): Promise<RecoverySubmitResult[]> {
    const targets = this.db
      .select()
      .from(proxyTargets)
      .where(and(eq(proxyTargets.chargerId, chargerId), eq(proxyTargets.enabled, true), eq(proxyTargets.allowRecoverySubmissions, true)))
      .all();
    const results: RecoverySubmitResult[] = [];

    for (const [index, target] of targets.entries()) {
      if (this.hasActiveProxyMapping(chargerId, target.id)) {
        results.push({
          proxyTargetId: target.id,
          proxyTargetName: target.name,
          attempted: false,
          ok: false,
          reason: 'active_proxy_transaction'
        });
        continue;
      }

      const startParams = this.applyTagMapping(target.id, 'StartTransaction', {
        connectorId: input.connectorId,
        idTag: input.idTag,
        meterStart: input.meterStart,
        timestamp: input.startAt
      }) as StartTransactionRequest;
      const start = await this.callTarget(chargerId, target, 'StartTransaction', startParams);
      if (!start.ok || typeof start.value.transactionId !== 'number') {
        results.push({
          proxyTargetId: target.id,
          proxyTargetName: target.name,
          attempted: true,
          ok: false,
          reason: 'start_transaction_failed'
        });
        continue;
      }

      const recoveryMappingId = randomUUID();
      const stoppedAt = new Date();
      this.db.insert(proxySessionMappings).values({
        id: recoveryMappingId,
        chargerId,
        proxyTargetId: target.id,
        localTransactionId: -1_000_000_000 - index,
        externalTransactionId: start.value.transactionId,
        createdAt: new Date()
      }).run();

      const stopParams = this.applyTagMapping(target.id, 'StopTransaction', {
        transactionId: start.value.transactionId,
        idTag: startParams.idTag,
        meterStop: input.meterStop,
        timestamp: input.stopAt,
        reason: 'Other'
      }) as StopTransactionRequest;
      const stop = await this.callTarget(chargerId, target, 'StopTransaction', stopParams);
      if (stop.ok) {
        this.db.update(proxySessionMappings).set({ stoppedAt }).where(eq(proxySessionMappings.id, recoveryMappingId)).run();
      }
      results.push({
        proxyTargetId: target.id,
        proxyTargetName: target.name,
        attempted: true,
        ok: stop.ok,
        externalTransactionId: start.value.transactionId,
        reason: stop.ok ? undefined : 'stop_transaction_failed'
      });
    }

    return results;
  }

  private async stopTransactionForMappings(chargerId: string, params: StopTransactionRequest): Promise<ProxyStopResult[]> {
    if (typeof params.transactionId !== 'number') return [];

    const stoppedAt = new Date();
    const results: ProxyStopResult[] = [];
    const mappings = this.getActiveMappings(chargerId, params.transactionId);
    for (const mapping of mappings) {
      const target = this.getEnabledTarget(chargerId, mapping.proxyTargetId);
      if (!target) {
        results.push({
          proxyTargetId: mapping.proxyTargetId,
          proxyTargetName: mapping.proxyTargetId,
          externalTransactionId: mapping.externalTransactionId,
          attempted: false,
          ok: false
        });
        this.db
          .update(proxySessionMappings)
          .set({ stoppedAt })
          .where(eq(proxySessionMappings.id, mapping.id))
          .run();
        continue;
      }

      const response = await this.callTarget(chargerId, target, 'StopTransaction', {
        ...params,
        transactionId: mapping.externalTransactionId
      });
      results.push({
        proxyTargetId: target.id,
        proxyTargetName: target.name,
        externalTransactionId: mapping.externalTransactionId,
        attempted: true,
        ok: response.ok
      });

      this.db
        .update(proxySessionMappings)
        .set({ stoppedAt })
        .where(eq(proxySessionMappings.id, mapping.id))
        .run();
    }

    return results;
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
    if (this.closed) return;

    const target = this.getEnabledTarget(chargerId, proxyTargetId);
    if (!target || !this.hasActiveChargerConnection(chargerId)) return;

    await this.warmUpEnabledTarget(chargerId, target);
  }

  async warmUpTargets(chargerId: string) {
    if (this.closed) return;
    if (!this.hasActiveChargerConnection(chargerId)) return;

    for (const target of this.enabledTargets(chargerId)) {
      await this.warmUpEnabledTarget(chargerId, target);
    }
  }

  private async warmUpEnabledTarget(chargerId: string, target: ProxyTarget) {
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
    this.closed = true;
    const connections = [...this.connections.entries()];
    this.connections.clear();
    this.reconnectBackoffs.clear();
    this.clearReconnectTimers();

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

  getHealth(chargerId?: string) {
    const targets = chargerId
      ? this.db.select().from(proxyTargets).where(eq(proxyTargets.chargerId, chargerId)).all()
      : this.db.select().from(proxyTargets).all();

    const items = targets.map((target) => {
      const targetChargerId = target.chargerId ?? '';
      const key = this.connectionKey(targetChargerId, target.id);
      const connection = this.connections.get(key);
      const backoff = this.reconnectBackoffs.get(key);
      const runtime = this.runtimeHealth.get(key);
      const chargerConnected = target.chargerId ? this.hasActiveChargerConnection(target.chargerId) : false;
      const connected = Boolean(connection?.connected || connection?.client?.state === RPCClient.OPEN);
      const connecting = Boolean(connection?.connectPromise);
      const nextReconnectAt = backoff?.nextAttemptAt ? new Date(backoff.nextAttemptAt) : null;
      const state = getProxyHealthState({
        enabled: target.enabled,
        chargerConnected,
        connected,
        connecting,
        nextReconnectAt,
        hadSuccessfulConnection: connection?.hadSuccessfulConnection ?? Boolean(runtime?.lastConnectedAt)
      });

      return {
        proxyTargetId: target.id,
        name: target.name,
        chargerId: target.chargerId,
        enabled: target.enabled,
        mode: target.mode,
        outagePolicy: target.outagePolicy,
        connected,
        state,
        detail: getProxyHealthDetail(state),
        upstreamIdentity: target.stationId ?? target.chargerId,
        hadSuccessfulConnection: connection?.hadSuccessfulConnection ?? Boolean(runtime?.lastConnectedAt),
        lastConnectedAt: runtime?.lastConnectedAt?.toISOString() ?? null,
        lastDisconnectedAt: runtime?.lastDisconnectedAt?.toISOString() ?? null,
        lastSuccessAt: runtime?.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: runtime?.lastFailureAt?.toISOString() ?? null,
        nextReconnectAt: nextReconnectAt?.toISOString() ?? null,
        lastErrorCode: runtime?.lastErrorCode ?? null
      };
    });

    return {
      chargerId: chargerId ?? null,
      summary: {
        total: items.length,
        connected: items.filter((item) => item.state === 'connected').length,
        backoff: items.filter((item) => item.state === 'backoff').length,
        waitingForCharger: items.filter((item) => item.state === 'waiting_for_charger').length,
        disabled: items.filter((item) => item.state === 'disabled').length
      },
      targets: items
    };
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
      const outboundParams = this.applyTagMapping(target.id, method, params);
      const response = await this.callTarget(chargerId, target, method, outboundParams);
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

  private applyTagMapping(
    proxyTargetId: string,
    method: string,
    params:
      | AuthorizeRequest
      | BootNotificationRequest
      | HeartbeatRequest
      | MeterValuesRequest
      | StartTransactionRequest
      | StatusNotificationRequest
      | StopTransactionRequest
  ) {
    if (method !== 'Authorize' && method !== 'StartTransaction' && method !== 'StopTransaction') return params;
    const idTag = extractIdTag(params);
    if (!idTag) return params;

    const mapping = this.db
      .select()
      .from(proxyTagMappings)
      .where(and(eq(proxyTagMappings.proxyTargetId, proxyTargetId), eq(proxyTagMappings.localIdTag, idTag)))
      .limit(1)
      .get();
    if (!mapping) return params;

    return {
      ...params,
      idTag: mapping.outboundIdTag
    };
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
      this.updateRuntimeHealth(chargerId, target.id, {
        lastFailureAt: new Date(),
        lastErrorCode: getErrorCode(caughtError)
      });
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
    this.updateRuntimeHealth(chargerId, target.id, {
      lastSuccessAt: new Date(),
      lastErrorCode: null
    });
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

    targets.sort(compareProxyTargetsForPolicy);
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

  private hasActiveProxyMapping(chargerId: string, proxyTargetId: string) {
    return Boolean(
      this.db
        .select({ id: proxySessionMappings.id })
        .from(proxySessionMappings)
        .where(
          and(
            eq(proxySessionMappings.chargerId, chargerId),
            eq(proxySessionMappings.proxyTargetId, proxyTargetId),
            isNull(proxySessionMappings.stoppedAt)
          )
        )
        .limit(1)
        .get()
    );
  }

  private upsertManualStoppedMapping(chargerId: string, proxyTargetId: string, localTransactionId: number, externalTransactionId: number) {
    const stoppedAt = new Date();
    const existing = this.db
      .select()
      .from(proxySessionMappings)
      .where(
        and(
          eq(proxySessionMappings.chargerId, chargerId),
          eq(proxySessionMappings.proxyTargetId, proxyTargetId),
          eq(proxySessionMappings.localTransactionId, localTransactionId)
        )
      )
      .limit(1)
      .get();

    if (existing) {
      this.db.update(proxySessionMappings).set({ externalTransactionId, stoppedAt }).where(eq(proxySessionMappings.id, existing.id)).run();
      return;
    }

    this.db.insert(proxySessionMappings).values({
      id: randomUUID(),
      chargerId,
      proxyTargetId,
      localTransactionId,
      externalTransactionId,
      createdAt: stoppedAt,
      stoppedAt
    }).run();
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
    recordLogEntry(this.db, this.liveUpdates, {
      level: input.level,
      category: 'proxy',
      message: input.message,
      chargerId: input.chargerId,
      metadata: {
        proxyTargetId: input.proxyTargetId,
        ...input.metadata
      }
    });
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
      const key = this.connectionKey(chargerId, target.id);
      this.reconnectBackoffs.delete(key);
      this.clearReconnectTimer(key);
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
      this.updateRuntimeHealth(chargerId, target.id, {
        lastConnectedAt: new Date(),
        lastErrorCode: null
      });
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
      this.updateRuntimeHealth(chargerId, target.id, {
        lastDisconnectedAt: new Date(),
        lastFailureAt: new Date(),
        lastErrorCode: typeof code === 'number' ? String(code) : null
      });
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
      this.scheduleReconnect(chargerId, target.id);
    });

    return client;
  }

  private async evictConnection(chargerId: string, target: ProxyTarget, message: string) {
    const key = this.connectionKey(chargerId, target.id);
    const connection = this.connections.get(key);
    this.scheduleReconnect(chargerId, target.id);
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
      this.clearReconnectTimer(key);
      const { proxyTargetId } = parseConnectionKey(key);
      void this.closeConnection(key, connection, chargerId, proxyTargetId, 'proxy target connection closed because target is no longer enabled');
    }
  }

  async invalidateTarget(chargerId: string, proxyTargetId: string, message = 'proxy target connection invalidated') {
    const key = this.connectionKey(chargerId, proxyTargetId);
    const connection = this.connections.get(key);
    this.connections.delete(key);
    this.reconnectBackoffs.delete(key);
    this.clearReconnectTimer(key);
    if (!connection) return;

    await this.closeConnection(key, connection, chargerId, proxyTargetId, message);
  }

  private scheduleReconnect(chargerId: string, proxyTargetId: string) {
    if (this.closed) return;

    const key = this.connectionKey(chargerId, proxyTargetId);
    if (this.reconnectTimers.has(key)) return;

    const delayMs = this.scheduleReconnectBackoff(key);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(key);
      void this.retryWarmUp(chargerId, proxyTargetId);
    }, delayMs + 10);
    this.reconnectTimers.set(key, timer);
  }

  private scheduleReconnectBackoff(key: string) {
    const current = this.reconnectBackoffs.get(key);
    const failures = (current?.failures ?? 0) + 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** (failures - 1));
    this.reconnectBackoffs.set(key, {
      failures,
      nextAttemptAt: Date.now() + delayMs
    });
    return delayMs;
  }

  private async retryWarmUp(chargerId: string, proxyTargetId: string) {
    if (this.closed) return;

    const target = this.getEnabledTarget(chargerId, proxyTargetId);
    if (!target || !this.hasActiveChargerConnection(chargerId)) {
      this.reconnectBackoffs.delete(this.connectionKey(chargerId, proxyTargetId));
      return;
    }

    await this.warmUpEnabledTarget(chargerId, target);
  }

  private clearReconnectTimer(key: string) {
    const timer = this.reconnectTimers.get(key);
    if (!timer) return;

    clearTimeout(timer);
    this.reconnectTimers.delete(key);
  }

  private clearReconnectTimers() {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
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
      this.updateRuntimeHealth(chargerId, proxyTargetId, {
        lastDisconnectedAt: new Date()
      });
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

  private updateRuntimeHealth(chargerId: string, proxyTargetId: string, update: Partial<RuntimeHealth>) {
    const key = this.connectionKey(chargerId, proxyTargetId);
    const current = this.runtimeHealth.get(key) ?? {
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null
    };
    this.runtimeHealth.set(key, {
      ...current,
      ...update
    });
    this.liveUpdates?.publish({
      type: 'proxy.health.changed',
      chargerId,
      proxyTargetId,
      reason: update.lastDisconnectedAt
        ? 'disconnected'
        : update.lastConnectedAt
          ? 'connected'
          : update.lastFailureAt
            ? 'failure'
            : update.lastSuccessAt
              ? 'success'
              : 'updated'
    });
  }
}

function getProxyHealthState(input: {
  enabled: boolean;
  chargerConnected: boolean;
  connected: boolean;
  connecting: boolean;
  nextReconnectAt: Date | null;
  hadSuccessfulConnection: boolean;
}) {
  if (!input.enabled) return 'disabled';
  if (!input.chargerConnected) return 'waiting_for_charger';
  if (input.connected) return 'connected';
  if (input.connecting) return 'connecting';
  if (input.nextReconnectAt && input.nextReconnectAt.getTime() > Date.now()) return 'backoff';
  if (input.hadSuccessfulConnection) return 'disconnected';
  return 'unknown';
}

function getProxyHealthDetail(state: string) {
  switch (state) {
    case 'connected':
      return 'Upstream connection is open.';
    case 'connecting':
      return 'Connecting to upstream target.';
    case 'backoff':
      return 'Reconnect backoff is active.';
    case 'waiting_for_charger':
      return 'Waiting for the local charger to connect.';
    case 'disabled':
      return 'Target is disabled.';
    case 'disconnected':
      return 'Upstream connection is disconnected.';
    default:
      return 'No runtime proxy activity yet.';
  }
}

function compareProxyTargetsForPolicy(left: ProxyTarget, right: ProxyTarget) {
  const createdDiff = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdDiff !== 0) return createdDiff;

  const nameDiff = left.name.localeCompare(right.name);
  if (nameDiff !== 0) return nameDiff;

  return left.id.localeCompare(right.id);
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
