import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { RPCClient } from 'ocpp-rpc';
import type { CommunicationJournalService } from '../communication-journal.js';
import type { Database } from '../db/client.js';
import { logs, proxySessionMappings, proxyTargets } from '../db/schema.js';
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

export class ProxyAuthorizationService {
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

    const client = new RPCClient({
      endpoint: target.url,
      identity: target.stationId ?? chargerId,
      password: target.basicAuthPassword ?? undefined,
      protocols: ['ocpp1.6'],
      strictMode: false,
      callTimeoutMs: 5000,
      reconnect: false
    } as ConstructorParameters<typeof RPCClient>[0]);

    let response: ProxyResponse | undefined;
    let caughtError: unknown;
    try {
      await client.connect();
      response = (await client.call(method, params, { callTimeoutMs: 5000 })) as ProxyResponse;
    } catch (error) {
      caughtError = error;
    } finally {
      try {
        await client.close({});
      } catch {
        // Ignore close errors so the call result/error is captured from the RPC exchange itself.
      }
    }

    if (caughtError) {
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
          error: caughtError instanceof Error ? caughtError.message : 'unknown_error'
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
    return this.db
      .select()
      .from(proxyTargets)
      .where(
        and(
          eq(proxyTargets.chargerId, chargerId),
          eq(proxyTargets.enabled, true)
        )
      )
      .all();
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
}

function createErrorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: getErrorCode(error)
    };
  }

  return {
    message: 'unknown_error'
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
    return error.message;
  }

  return 'unknown_error';
}

function getErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }

  return null;
}
