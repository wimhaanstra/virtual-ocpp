import { randomUUID } from 'node:crypto';
import type { CommunicationJournalService } from '../communication-journal.js';

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

  async remoteStopTransaction(chargerId: string, transactionId: number): Promise<RemoteStopResult> {
    const client = this.clients.get(chargerId);
    if (!client) {
      throw new ChargerCommandError('charger_not_connected', `Charger ${chargerId} is not connected`);
    }

    const correlationId = randomUUID();
    const payload = { transactionId };
    this.communicationJournal?.recordEntry({
      direction: 'outbound',
      sourceType: 'server',
      sourceId: 'server',
      targetType: 'charger',
      targetId: chargerId,
      chargerId,
      messageType: 'call',
      ocppMethod: 'RemoteStopTransaction',
      transactionId,
      payload,
      correlationId
    });

    try {
      const response = (await client.call('RemoteStopTransaction', payload, { callTimeoutMs: 5000 })) as { status?: unknown };
      const status = typeof response.status === 'string' ? response.status : 'Unknown';
      this.communicationJournal?.recordEntry({
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: chargerId,
        targetType: 'server',
        targetId: 'server',
        chargerId,
        messageType: 'callResult',
        ocppMethod: 'RemoteStopTransaction',
        transactionId,
        payload: response,
        correlationId
      });
      return { status };
    } catch (error) {
      this.communicationJournal?.recordEntry({
        direction: 'inbound',
        sourceType: 'charger',
        sourceId: chargerId,
        targetType: 'server',
        targetId: 'server',
        chargerId,
        messageType: 'callError',
        ocppMethod: 'RemoteStopTransaction',
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
