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
  Tag,
  TagFormState,
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
  basicAuthPassword: "",
  clearUsername: false,
  clearBasicAuthPassword: false,
  hasUsername: false,
  hasBasicAuthPassword: false,
  tagMappings: [],
  tagMappingsDirty: false
});

export const viewPaths: Record<ActiveView, string> = {
  Home: "/",
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
  return new Date(value).toLocaleString();
}

export function formatEnergyWh(value: number | null) {
  if (value === null) return "-";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} kWh`;
  return `${Math.round(value)} Wh`;
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
  const params = new URLSearchParams();

  params.set("limit", "200");

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
  return query ? `/api/communication-journal?${query}` : "/api/communication-journal";
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
