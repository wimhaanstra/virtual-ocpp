import type {
  ActiveSessionAuditResponse,
  ActiveView,
  ChargerRegistryRow,
  ChargingSession,
  CommunicationJournalFilters,
  CommunicationJournalItem,
  ProxyHealthTarget,
  ProxyTarget,
  ProxyTargetFormState,
  OnboardingSettings,
  OnboardingState,
  Tag,
  TagFormState,
  TimeFormatPreference,
  ThemeMode
} from "./types";

export const emptyCommunicationJournalFilters = (): CommunicationJournalFilters => ({
  from: "",
  to: "",
  sourceType: "",
  sourceId: "",
  targetType: "",
  targetId: "",
  chargerId: "",
  proxyTargetId: "",
  ocppMethod: "",
  transactionId: "",
  messageType: ""
});

export const emptyTagForm = (): TagFormState => ({
  id: null,
  uuid: "",
  label: "",
  enabled: true
});

export const emptyProxyTargetForm = (): ProxyTargetFormState => ({
  id: null,
  name: "",
  url: "",
  username: "",
  stationId: "",
  enabled: true,
  mode: "monitor-only",
  outagePolicy: "fail-open",
  allowRecoverySubmissions: false,
  basicAuthPassword: "",
  hasUsername: false,
  hasBasicAuthPassword: false,
  usernameDirty: false,
  basicAuthPasswordDirty: false,
  tagMappings: [],
  tagMappingsDirty: false
});

export const viewPaths: Record<ActiveView, string> = {
  Home: "/",
  Settings: "/settings",
  "Charger dashboard": "/charger-dashboard",
  Chargers: "/chargers",
  "Proxy targets": "/proxy-targets",
  Tags: "/tags",
  "Tag access": "/tag-access",
  Sessions: "/sessions",
  Communication: "/communication"
};

const pathViews = new Map<string, ActiveView>(Object.entries(viewPaths).map(([view, path]) => [path, view as ActiveView]));

export function getSearchParam(name: string) {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

export function getViewFromPath(pathname = window.location.pathname): ActiveView {
  return pathViews.get(pathname.replace(/\/+$/, "") || "/") ?? "Home";
}

export function buildViewUrl(view: ActiveView, chargerId: string) {
  const params = new URLSearchParams();
  if (chargerId) {
    params.set("chargerId", chargerId);
  }

  const query = params.toString();
  return `${viewPaths[view]}${query ? `?${query}` : ""}`;
}

export function withChargerContext(url: string, chargerId: string) {
  if (!chargerId) return url;

  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("chargerId", chargerId);
  return `${path}?${params.toString()}`;
}

export function getOnboardingState(settings: OnboardingSettings | null): OnboardingState {
  if (!settings) return "unknown";
  if (settings.completedAt) return "completed";
  if (settings.skippedAt) return "skipped";
  if (settings.completed) return "completed";
  return "pending";
}

export function getOnboardingStateLabel(state: OnboardingState) {
  if (state === "completed") return "Completed";
  if (state === "skipped") return "Skipped";
  if (state === "pending") return "Pending";
  return "Unavailable";
}

export function getOnboardingStateTone(state: OnboardingState) {
  if (state === "completed") return "pill-good";
  if (state === "skipped") return "pill-warning";
  return "pill-neutral";
}

export function getStoredPreference(key: string) {
  try {
    return typeof window.localStorage?.getItem === "function" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function setStoredPreference(key: string, value: string) {
  try {
    if (typeof window.localStorage?.setItem === "function") {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Preference persistence is best-effort; UI state still works without storage.
  }
}

export function getInitialTheme(): ThemeMode {
  const storedTheme = getStoredPreference("virtual-ocpp-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getInitialTimeFormat(): TimeFormatPreference {
  const storedTimeFormat = getStoredPreference("virtual-ocpp-time-format");
  return storedTimeFormat === "12h" ? "12h" : "24h";
}

export function setTimeFormatPreference(value: TimeFormatPreference) {
  setStoredPreference("virtual-ocpp-time-format", value);
}

export function getInitialSidebarCollapsed() {
  return getStoredPreference("virtual-ocpp-sidebar-collapsed") === "true";
}

export function getChargerDisplayLabel(charger: ChargerRegistryRow) {
  return charger.label?.trim() || charger.chargerId?.trim() || charger.id;
}

export function getChargerContextId(charger: ChargerRegistryRow) {
  return charger.chargerId?.trim() || charger.id;
}

function getChargerSortTime(charger: ChargerRegistryRow) {
  const candidates = [charger.lastSeenAt, charger.updatedAt, charger.connectedAt, charger.disconnectedAt].filter(Boolean);
  const value = candidates[0];
  return value ? new Date(value).getTime() : 0;
}

export function sortChargers(chargers: ChargerRegistryRow[]) {
  return [...chargers].sort((left, right) => getChargerSortTime(right) - getChargerSortTime(left));
}

export function getChargerConnectionLabel(charger: ChargerRegistryRow) {
  if (charger.connectionState === "disabled" || charger.enabled === false) return "Disabled";
  if (charger.connectionState === "connected" || charger.active) return "Connected";
  if (charger.connectionState === "recently_seen") return "Recently seen";
  if (charger.connectionState === "silent") return "No OCPP traffic";
  return "Registered";
}

export function getChargerConnectionTone(charger: ChargerRegistryRow) {
  if (charger.connectionState === "connected" || charger.active) return "pill-good";
  if (charger.connectionState === "silent") return "pill-warning";
  return "pill-neutral";
}

export function getTagAccessForCharger(tag: Tag, chargerId: string) {
  if (!chargerId) return null;

  if (Array.isArray(tag.chargerAccess)) {
    const match = tag.chargerAccess.find((access) => access.chargerId === chargerId);
    return match?.enabled ?? null;
  }

  if (tag.chargerAccess && !Array.isArray(tag.chargerAccess)) {
    const value = tag.chargerAccess[chargerId];
    return typeof value === "boolean" ? value : null;
  }

  if (Array.isArray(tag.allowedChargerIds)) {
    return tag.allowedChargerIds.includes(chargerId);
  }

  return null;
}

export function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: getInitialTimeFormat() === "12h"
  });
}

export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: getInitialTimeFormat() === "12h"
  });
}

export function formatEnergyWh(value: number | null) {
  if (value === null) return "-";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} kWh`;
  return `${Math.round(value)} Wh`;
}

export function getMeterSourceLabel(source: string | null | undefined) {
  if (source === "session-stop-meter") return "Exact stop meter";
  if (source === "latest-meter-sample") return "Latest meter sample";
  if (source === "start-meter") return "Start meter only";
  return "Unknown meter";
}

export function formatPowerW(value: number | null) {
  if (value === null) return "-";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)} kW`;
  return `${Math.round(value)} W`;
}

export function formatDecimalUnit(value: number | null, unit: string) {
  if (value === null) return "-";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${unit}`;
}

export function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatProxyHealthState(state: ProxyHealthTarget["state"]) {
  return state.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function proxyHealthTone(state: ProxyHealthTarget["state"]) {
  if (state === "connected") return "pill-good";
  if (state === "backoff" || state === "disconnected") return "pill-warning";
  return "pill-neutral";
}

export function findAuditForSession(audit: ActiveSessionAuditResponse | null, session: ChargingSession) {
  return audit?.items.find((item) => item.sessionId === session.id || item.transactionId === session.transactionId) ?? null;
}

export function formatTagMappingCount(count: number) {
  if (count === 0) return "None";
  return `${count} mapping${count === 1 ? "" : "s"}`;
}

export function stringifyPayload(payload: unknown) {
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized !== undefined) return serialized;
  return String(payload);
}

export function buildCommunicationSummary(item: CommunicationJournalItem) {
  const parts = [item.messageType];

  if (item.ocppMethod) {
    parts.push(item.ocppMethod);
  }

  if (item.transactionId !== null) {
    parts.push(`tx ${item.transactionId}`);
  }

  if (item.errorCode) {
    parts.push(item.errorDescription ? `${item.errorCode}: ${item.errorDescription}` : item.errorCode);
  }

  if (item.idTag) {
    parts.push(`tag ${item.idTag}`);
  }

  return parts.join(" • ");
}

export function buildCommunicationJournalQuery(filters: CommunicationJournalFilters, chargerId: string) {
  return buildCommunicationJournalUrl("/api/communication-journal", filters, chargerId, "200");
}

export function buildCommunicationJournalExportQuery(filters: CommunicationJournalFilters, chargerId: string) {
  return buildCommunicationJournalUrl("/api/communication-journal/export", filters, chargerId, "5000");
}

function buildCommunicationJournalUrl(path: string, filters: CommunicationJournalFilters, chargerId: string, limit: string) {
  const params = new URLSearchParams();

  params.set("limit", limit);

  if (chargerId) {
    params.set("chargerId", chargerId);
  }

  for (const [key, value] of Object.entries(filters)) {
    const trimmed = value.trim();
    if (trimmed) {
      params.set(key, trimmed);
    }
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function getProxyTargetUpstreamIdentity(target: ProxyTarget, chargerId: string) {
  return target.stationId?.trim() || chargerId || target.chargerId || "";
}

export function buildProxyTargetConnectionUrl(url: string, stationId: string) {
  const trimmedUrl = url.trim().replace(/\/+$/, "");
  const trimmedStationId = stationId.trim().replace(/^\/+/, "");
  if (!trimmedUrl) return "";
  return trimmedStationId ? `${trimmedUrl}/${encodeURIComponent(trimmedStationId)}` : trimmedUrl;
}

export function proxyUrlIncludesStationId(url: string, stationId: string) {
  const trimmedUrl = url.trim().replace(/\/+$/, "");
  const trimmedStationId = stationId.trim().replace(/^\/+|\/+$/g, "");
  return Boolean(trimmedUrl && trimmedStationId && trimmedUrl.endsWith(`/${trimmedStationId}`));
}
