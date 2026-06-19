import { createRPCError } from 'ocpp-rpc';
import { ProxyAuthorizationService } from './proxy-service.js';
import { OcppRepository } from './repository.js';
import type {
  AuthorizeRequest,
  BootNotificationRequest,
  HeartbeatRequest,
  MeterValuesRequest,
  OcppHandlerContext,
  StartTransactionRequest,
  StatusNotificationRequest,
  StopTransactionRequest
} from './types.js';

const HEARTBEAT_INTERVAL_SECONDS = 60;
let nextTransactionId = Date.now();

export class OcppHandlers {
  constructor(
    private readonly repository: OcppRepository,
    private readonly proxyAuthorization: ProxyAuthorizationService
  ) {}

  async bootNotification(context: OcppHandlerContext, params: BootNotificationRequest) {
    this.repository.recordBootNotification(context.chargerId, params);

    this.repository.recordLog({
      category: 'ocpp',
      message: 'boot notification accepted',
      chargerId: context.chargerId,
      metadata: {
        vendor: params.chargePointVendor,
        model: params.chargePointModel,
        firmwareVersion: params.firmwareVersion
      }
    });

    await this.proxyAuthorization.bootNotification(context.chargerId, params);

    return {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: HEARTBEAT_INTERVAL_SECONDS
    };
  }

  async heartbeat(context: OcppHandlerContext, params: HeartbeatRequest) {
    await this.proxyAuthorization.heartbeat(context.chargerId, params);

    return {
      currentTime: new Date().toISOString()
    };
  }

  async authorize(context: OcppHandlerContext, params: AuthorizeRequest) {
    let status = this.repository.isTagAllowed(context.chargerId, params.idTag) ? 'Accepted' : 'Invalid';

    if (status === 'Accepted') {
      const proxyDecision = await this.proxyAuthorization.authorize(context.chargerId, params);
      if (!proxyDecision.allowed) {
        status = 'Invalid';
        this.repository.recordLog({
          level: 'warn',
          category: 'authorization',
          message: 'proxy target denied tag',
          chargerId: context.chargerId,
          metadata: {
            reason: proxyDecision.reason
          }
        });
      }
    }

    this.repository.recordLog({
      level: status === 'Accepted' ? 'info' : 'warn',
      category: 'authorization',
      message: status === 'Accepted' ? 'tag authorized' : 'tag denied',
      chargerId: context.chargerId,
      metadata: {
        hasTag: Boolean(params.idTag),
        status
      }
    });

    return {
      idTagInfo: {
        status
      }
    };
  }

  async startTransaction(context: OcppHandlerContext, params: StartTransactionRequest) {
    let idTagStatus = this.repository.isTagAllowed(context.chargerId, params.idTag) ? 'Accepted' : 'Invalid';
    const transactionId = nextTransactionId++;

    if (idTagStatus === 'Accepted') {
      const proxyDecision = await this.proxyAuthorization.startTransaction(context.chargerId, transactionId, params);
      if (!proxyDecision.allowed) {
        idTagStatus = 'Invalid';
        this.repository.recordLog({
          level: 'warn',
          category: 'authorization',
          message: 'proxy target denied start transaction',
          chargerId: context.chargerId,
          transactionId,
          metadata: {
            reason: proxyDecision.reason
          }
        });
      }
    }

    if (idTagStatus === 'Accepted') {
      this.repository.createSession({
        chargerId: context.chargerId,
        connectorId: params.connectorId ?? 0,
        transactionId,
        idTag: params.idTag,
        startedAt: parseOcppDate(params.timestamp),
        meterStart: params.meterStart
      });
    } else {
      this.repository.recordLog({
        level: 'warn',
        category: 'authorization',
        message: 'start transaction denied',
        chargerId: context.chargerId,
        transactionId,
        metadata: {
          hasTag: Boolean(params.idTag)
        }
      });
    }

    return {
      transactionId,
      idTagInfo: {
        status: idTagStatus
      }
    };
  }

  async stopTransaction(context: OcppHandlerContext, params: StopTransactionRequest) {
    if (typeof params.transactionId !== 'number') {
      throw createRPCError('ProtocolError', 'transactionId is required');
    }

    this.repository.stopSession({
      chargerId: context.chargerId,
      transactionId: params.transactionId,
      stoppedAt: parseOcppDate(params.timestamp),
      meterStop: params.meterStop,
      reason: params.reason
    });

    await this.proxyAuthorization.stopTransaction(context.chargerId, params);

    return {
      idTagInfo: {
        status: 'Accepted'
      }
    };
  }

  async statusNotification(context: OcppHandlerContext, params: StatusNotificationRequest) {
    this.repository.recordLog({
      category: 'status',
      message: 'charger status notification',
      chargerId: context.chargerId,
      metadata: {
        connectorId: params.connectorId,
        status: params.status,
        errorCode: params.errorCode,
        timestamp: params.timestamp
      }
    });

    await this.proxyAuthorization.statusNotification(context.chargerId, params);

    return {};
  }

  async meterValues(context: OcppHandlerContext, params: MeterValuesRequest) {
    for (const meterValue of params.meterValue ?? []) {
      for (const sampledValue of meterValue.sampledValue ?? []) {
        if (!sampledValue.value) continue;

        this.repository.recordMeterSample({
          chargerId: context.chargerId,
          connectorId: params.connectorId ?? 0,
          transactionId: params.transactionId,
          sampledAt: parseOcppDate(meterValue.timestamp),
          value: sampledValue.value,
          measurand: sampledValue.measurand,
          unit: sampledValue.unit,
          context: sampledValue.context
        });
      }
    }

    await this.proxyAuthorization.meterValues(context.chargerId, params);

    return {};
  }
}

function parseOcppDate(value: string | undefined) {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
