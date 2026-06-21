import { createRPCError } from 'ocpp-rpc';
import { ProxyAuthorizationService } from './proxy-service.js';
import { OcppRepository } from './repository.js';
import type {
  AuthorizeRequest,
  BootNotificationRequest,
  HeartbeatRequest,
  MeterValuesRequest,
  OcppHandlerContext,
  SampledValue,
  StartTransactionRequest,
  StatusNotificationRequest,
  StopTransactionRequest
} from './types.js';

const HEARTBEAT_INTERVAL_SECONDS = 60;
let nextTransactionId = Date.now();

export class OcppHandlers {
  constructor(
    private readonly repository: OcppRepository,
    private readonly proxyAuthorization: ProxyAuthorizationService,
    private readonly meterGapThresholdWh = 1000
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

  async firmwareStatusNotification(context: OcppHandlerContext, params: Record<string, unknown>) {
    this.repository.recordLog({
      category: 'ocpp',
      message: 'firmware status notification received',
      chargerId: context.chargerId,
      metadata: {
        status: typeof params.status === 'string' ? params.status : null
      }
    });

    return {};
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
      const startedAt = parseOcppDate(params.timestamp);
      const replacedSessions = this.repository.getActiveSessionsForConnector(context.chargerId, params.connectorId ?? 0);
      for (const session of replacedSessions) {
        const stopTransaction = this.repository.buildReplacementStopTransaction(session, startedAt);
        await this.proxyAuthorization.forceStopTransaction(context.chargerId, stopTransaction);
        this.repository.stopSession({
          chargerId: context.chargerId,
          transactionId: session.transactionId,
          stoppedAt: startedAt,
          meterStop: stopTransaction.meterStop,
          reason: 'ReplacedByNewTransaction'
        });
      }
      const sessionId = this.repository.createSession({
        chargerId: context.chargerId,
        connectorId: params.connectorId ?? 0,
        transactionId,
        idTag: params.idTag,
        startedAt,
        meterStart: params.meterStart
      });
      this.repository.detectMeterGapForSession({
        chargerId: context.chargerId,
        connectorId: params.connectorId ?? 0,
        newSessionId: sessionId,
        startedAt,
        meterStart: params.meterStart,
        thresholdWh: this.meterGapThresholdWh
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

    if (params.transactionId === -1) {
      const stoppedAt = parseOcppDateOrNull(params.timestamp);
      if (!stoppedAt) {
        this.repository.recordLog({
          level: 'warn',
          category: 'session',
          message: 'unmatched stop transaction recovery candidate',
          chargerId: context.chargerId,
          transactionId: params.transactionId,
          metadata: {
            reason: params.reason ?? null,
            meterStop: params.meterStop ?? null,
            idTag: params.idTag ?? null,
            timestamp: params.timestamp ?? null,
            recoveryReason: 'missing_or_invalid_timestamp'
          }
        });
        return {
          idTagInfo: {
            status: 'Accepted'
          }
        };
      }

      const recovery = this.repository.findRecoverableStopTransactionSession({
        chargerId: context.chargerId,
        stoppedAt,
        meterStop: params.meterStop
      });
      if (!recovery.session) {
        this.repository.recordLog({
          level: 'warn',
          category: 'session',
          message: 'unmatched stop transaction recovery candidate',
          chargerId: context.chargerId,
          transactionId: params.transactionId,
          metadata: {
            reason: params.reason ?? null,
            meterStop: params.meterStop ?? null,
            idTag: params.idTag ?? null,
            timestamp: stoppedAt.toISOString(),
            recoveryReason: 'no_unique_session_match',
            candidateCount: recovery.candidateCount
          }
        });
        return {
          idTagInfo: {
            status: 'Accepted'
          }
        };
      }

      const recoveredTransactionId = recovery.session.transactionId;
      const recoveredParams: StopTransactionRequest = {
        ...params,
        transactionId: recoveredTransactionId
      };

      this.repository.stopSession({
        chargerId: context.chargerId,
        transactionId: recoveredTransactionId,
        stoppedAt,
        meterStop: params.meterStop,
        reason: params.reason
      });

      await this.proxyAuthorization.stopTransaction(context.chargerId, recoveredParams);

      return {
        idTagInfo: {
          status: 'Accepted'
        }
      };
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
        const normalized = normalizeSampledValue(sampledValue);

        this.repository.recordMeterSample({
          chargerId: context.chargerId,
          connectorId: params.connectorId ?? 0,
          transactionId: params.transactionId,
          sampledAt: parseOcppDate(meterValue.timestamp),
          value: sampledValue.value,
          numericValue: normalized.numericValue,
          normalizedValue: normalized.normalizedValue,
          normalizedUnit: normalized.normalizedUnit,
          measurand: sampledValue.measurand,
          unit: sampledValue.unit,
          context: sampledValue.context,
          phase: sampledValue.phase,
          location: sampledValue.location,
          format: sampledValue.format
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

function parseOcppDateOrNull(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSampledValue(sampledValue: SampledValue) {
  const numericValue = Number.parseFloat(sampledValue.value ?? '');
  if (!Number.isFinite(numericValue)) {
    return {
      numericValue: null,
      normalizedValue: null,
      normalizedUnit: null
    };
  }

  const measurand = sampledValue.measurand?.trim() || 'Energy.Active.Import.Register';
  const unit = sampledValue.unit?.trim().toLowerCase();

  if (measurand === 'Energy.Active.Import.Register') {
    return {
      numericValue,
      normalizedValue: unit === 'kwh' ? numericValue * 1000 : numericValue,
      normalizedUnit: 'Wh'
    };
  }

  if (measurand === 'Power.Active.Import') {
    return {
      numericValue,
      normalizedValue: unit === 'kw' ? numericValue * 1000 : numericValue,
      normalizedUnit: 'W'
    };
  }

  if (measurand === 'Current.Import') {
    return {
      numericValue,
      normalizedValue: numericValue,
      normalizedUnit: sampledValue.unit?.trim() || 'A'
    };
  }

  if (measurand === 'Voltage') {
    return {
      numericValue,
      normalizedValue: numericValue,
      normalizedUnit: sampledValue.unit?.trim() || 'V'
    };
  }

  return {
    numericValue,
    normalizedValue: null,
    normalizedUnit: null
  };
}
