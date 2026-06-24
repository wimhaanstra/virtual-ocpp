import { randomUUID } from 'node:crypto';
import type { CommunicationJournalService } from '../communication-journal.js';
import type {
  ChangeConfigurationRequest,
  ChangeConfigurationResponse,
  GetConfigurationRequest,
  GetConfigurationResponse,
  TriggerMessageRequest,
  TriggerMessageResponse
} from './types.js';

type ConnectedChargerClient = {
  call: (method: string, params: Record<string, unknown>, options?: { callTimeoutMs?: number }) => Promise<unknown>;
  close: (options?: { code?: number; reason?: string; awaitPending?: boolean }) => Promise<unknown>;
};

export type RemoteStopResult = {
  status: string;
};

export class ChargerCommandService {
  private readonly clients = new Map<string, ConnectedChargerClient>();

  constructor(private readonly communicationJournal?: CommunicationJournalService) {}

  register(chargerId: string, client: ConnectedChargerClient) {
    this.clients.set(chargerId, client);
  }

  unregister(chargerId: string, client: ConnectedChargerClient) {
    if (this.clients.get(chargerId) === client) {
      this.clients.delete(chargerId);
    }
  }

  async closeCharger(chargerId: string, reason = 'charger deleted') {
    const client = this.clients.get(chargerId);
    if (!client) return false;

    this.clients.delete(chargerId);

    try {
      await client.close({ code: 1000, reason, awaitPending: false });
      return true;
    } catch {
      return false;
    }
  }

  async getConfiguration(chargerId: string, params: GetConfigurationRequest): Promise<GetConfigurationResponse> {
    return this.callCharger<GetConfigurationRequest, GetConfigurationResponse>(chargerId, 'GetConfiguration', params);
  }

  async changeConfiguration(chargerId: string, params: ChangeConfigurationRequest): Promise<ChangeConfigurationResponse> {
    return this.callCharger<ChangeConfigurationRequest, ChangeConfigurationResponse>(chargerId, 'ChangeConfiguration', params);
  }

  async triggerMessage(chargerId: string, params: TriggerMessageRequest): Promise<TriggerMessageResponse> {
    return this.callCharger<TriggerMessageRequest, TriggerMessageResponse>(chargerId, 'TriggerMessage', params);
  }

  async remoteStopTransaction(chargerId: string, transactionId: number): Promise<RemoteStopResult> {
    return this.callCharger<{ transactionId: number }, RemoteStopResult>(chargerId, 'RemoteStopTransaction', { transactionId }, transactionId);
  }

  private async callCharger<TParams extends object, TResult extends Record<string, unknown>>(
    chargerId: string,
    method: string,
    payload: TParams,
    transactionId?: number
  ): Promise<TResult> {
    const client = this.clients.get(chargerId);
    if (!client) {
      throw new ChargerCommandError('charger_not_connected', `Charger ${chargerId} is not connected`);
    }

    const correlationId = randomUUID();
    this.communicationJournal?.recordEntry({
      direction: 'outbound',
      sourceType: 'server',
      sourceId: 'server',
      targetType: 'charger',
      targetId: chargerId,
      chargerId,
      messageType: 'call',
      ocppMethod: method,
      transactionId,
      payload,
      correlationId
    });

    try {
      const response = (await client.call(method, payload as Record<string, unknown>, { callTimeoutMs: 5000 })) as TResult;
      this.communicationJournal?.recordEntry({
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: chargerId,
        targetType: 'server',
        targetId: 'server',
        chargerId,
        messageType: 'callResult',
        ocppMethod: method,
        transactionId,
        payload: response,
        correlationId
      });
      return response;
    } catch (error) {
      this.communicationJournal?.recordEntry({
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: chargerId,
        targetType: 'server',
        targetId: 'server',
        chargerId,
        messageType: 'callError',
        ocppMethod: method,
        transactionId,
        payload: serializeErrorPayload(error),
        errorCode: getErrorCode(error),
        errorDescription: getErrorDescription(error),
        correlationId
      });
      throw error;
    }
  }
}

export class ChargerCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ChargerCommandError';
  }
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
