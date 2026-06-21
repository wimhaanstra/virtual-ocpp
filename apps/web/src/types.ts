export type Tag = {
  id: string;
  uuid: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
  chargerAccess?: ChargerAccessState[] | Record<string, boolean> | null;
  allowedChargerIds?: string[] | null;
};

export type ChargerAccessState = {
  chargerId: string;
  enabled: boolean;
};

export type LiveUpdateTopic =
  | "charger"
  | "sessions"
  | "charging-stats"
  | "logs"
  | "communication"
  | "proxy-targets"
  | "proxy-health"
  | "tags";

export type LiveUpdateEvent = {
  type: string;
  topic?: LiveUpdateTopic;
  chargerId?: string | null;
};

export type LiveUpdateEnvelope = {
  id: string;
  occurredAt: string;
  event: LiveUpdateEvent;
};

export type LiveStatus = "connecting" | "live" | "stale";

export type ProxyTarget = {
  id: string;
  name: string;
  url: string;
  chargerId?: string;
  stationId: string | null;
  enabled: boolean;
  mode: "monitor-only" | "deny-capable";
  outagePolicy: "fail-open" | "fail-closed";
  hasUsername: boolean;
  hasBasicAuthPassword: boolean;
  tagMappings?: ProxyTagMapping[];
  createdAt: string;
  updatedAt: string;
};

export type ProxyTagMapping = {
  id?: string;
  localIdTag: string;
  outboundIdTag: string;
};

export type ChargerRegistryRow = {
  id: string;
  chargerId?: string | null;
  label?: string | null;
  active?: boolean;
  firstSeenAt?: string | null;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
  lastSeenAt?: string | null;
  lastBootAt?: string | null;
  chargePointVendor?: string | null;
  chargePointModel?: string | null;
  firmwareVersion?: string | null;
  updatedAt?: string | null;
  enabled?: boolean;
};

export type ChargingSession = {
  id: string;
  chargerId: string;
  connectorId: number;
  transactionId: number;
  idTag: string | null;
  startedAt: string;
  stoppedAt: string | null;
  startMeterWh: number | null;
  stopMeterWh: number | null;
  stopReason: string | null;
  status: string;
  active: boolean;
};

export type ChargingStats = {
  sessionId: string;
  chargerId: string;
  connectorId: number;
  transactionId: number;
  idTag: string | null;
  startedAt: string;
  elapsedSeconds: number;
  startMeterWh: number | null;
  latestMeterWh: number | null;
  energyUsedWh: number | null;
  latestPowerW: number | null;
  latestCurrentA: number | null;
  latestVoltageV: number | null;
  latestSampleAt: string | null;
  latestEnergyContext: string | null;
  latestPowerContext: string | null;
};

export type ProxyHealthResponse = {
  chargerId: string | null;
  summary: {
    total: number;
    connected: number;
    backoff: number;
    waitingForCharger: number;
    disabled: number;
  };
  targets: ProxyHealthTarget[];
};

export type ProxyHealthTarget = {
  proxyTargetId: string;
  name: string;
  chargerId: string | null;
  enabled: boolean;
  mode: string;
  outagePolicy: string;
  connected: boolean;
  state: "disabled" | "waiting_for_charger" | "connected" | "connecting" | "backoff" | "disconnected" | "unknown";
  detail: string;
  upstreamIdentity: string | null;
  hadSuccessfulConnection: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  nextReconnectAt: string | null;
  lastErrorCode: string | null;
};

export type ActiveSessionAuditResponse = {
  summary: {
    activeSessions: number;
    flaggedSessions: number;
  };
  items: ActiveSessionAuditItem[];
};

export type ActiveSessionAuditItem = {
  sessionId: string;
  chargerId: string;
  connectorId: number;
  transactionId: number;
  startedAt: string;
  chargerConnected: boolean;
  latestStatus: string | null;
  latestStatusAt: string | null;
  latestMeterSampleAt: string | null;
  latestMeterWh: number | null;
  forceCloseMeterSource: "latest-meter-sample" | "start-meter" | "unknown";
  proxyMappings: Array<{
    proxyTargetId: string;
    proxyTargetName: string;
    externalTransactionId: number;
    stoppedAt: string | null;
  }>;
  warnings: Array<{
    code: string;
    severity: "warn";
    message: string;
    createdAt: string | null;
  }>;
  recommendedAction: "remote_stop" | "force_close_preview";
};

export type ForceClosePreview = {
  session: ChargingSession;
  localStopTransaction: {
    transactionId: number;
    idTag?: string;
    meterStop?: number;
    timestamp?: string;
    reason?: string;
  };
  meterSource: "latest-meter-sample" | "start-meter" | "unknown";
  latestMeterSample: {
    sampledAt: string;
    value: string;
    meterWh: number;
    measurand: string | null;
    unit: string | null;
    transactionId: number | null;
  } | null;
  proxyPayloads: Array<{
    proxyTargetId: string;
    proxyTargetName: string;
    proxyTargetEnabled: boolean;
    externalTransactionId: number;
    payload: Record<string, unknown>;
  }>;
  warnings: string[];
  proxyResults?: Array<{
    proxyTargetId: string;
    proxyTargetName: string;
    externalTransactionId: number;
    attempted: boolean;
    ok: boolean;
  }>;
};

export type LogEntry = {
  id: string;
  level: string;
  category: string;
  message: string;
  chargerId: string | null;
  transactionId: number | null;
  createdAt: string;
  hasMetadata: boolean;
  context: Record<string, string> | null;
};

export type CommunicationJournalItem = {
  id: string;
  createdAt: string;
  direction: "inbound" | "outbound";
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  chargerId: string | null;
  proxyTargetId: string | null;
  messageType: string;
  ocppMethod: string | null;
  transactionId: number | null;
  idTag: string | null;
  payload: unknown;
  errorCode: string | null;
  errorDescription: string | null;
  correlationId: string | null;
};

export type CommunicationJournalResponse = {
  items: CommunicationJournalItem[];
  retentionHours: number;
};

export type DashboardConfig = {
  ocppWebSocketUrl: string;
  ocppProtocol: string;
  ocppBasicAuthRequired: boolean;
  ocppBasicAuthUsername: string | null;
};

export type ActiveView = "Home" | "Chargers" | "Proxy targets" | "Tags" | "Tag access" | "Sessions" | "Communication";
export type ThemeMode = "dark" | "light";

export type CommunicationJournalFilters = {
  from: string;
  to: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  chargerId: string;
  proxyTargetId: string;
  ocppMethod: string;
  messageType: string;
};

export type TagFormState = {
  id: string | null;
  uuid: string;
  label: string;
  enabled: boolean;
};

export type ProxyTargetFormState = {
  id: string | null;
  name: string;
  url: string;
  username: string;
  stationId: string;
  enabled: boolean;
  mode: ProxyTarget["mode"];
  outagePolicy: ProxyTarget["outagePolicy"];
  basicAuthPassword: string;
  clearUsername: boolean;
  clearBasicAuthPassword: boolean;
  hasUsername: boolean;
  hasBasicAuthPassword: boolean;
  tagMappings: ProxyTagMapping[];
  tagMappingsDirty: boolean;
};
