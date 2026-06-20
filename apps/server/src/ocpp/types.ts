export type BootNotificationRequest = {
  chargePointVendor?: string;
  chargePointModel?: string;
  chargeBoxSerialNumber?: string;
  chargePointSerialNumber?: string;
  firmwareVersion?: string;
};

export type AuthorizeRequest = {
  idTag?: string;
};

export type HeartbeatRequest = Record<string, never>;

export type StartTransactionRequest = {
  connectorId?: number;
  idTag?: string;
  meterStart?: number;
  timestamp?: string;
};

export type StopTransactionRequest = {
  transactionId?: number;
  idTag?: string;
  meterStop?: number;
  timestamp?: string;
  reason?: string;
};

export type StatusNotificationRequest = {
  connectorId?: number;
  errorCode?: string;
  status?: string;
  timestamp?: string;
};

export type SampledValue = {
  value?: string;
  measurand?: string;
  unit?: string;
  context?: string;
  phase?: string;
  location?: string;
  format?: string;
};

export type MeterValuesRequest = {
  connectorId?: number;
  transactionId?: number;
  meterValue?: Array<{
    timestamp?: string;
    sampledValue?: SampledValue[];
  }>;
};

export type OcppHandlerContext = {
  chargerId: string;
};
