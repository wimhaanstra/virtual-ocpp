import { Fragment, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PlugZap,
  Plus,
  Power,
  PowerOff,
  RefreshCcw,
  SlidersHorizontal,
  SunMoon,
  Tags as TagsIcon,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import { Button } from "./components/ui/button";

type Tag = {
  id: string;
  uuid: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
  chargerAccess?: ChargerAccessState[] | Record<string, boolean> | null;
  allowedChargerIds?: string[] | null;
};

type ChargerAccessState = {
  chargerId: string;
  enabled: boolean;
};

type ProxyTarget = {
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

type ProxyTagMapping = {
  id?: string;
  localIdTag: string;
  outboundIdTag: string;
};

type ChargerRegistryRow = {
  id: string;
  chargerId?: string | null;
  label?: string | null;
  active?: boolean;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
  lastSeenAt?: string | null;
  updatedAt?: string | null;
};

type ChargingSession = {
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

type ChargingStats = {
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

type LogEntry = {
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

type CommunicationJournalItem = {
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

type CommunicationJournalResponse = {
  items: CommunicationJournalItem[];
  retentionHours: number;
};

type DashboardConfig = {
  ocppWebSocketUrl: string;
  ocppProtocol: string;
  ocppBasicAuthRequired: boolean;
  ocppBasicAuthUsername: string | null;
};

type ActiveView = "Home" | "Proxy targets" | "Tags" | "Sessions" | "Communication";
type ThemeMode = "dark" | "light";

type CommunicationJournalFilters = {
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

type TagFormState = {
  id: string | null;
  uuid: string;
  label: string;
  enabled: boolean;
};

type ProxyTargetFormState = {
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

const emptyCommunicationJournalFilters = (): CommunicationJournalFilters => ({
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

const emptyTagForm = (): TagFormState => ({
  id: null,
  uuid: "",
  label: "",
  enabled: true
});

const emptyProxyTargetForm = (): ProxyTargetFormState => ({
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

const navItems: Array<{ view: ActiveView; label: string; icon: LucideIcon }> = [
  { view: "Home", label: "Dashboard", icon: LayoutDashboard },
  { view: "Communication", label: "Communication", icon: MessagesSquare },
  { view: "Sessions", label: "Sessions", icon: ListChecks },
  { view: "Proxy targets", label: "Proxy targets", icon: PlugZap },
  { view: "Tags", label: "Tags", icon: TagsIcon }
];

const viewPaths: Record<ActiveView, string> = {
  Home: "/",
  "Proxy targets": "/proxy-targets",
  Tags: "/tags",
  Sessions: "/sessions",
  Communication: "/communication"
};

const pathViews = new Map<string, ActiveView>(Object.entries(viewPaths).map(([view, path]) => [path, view as ActiveView]));

function getSearchParam(name: string) {
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

function getViewFromPath(pathname = window.location.pathname): ActiveView {
  return pathViews.get(pathname.replace(/\/+$/, "") || "/") ?? "Home";
}

function buildViewUrl(view: ActiveView, chargerId: string) {
  const params = new URLSearchParams();
  if (chargerId) {
    params.set("chargerId", chargerId);
  }

  const query = params.toString();
  return `${viewPaths[view]}${query ? `?${query}` : ""}`;
}

function withChargerContext(url: string, chargerId: string) {
  if (!chargerId) return url;

  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("chargerId", chargerId);
  return `${path}?${params.toString()}`;
}

function getStoredPreference(key: string) {
  try {
    return typeof window.localStorage?.getItem === "function" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function setStoredPreference(key: string, value: string) {
  try {
    if (typeof window.localStorage?.setItem === "function") {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Preference persistence is best-effort; UI state still works without storage.
  }
}

function getInitialTheme(): ThemeMode {
  const storedTheme = getStoredPreference("virtual-ocpp-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getInitialSidebarCollapsed() {
  return getStoredPreference("virtual-ocpp-sidebar-collapsed") === "true";
}

function getChargerDisplayLabel(charger: ChargerRegistryRow) {
  return charger.label?.trim() || charger.chargerId?.trim() || charger.id;
}

function getChargerContextId(charger: ChargerRegistryRow) {
  return charger.chargerId?.trim() || charger.id;
}

function getChargerStatusLabel(charger: ChargerRegistryRow) {
  if (charger.active) return "Connected";
  if (charger.active === false) return "Disconnected";
  return "Registered";
}

function getChargerSortTime(charger: ChargerRegistryRow) {
  const candidates = [charger.lastSeenAt, charger.updatedAt, charger.connectedAt, charger.disconnectedAt].filter(Boolean);
  const value = candidates[0];
  return value ? new Date(value).getTime() : 0;
}

function sortChargers(chargers: ChargerRegistryRow[]) {
  return [...chargers].sort((left, right) => getChargerSortTime(right) - getChargerSortTime(left));
}

function getTagAccessForCharger(tag: Tag, chargerId: string) {
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

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatEnergyWh(value: number | null) {
  if (value === null) return "-";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} kWh`;
  return `${Math.round(value)} Wh`;
}

function formatPowerW(value: number | null) {
  if (value === null) return "-";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)} kW`;
  return `${Math.round(value)} W`;
}

function formatDecimalUnit(value: number | null, unit: string) {
  if (value === null) return "-";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${unit}`;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTagMappingCount(count: number) {
  if (count === 0) return "None";
  return `${count} mapping${count === 1 ? "" : "s"}`;
}

function stringifyPayload(payload: unknown) {
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized !== undefined) return serialized;
  return String(payload);
}

function buildCommunicationSummary(item: CommunicationJournalItem) {
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

function buildCommunicationJournalQuery(filters: CommunicationJournalFilters, chargerId: string) {
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

function getProxyTargetUpstreamIdentity(target: ProxyTarget, chargerId: string) {
  return target.stationId?.trim() || chargerId || target.chargerId || "";
}

function buildProxyTargetConnectionUrl(url: string, stationId: string) {
  const trimmedUrl = url.trim().replace(/\/+$/, "");
  const trimmedStationId = stationId.trim().replace(/^\/+/, "");
  if (!trimmedUrl) return "";
  return trimmedStationId ? `${trimmedUrl}/${encodeURIComponent(trimmedStationId)}` : trimmedUrl;
}

function proxyUrlIncludesStationId(url: string, stationId: string) {
  const trimmedUrl = url.trim().replace(/\/+$/, "");
  const trimmedStationId = stationId.trim().replace(/^\/+|\/+$/g, "");
  return Boolean(trimmedUrl && trimmedStationId && trimmedUrl.endsWith(`/${trimmedStationId}`));
}

function getProxyHealth(target: ProxyTarget, logs: LogEntry[]) {
  if (!target.enabled) {
    return {
      label: "Disabled",
      tone: "warning" as const,
      detail: "Target is disabled.",
      at: null as string | null
    };
  }

  const latest = logs.find((entry) => entry.category === "proxy" && entry.context?.proxyTargetId === target.id);
  if (!latest) {
    return {
      label: "Unknown",
      tone: "neutral" as const,
      detail: "No proxy activity logged yet.",
      at: null as string | null
    };
  }

  const connectedMessages = new Set([
    "proxy target connection established",
    "proxy target connection reconnected",
    "proxy target call accepted"
  ]);
  const failingMessages = new Set([
    "proxy target connection failed",
    "proxy target connection reconnect failed",
    "proxy target connection disconnected",
    "proxy target unavailable, failing open",
    "proxy target unavailable, failing closed",
    "proxy target connection reset after call failure"
  ]);

  if (connectedMessages.has(latest.message)) {
    return {
      label: "Connected",
      tone: "good" as const,
      detail: latest.message,
      at: latest.createdAt
    };
  }

  if (failingMessages.has(latest.message) || latest.level === "error" || latest.level === "warn") {
    return {
      label: "Failing",
      tone: "warning" as const,
      detail: latest.message,
      at: latest.createdAt
    };
  }

  return {
    label: "Active",
    tone: "neutral" as const,
    detail: latest.message,
    at: latest.createdAt
  };
}

export default function App() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>(() => getViewFromPath());
  const [tags, setTags] = useState<Tag[]>([]);
  const [proxyTargets, setProxyTargets] = useState<ProxyTarget[]>([]);
  const [chargers, setChargers] = useState<ChargerRegistryRow[]>([]);
  const [chargingSessions, setChargingSessions] = useState<ChargingSession[]>([]);
  const [chargingStats, setChargingStats] = useState<ChargingStats[]>([]);
  const [chargingStatsStatus, setChargingStatsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [communicationJournal, setCommunicationJournal] = useState<CommunicationJournalItem[]>([]);
  const [communicationRetentionHours, setCommunicationRetentionHours] = useState<number | null>(null);
  const [communicationFilters, setCommunicationFilters] = useState<CommunicationJournalFilters>(() => emptyCommunicationJournalFilters());
  const [expandedCommunicationJournalId, setExpandedCommunicationJournalId] = useState<string | null>(null);
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig | null>(null);
  const [tagForm, setTagForm] = useState<TagFormState>(() => emptyTagForm());
  const [proxyTargetForm, setProxyTargetForm] = useState<ProxyTargetFormState>(() => emptyProxyTargetForm());
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [proxyTargetModalOpen, setProxyTargetModalOpen] = useState(false);
  const [selectedChargerId, setSelectedChargerId] = useState(() => getSearchParam("chargerId"));
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getInitialSidebarCollapsed());
  const [message, setMessage] = useState("Sign in to manage proxy targets.");
  const [busy, setBusy] = useState(false);

  const enabledTagCount = useMemo(() => tags.filter((tag) => tag.enabled).length, [tags]);
  const enabledProxyCount = useMemo(() => proxyTargets.filter((target) => target.enabled).length, [proxyTargets]);
  const activeSessionCount = useMemo(() => chargingSessions.filter((session) => session.active).length, [chargingSessions]);
  const connectedChargerCount = useMemo(() => chargers.filter((charger) => charger.active).length, [chargers]);
  const sortedChargers = useMemo(() => sortChargers(chargers), [chargers]);
  const recentChargers = useMemo(() => sortedChargers.slice(0, 5), [sortedChargers]);
  const latestCharger = recentChargers[0] ?? null;
  const selectedCharger = useMemo(
    () => chargers.find((charger) => charger.id === selectedChargerId || charger.chargerId === selectedChargerId) ?? null,
    [chargers, selectedChargerId]
  );
  const selectedChargerLabel = selectedCharger ? getChargerDisplayLabel(selectedCharger) : "All chargers";
  const proxyTargetHealth = useMemo(
    () =>
      proxyTargets.map((target) => ({
        target,
        health: getProxyHealth(target, logs),
        connectionUrl: buildProxyTargetConnectionUrl(target.url, getProxyTargetUpstreamIdentity(target, selectedChargerId))
      })),
    [logs, proxyTargets, selectedChargerId]
  );
  const proxyHealthCounts = useMemo(
    () => ({
      connected: proxyTargetHealth.filter((entry) => entry.health.label === "Connected").length,
      failing: proxyTargetHealth.filter((entry) => entry.health.label === "Failing").length,
      enabled: proxyTargetHealth.filter((entry) => entry.target.enabled).length
    }),
    [proxyTargetHealth]
  );
  const proxyTargetFormIdentity = proxyTargetForm.stationId.trim() || selectedChargerId;
  const proxyTargetFormConnectionUrl = buildProxyTargetConnectionUrl(proxyTargetForm.url, proxyTargetFormIdentity);
  const proxyTargetFormHasDuplicatedStationPath = proxyUrlIncludesStationId(proxyTargetForm.url, proxyTargetFormIdentity);

  const isEditingTag = tagForm.id !== null;
  const isEditingProxyTarget = proxyTargetForm.id !== null;

  function formatProxyTargetLabel(proxyTargetId: string | null) {
    if (!proxyTargetId) return "-";
    return proxyTargets.find((target) => target.id === proxyTargetId)?.name ?? proxyTargetId;
  }

  function renderCommunicationEndpoint(type: string, id: string) {
    if (type !== "proxy") {
      return `${type} / ${id}`;
    }

    const proxyName = formatProxyTargetLabel(id);
    return (
      <span title={id}>
        {type} / {proxyName}
      </span>
    );
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    setStoredPreference("virtual-ocpp-theme", theme);
  }, [theme]);

  useEffect(() => {
    setStoredPreference("virtual-ocpp-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    function handlePopState() {
      setActiveView(getViewFromPath());
      setSelectedChargerId(getSearchParam("chargerId"));
      setTagModalOpen(false);
      setProxyTargetModalOpen(false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    const nextUrl = buildViewUrl(activeView, selectedChargerId);
    window.history.replaceState({}, "", nextUrl);
  }, [activeView, selectedChargerId, authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    setCommunicationFilters((current) => (current.chargerId === selectedChargerId ? current : { ...current, chargerId: selectedChargerId }));
    void loadScopedData(selectedChargerId);
  }, [authenticated, selectedChargerId]);

  useEffect(() => {
    if (!authenticated || activeView !== "Home") return;
    void loadChargingStats(selectedChargerId);
  }, [authenticated, activeView, selectedChargerId]);

  async function loadSession() {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    if (!response.ok) return;
    setAuthenticated(true);
    setActiveView(getViewFromPath());
    setMessage("");
    await loadAdminData(selectedChargerId);
  }

  function navigateToView(view: ActiveView) {
    if (view === activeView) return;
    setActiveView(view);
    setTagModalOpen(false);
    setProxyTargetModalOpen(false);
    window.history.pushState({}, "", buildViewUrl(view, selectedChargerId));
  }

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  function resetAdminState() {
    setAuthenticated(false);
    setPassword("");
    setTags([]);
    setProxyTargets([]);
    setChargers([]);
    setChargingSessions([]);
    setChargingStats([]);
    setChargingStatsStatus("idle");
    setLogs([]);
    setDashboardConfig(null);
    setTagForm(emptyTagForm());
    setProxyTargetForm(emptyProxyTargetForm());
    setTagModalOpen(false);
    setProxyTargetModalOpen(false);
    setCommunicationJournal([]);
    setCommunicationRetentionHours(null);
    setCommunicationFilters(emptyCommunicationJournalFilters());
    setExpandedCommunicationJournalId(null);
    setSelectedChargerId("");
    setActiveView("Home");
    setMessage("Session expired. Sign in again.");
  }

  function handleUnauthorized(response: Response) {
    if (response.status !== 401) return false;
    resetAdminState();
    return true;
  }

  async function fetchAdminJson<T>(url: string) {
    const response = await fetch(url, { credentials: "include" });
    if (handleUnauthorized(response)) return null;
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  }

  async function loadAdminData(chargerId = selectedChargerId) {
    await Promise.all([loadDashboardConfig(), loadChargers()]);
  }

  async function loadScopedData(chargerId = selectedChargerId) {
    await Promise.all([
      loadProxyTargets(chargerId),
      loadTags(chargerId),
      loadChargingSessions(chargerId),
      loadLogs(chargerId),
      loadCommunicationJournal(chargerId)
    ]);
  }

  async function loadDashboardConfig() {
    const data = await fetchAdminJson<DashboardConfig>("/api/dashboard-config");
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load dashboard config.");
      return;
    }
    setDashboardConfig(data);
  }

  async function loadTags(chargerId = selectedChargerId) {
    const data = await fetchAdminJson<Tag[]>(withChargerContext("/api/tags", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load tags.");
      return;
    }
    setTags(data);
  }

  async function loadProxyTargets(chargerId = selectedChargerId) {
    if (!chargerId) {
      setProxyTargets([]);
      return;
    }

    const data = await fetchAdminJson<ProxyTarget[]>(withChargerContext("/api/proxy-targets", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load proxy targets.");
      return;
    }
    setProxyTargets(data);
  }

  async function loadChargers() {
    const data = await fetchAdminJson<ChargerRegistryRow[]>("/api/chargers");
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load charger registry.");
      return;
    }
    setChargers(data);
  }

  async function loadChargingSessions(chargerId = selectedChargerId) {
    const data = await fetchAdminJson<ChargingSession[]>(withChargerContext("/api/sessions", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load charging sessions.");
      return;
    }
    setChargingSessions(data);
  }

  async function loadChargingStats(chargerId = selectedChargerId) {
    let data: ChargingStats[] | null | undefined;
    setChargingStatsStatus("loading");
    try {
      data = await fetchAdminJson<ChargingStats[]>(withChargerContext("/api/charging-stats", chargerId));
    } catch {
      setChargingStatsStatus("error");
      return;
    }
    if (data === null) return;
    if (data === undefined) {
      setChargingStatsStatus("error");
      return;
    }
    setChargingStats(data);
    setChargingStatsStatus("ready");
  }

  async function closeChargingSession(session: ChargingSession) {
    setBusy(true);
    setMessage(`Closing session ${session.transactionId}...`);
    try {
      const response = await fetch(`/api/sessions/${session.id}/close`, {
        method: "POST",
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not close charging session.");
        return;
      }

      setMessage(`Closed session ${session.transactionId}.`);
      await Promise.all([loadChargingSessions(selectedChargerId), loadChargingStats(selectedChargerId), loadLogs(selectedChargerId)]);
    } finally {
      setBusy(false);
    }
  }

  async function remoteStopChargingSession(session: ChargingSession) {
    setBusy(true);
    setMessage(`Requesting remote stop for session ${session.transactionId}...`);
    try {
      const response = await fetch(`/api/sessions/${session.id}/remote-stop`, {
        method: "POST",
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        const message = response.status === 409 ? "Charger is not connected or the session is no longer active." : "Could not request remote stop.";
        setMessage(message);
        return;
      }

      const result = (await response.json().catch(() => null)) as { status?: string } | null;
      setMessage(result?.status === "Accepted" ? `Remote stop accepted for session ${session.transactionId}.` : `Remote stop returned ${result?.status ?? "Unknown"}.`);
      await Promise.all([loadChargingSessions(selectedChargerId), loadChargingStats(selectedChargerId), loadLogs(selectedChargerId)]);
    } finally {
      setBusy(false);
    }
  }

  async function loadLogs(chargerId = selectedChargerId) {
    const data = await fetchAdminJson<LogEntry[]>(withChargerContext("/api/logs", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load activity.");
      return;
    }
    setLogs(data);
  }

  async function loadCommunicationJournal(chargerId = selectedChargerId, filters = communicationFilters) {
    const data = await fetchAdminJson<CommunicationJournalResponse>(buildCommunicationJournalQuery(filters, chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load communication journal.");
      return;
    }
    setCommunicationJournal(data.items);
    setCommunicationRetentionHours(data.retentionHours);
    setExpandedCommunicationJournalId(null);
  }

  async function purgeCommunicationJournal() {
    setBusy(true);
    setMessage("Purging communication journal...");
    try {
      const response = await fetch("/api/communication-journal/purge", {
        method: "POST",
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not purge communication journal.");
        return;
      }

      const result = (await response.json().catch(() => null)) as { deletedCount?: number; retentionHours?: number } | null;
      if (typeof result?.retentionHours === "number") {
        setCommunicationRetentionHours(result.retentionHours);
      }

      setMessage(
        typeof result?.deletedCount === "number"
          ? `Purged ${result.deletedCount} communication row${result.deletedCount === 1 ? "" : "s"}.`
          : "Communication journal purged."
      );
      await loadCommunicationJournal(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  async function applyCommunicationFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await loadCommunicationJournal(selectedChargerId, communicationFilters);
    } finally {
      setBusy(false);
    }
  }

  async function resetCommunicationFilters() {
    const nextFilters = emptyCommunicationJournalFilters();
    setCommunicationFilters(nextFilters);
    setBusy(true);
    try {
      await loadCommunicationJournal(selectedChargerId, nextFilters);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
    } finally {
      resetAdminState();
      setMessage("Signed out.");
      setBusy(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Signing in...");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        setMessage("Invalid admin credentials.");
        return;
      }

      setAuthenticated(true);
      setActiveView("Home");
      setPassword("");
      setMessage("Signed in.");
      await loadAdminData();
    } finally {
      setBusy(false);
    }
  }

  function startTagCreate() {
    setTagForm(emptyTagForm());
    navigateToView("Tags");
    setTagModalOpen(true);
  }

  function startTagEdit(tag: Tag) {
    navigateToView("Tags");
    setTagModalOpen(true);
    setTagForm({
      id: tag.id,
      uuid: tag.uuid,
      label: tag.label ?? "",
      enabled: tag.enabled
    });
    setMessage(`Editing tag ${tag.uuid}.`);
  }

  function cancelTagEdit() {
    setTagForm(emptyTagForm());
    setTagModalOpen(false);
  }

  async function toggleTagAccess(tag: Tag) {
    if (!selectedChargerId) {
      setMessage("Select a charger context to manage tag access.");
      return;
    }

    const allowed = getTagAccessForCharger(tag, selectedChargerId) ?? false;
    const url = `/api/tags/${tag.id}/chargers/${encodeURIComponent(selectedChargerId)}`;

    setBusy(true);
    try {
      const response = await fetch(url, {
        method: allowed ? "DELETE" : "PUT",
        credentials: "include",
        headers: allowed ? undefined : { "Content-Type": "application/json" },
        body: allowed ? undefined : JSON.stringify({ enabled: true })
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not update tag access.");
        return;
      }

      setMessage(!allowed ? "Tag access granted for the selected charger." : "Tag access revoked for the selected charger.");
      await loadTags(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  async function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tagForm.uuid.trim()) return;

    setBusy(true);
    setMessage(isEditingTag ? "Updating tag..." : "Saving tag...");
    try {
      const body: Record<string, unknown> = {
        uuid: tagForm.uuid.trim(),
        enabled: tagForm.enabled
      };

      if (isEditingTag) {
        body.label = tagForm.label.trim() ? tagForm.label.trim() : null;
      } else if (tagForm.label.trim()) {
        body.label = tagForm.label.trim();
      }

      const response = await fetch(isEditingTag ? `/api/tags/${tagForm.id}` : "/api/tags", {
        method: isEditingTag ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (response.status === 409) {
        setMessage("That tag UUID already exists.");
        return;
      }

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not save tag.");
        return;
      }

      setTagForm(emptyTagForm());
      setTagModalOpen(false);
      setMessage(isEditingTag ? "Tag updated." : "Tag saved.");
      await loadTags(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  async function toggleTag(tag: Tag) {
    setBusy(true);
    try {
      const response = await fetch(`/api/tags/${tag.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !tag.enabled })
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not update tag.");
        return;
      }

      setMessage(!tag.enabled ? "Tag enabled." : "Tag disabled.");
      await loadTags(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTag(tag: Tag) {
    setBusy(true);
    try {
      const response = await fetch(`/api/tags/${tag.id}`, {
        method: "DELETE",
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not delete tag.");
        return;
      }

      if (tagForm.id === tag.id) {
        cancelTagEdit();
      }

      setMessage("Tag deleted.");
      await loadTags(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  function startProxyTargetCreate() {
    setProxyTargetForm(emptyProxyTargetForm());
    navigateToView("Proxy targets");
    setProxyTargetModalOpen(true);
  }

  function startProxyTargetEdit(target: ProxyTarget) {
    navigateToView("Proxy targets");
    setProxyTargetModalOpen(true);
    setProxyTargetForm({
      id: target.id,
      name: target.name,
      url: target.url,
      username: "",
      stationId: target.stationId ?? "",
      enabled: target.enabled,
      mode: target.mode,
      outagePolicy: target.outagePolicy,
      basicAuthPassword: "",
      clearUsername: false,
      clearBasicAuthPassword: false,
      hasUsername: target.hasUsername,
      hasBasicAuthPassword: target.hasBasicAuthPassword,
      tagMappings: target.tagMappings?.map((mapping) => ({ ...mapping })) ?? [],
      tagMappingsDirty: false
    });
    setMessage(`Editing proxy target ${target.name}.`);
  }

  function addProxyTagMapping() {
    setProxyTargetForm((current) => ({
      ...current,
      tagMappings: [...current.tagMappings, { localIdTag: "", outboundIdTag: "" }],
      tagMappingsDirty: true
    }));
  }

  function updateProxyTagMapping(index: number, patch: Partial<ProxyTagMapping>) {
    setProxyTargetForm((current) => ({
      ...current,
      tagMappings: current.tagMappings.map((mapping, mappingIndex) => (mappingIndex === index ? { ...mapping, ...patch } : mapping)),
      tagMappingsDirty: true
    }));
  }

  function removeProxyTagMapping(index: number) {
    setProxyTargetForm((current) => ({
      ...current,
      tagMappings: current.tagMappings.filter((_, mappingIndex) => mappingIndex !== index),
      tagMappingsDirty: true
    }));
  }

  function cancelProxyTargetEdit() {
    setProxyTargetForm(emptyProxyTargetForm());
    setProxyTargetModalOpen(false);
  }

  async function submitProxyTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proxyTargetForm.name.trim() || !proxyTargetForm.url.trim()) return;
    if (!isEditingProxyTarget && !selectedChargerId) {
      setMessage("Select a charger context before adding a proxy target.");
      return;
    }

    setBusy(true);
    setMessage(isEditingProxyTarget ? "Updating proxy target..." : "Saving proxy target...");
    try {
      const body: Record<string, unknown> = {
        name: proxyTargetForm.name.trim(),
        url: proxyTargetForm.url.trim(),
        enabled: proxyTargetForm.enabled,
        mode: proxyTargetForm.mode,
        outagePolicy: proxyTargetForm.outagePolicy
      };

      if (!isEditingProxyTarget && selectedChargerId) {
        body.chargerId = selectedChargerId;
      }

      const tagMappings = proxyTargetForm.tagMappings
        .map((mapping) => ({
          localIdTag: mapping.localIdTag.trim(),
          outboundIdTag: mapping.outboundIdTag.trim()
        }))
        .filter((mapping) => mapping.localIdTag && mapping.outboundIdTag);
      if (!isEditingProxyTarget || proxyTargetForm.tagMappingsDirty) {
        body.tagMappings = tagMappings;
      }

      if (isEditingProxyTarget) {
        if (proxyTargetForm.username.trim()) {
          body.username = proxyTargetForm.username.trim();
        } else if (proxyTargetForm.clearUsername) {
          body.username = null;
        }

        body.stationId = proxyTargetForm.stationId.trim() ? proxyTargetForm.stationId.trim() : null;

        if (proxyTargetForm.basicAuthPassword.trim()) {
          body.basicAuthPassword = proxyTargetForm.basicAuthPassword.trim();
        } else if (proxyTargetForm.clearBasicAuthPassword) {
          body.basicAuthPassword = null;
        }
      } else {
        if (proxyTargetForm.username.trim()) {
          body.username = proxyTargetForm.username.trim();
        }

        if (proxyTargetForm.stationId.trim()) {
          body.stationId = proxyTargetForm.stationId.trim();
        }

        if (proxyTargetForm.basicAuthPassword.trim()) {
          body.basicAuthPassword = proxyTargetForm.basicAuthPassword.trim();
        }
      }

      const response = await fetch(isEditingProxyTarget ? `/api/proxy-targets/${proxyTargetForm.id}` : "/api/proxy-targets", {
        method: isEditingProxyTarget ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not save proxy target.");
        return;
      }

      setProxyTargetForm(emptyProxyTargetForm());
      setProxyTargetModalOpen(false);
      setMessage(isEditingProxyTarget ? "Proxy target updated." : "Proxy target saved.");
      await loadProxyTargets(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  async function toggleProxyTarget(target: ProxyTarget) {
    setBusy(true);
    try {
      const response = await fetch(`/api/proxy-targets/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !target.enabled })
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not update proxy target.");
        return;
      }

      setMessage(!target.enabled ? "Proxy target enabled." : "Proxy target disabled.");
      await loadProxyTargets(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProxyTarget(target: ProxyTarget) {
    setBusy(true);
    try {
      const response = await fetch(`/api/proxy-targets/${target.id}`, {
        method: "DELETE",
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not delete proxy target.");
        return;
      }

      if (proxyTargetForm.id === target.id) {
        cancelProxyTargetEdit();
      }

      setMessage("Proxy target deleted.");
      await loadProxyTargets(selectedChargerId);
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <main className="auth-page">
        <section className="auth-layout">
          <section className="panel hero-panel">
            <div className="brand">
              <PlugZap aria-hidden="true" />
              <span>Virtual OCPP</span>
            </div>
            <h1>Admin access</h1>
            <p className="hero-copy">Manage OCPP proxy targets for the local Smart EVSE bridge.</p>
          </section>

          <section className="panel auth-card">
            <div>
              <p className="eyebrow">Protected</p>
              <h2>Sign in</h2>
            </div>
            <p className="notice" role="status">
              {message}
            </p>
            <form className="form-grid" onSubmit={login}>
              <label className="field">
                <span>Username</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <Button type="submit" disabled={busy || !username || !password}>
                <KeyRound aria-hidden="true" />
                Sign in
              </Button>
            </form>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "app-shell-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <PlugZap aria-hidden="true" />
          <span className="sidebar-label">Virtual OCPP</span>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                className={item.view === activeView ? "active" : undefined}
                aria-current={item.view === activeView ? "page" : undefined}
                aria-label={sidebarCollapsed ? item.label : undefined}
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => navigateToView(item.view)}
                key={item.view}
              >
                <Icon aria-hidden="true" />
                <span className="sidebar-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          className="sidebar-collapse-button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          <span className="sidebar-label">{sidebarCollapsed ? "Expand" : "Collapse"}</span>
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Self-hosted CSMS</p>
            <h1>{activeView === "Home" ? "Home dashboard" : activeView}</h1>
          </div>
          <div className="topbar-actions topbar-controls">
            <label className="field topbar-field">
              <span>Charger context</span>
              <select value={selectedChargerId} onChange={(event) => setSelectedChargerId(event.target.value)}>
                <option value="">All chargers</option>
                {sortChargers(chargers).map((charger) => (
                  <option key={charger.id} value={getChargerContextId(charger)}>
                    {getChargerDisplayLabel(charger)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              className="button-secondary icon-button"
              onClick={toggleTheme}
              disabled={busy}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              <SunMoon aria-hidden="true" />
            </Button>
            <Button type="button" className="button-secondary" onClick={() => void logout()} disabled={busy}>
              <LogOut aria-hidden="true" />
              <span className="button-label">Sign out</span>
            </Button>
          </div>
        </header>

        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : null}

        {activeView === "Home" ? (
          <section className="home-stack">
            <section className="dashboard-grid home-dashboard-grid">
              <section className="panel home-panel">
                <div className="topbar-actions">
                  <div>
                    <p className="eyebrow">Charging ingress</p>
                    <h2>Connect a charger</h2>
                  </div>
                  <Button type="button" className="button-secondary" onClick={() => void loadAdminData()} disabled={busy}>
                    <RefreshCcw aria-hidden="true" />
                    <span className="button-label">Refresh</span>
                  </Button>
                </div>

                <div className="note-stack">
                  <div>
                    <p className="eyebrow">WebSocket URL</p>
                    <p className="mono connection-url">{dashboardConfig?.ocppWebSocketUrl ?? "Loading connection URL..."}</p>
                    <p className="status-copy">Use wss:// when this service is served behind TLS.</p>
                  </div>
                  <div>
                    <p className="eyebrow">Protocol</p>
                    <p>
                      Use the OCPP 1.6j websocket endpoint. The websocket subprotocol is{" "}
                      <span className="mono">{dashboardConfig?.ocppProtocol ?? "ocpp1.6"}</span>.
                    </p>
                  </div>
                  <div>
                    <p className="eyebrow">Authentication</p>
                    <p>
                      {dashboardConfig?.ocppBasicAuthRequired
                        ? `Basic Auth is required. Use the ${dashboardConfig.ocppBasicAuthUsername ?? "charger id"} as the username.`
                        : "Charger Basic Auth is not required."}{" "}
                      Secrets are never shown in this dashboard.
                    </p>
                  </div>
                </div>

                <div className="home-link-row" aria-label="Dashboard quick links">
                  <Button type="button" className="button-secondary" onClick={() => navigateToView("Sessions")}>
                    Sessions
                    <ArrowRight aria-hidden="true" />
                  </Button>
                  <Button type="button" className="button-secondary" onClick={() => navigateToView("Communication")}>
                    Communication
                    <ArrowRight aria-hidden="true" />
                  </Button>
                  <Button type="button" className="button-secondary" onClick={() => navigateToView("Tags")}>
                    Tags
                    <ArrowRight aria-hidden="true" />
                  </Button>
                  <Button type="button" className="button-secondary" onClick={() => navigateToView("Proxy targets")}>
                    Proxy targets
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </section>

              <section className="panel home-panel">
                <div>
                  <p className="eyebrow">Dashboard summary</p>
                  <h2>Operational snapshot</h2>
                </div>

                <section className="status-grid home-status-grid" aria-label="System status">
                  <StatusTile icon={<PlugZap />} label="Chargers connected now" value={String(connectedChargerCount)} tone={connectedChargerCount > 0 ? "good" : "neutral"} />
                  <StatusTile icon={<Clock3 />} label="Recent registry rows" value={String(chargers.length)} tone="neutral" />
                  <StatusTile icon={<KeyRound />} label="Enabled tags" value={String(enabledTagCount)} tone={enabledTagCount > 0 ? "good" : "neutral"} />
                  <StatusTile icon={<ListChecks />} label="Active sessions" value={String(activeSessionCount)} tone={activeSessionCount > 0 ? "good" : "neutral"} />
                  <StatusTile icon={<ListChecks />} label="Enabled proxy targets" value={String(enabledProxyCount)} tone={enabledProxyCount > 0 ? "good" : "neutral"} />
                  <StatusTile icon={<PlugZap />} label="Proxy targets connected" value={`${proxyHealthCounts.connected}/${proxyHealthCounts.enabled}`} tone={proxyHealthCounts.failing > 0 ? "warning" : proxyHealthCounts.connected > 0 ? "good" : "neutral"} />
                </section>

                <div className="current-state">
                  <div className="current-state__header">
                    <p className="eyebrow">Current state</p>
                    <span className={`pill ${connectedChargerCount > 0 ? "pill-good" : "pill-neutral"}`}>
                      {connectedChargerCount > 0 ? "Connected" : "Idle"}
                    </span>
                  </div>
                  <p>
                    {connectedChargerCount > 0
                      ? `${connectedChargerCount} charger${connectedChargerCount === 1 ? " is" : "s are"} connected right now.`
                      : "No chargers are connected right now."}
                  </p>
                  {latestCharger ? (
                    <p className="status-copy">
                      Latest event: <span className="mono">{latestCharger.id}</span>{" "}
                      {latestCharger.active ? "connected" : "registered"} at{" "}
                      {formatDateTime(latestCharger.disconnectedAt ?? latestCharger.connectedAt ?? latestCharger.updatedAt ?? latestCharger.lastSeenAt ?? null)}.
                    </p>
                  ) : (
                    <p className="status-copy">No charger registry rows have been loaded yet.</p>
                  )}
                </div>

                <section className="charging-stats-panel" aria-label="Live charging stats">
                  <div className="current-state__header">
                    <div>
                      <p className="eyebrow">Live charging</p>
                      <h3>
                        {chargingStatsStatus === "error"
                          ? "Stats unavailable"
                          : chargingStats.length > 1
                            ? `${chargingStats.length} active sessions`
                            : chargingStats[0]
                              ? `Transaction ${chargingStats[0].transactionId}`
                              : chargingStatsStatus === "loading"
                                ? "Loading stats"
                                : "No active session"}
                      </h3>
                    </div>
                    <Gauge aria-hidden="true" />
                  </div>
                  {chargingStatsStatus === "error" ? (
                    <p className="status-copy">Live meter stats could not be loaded. Recent sessions may still show active charging state.</p>
                  ) : chargingStats.length > 0 ? (
                    <div className="charging-session-stack">
                      {chargingStats.map((stats) => (
                        <article className="charging-session-card" key={stats.sessionId}>
                          {chargingStats.length > 1 ? (
                            <p className="mono charging-session-card__title">
                              {stats.chargerId} / tx {stats.transactionId}
                            </p>
                          ) : null}
                          <div className="charging-stats-grid">
                            <div>
                              <span>Energy used</span>
                              <strong>{formatEnergyWh(stats.energyUsedWh)}</strong>
                            </div>
                            <div>
                              <span>Charging power</span>
                              <strong>{formatPowerW(stats.latestPowerW)}</strong>
                            </div>
                            <div>
                              <span>Current</span>
                              <strong>{formatDecimalUnit(stats.latestCurrentA, "A")}</strong>
                            </div>
                            <div>
                              <span>Voltage</span>
                              <strong>{formatDecimalUnit(stats.latestVoltageV, "V")}</strong>
                            </div>
                          </div>
                          <p className="status-copy">
                            Started {formatDuration(stats.elapsedSeconds)} ago on connector {stats.connectorId}
                            {stats.latestSampleAt ? `; last meter sample ${formatDateTime(stats.latestSampleAt)}` : "; no meter sample yet"}.
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="status-copy">Start a charging session to see live meter values from OCPP MeterValues.</p>
                  )}
                </section>
              </section>
            </section>

            <section className="panel table-panel">
              <div className="topbar-actions page-section-header">
                <div>
                  <p className="eyebrow">Proxy health</p>
                  <h2>Upstream targets</h2>
                  <p className="status-copy">Scoped to {selectedChargerLabel}.</p>
                </div>
                <Button type="button" className="button-secondary" onClick={() => navigateToView("Proxy targets")}>
                  Proxy targets
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
              {!selectedChargerId ? (
                <p>Select a charger context to view upstream proxy health.</p>
              ) : proxyTargetHealth.length === 0 ? (
                <p>No proxy targets configured for this charger.</p>
              ) : (
                <div className="proxy-health-grid">
                  {proxyTargetHealth.map(({ target, health, connectionUrl }) => (
                    <article className="proxy-health-item" key={target.id}>
                      <div className="proxy-health-item__header">
                        <div>
                          <h3>{target.name}</h3>
                          <p className="mono">{connectionUrl}</p>
                        </div>
                        <span className={`pill ${health.tone === "good" ? "pill-good" : health.tone === "warning" ? "pill-warning" : "pill-neutral"}`}>
                          {health.label}
                        </span>
                      </div>
                      <p className="status-copy">
                        {health.detail}
                        {health.at ? ` at ${formatDateTime(health.at)}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel table-panel">
              <div className="topbar-actions">
                <div>
                  <p className="eyebrow">Chargers</p>
                  <h2>Current and recent connection state</h2>
                </div>
                <Button type="button" className="button-secondary" onClick={() => void loadChargers()} disabled={busy}>
                  <RefreshCcw aria-hidden="true" />
                  <span className="button-label">Refresh</span>
                </Button>
              </div>
              {recentChargers.length === 0 ? (
                <p>No charger registry rows available yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Charger</th>
                        <th>Label</th>
                        <th>Status</th>
                        <th>Connected</th>
                        <th>Disconnected</th>
                        <th>Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentChargers.map((charger) => (
                        <tr key={charger.id}>
                          <td className="mono">{getChargerContextId(charger)}</td>
                          <td>{getChargerDisplayLabel(charger)}</td>
                          <td>
                            <span className={`pill ${charger.active ? "pill-good" : "pill-neutral"}`}>
                              {getChargerStatusLabel(charger)}
                            </span>
                          </td>
                          <td>{formatDateTime(charger.connectedAt ?? null)}</td>
                          <td>{formatDateTime(charger.disconnectedAt ?? null)}</td>
                          <td>{formatDateTime(charger.lastSeenAt ?? charger.updatedAt ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        ) : activeView === "Sessions" ? (
          <section className="panel table-panel">
            <div className="topbar-actions">
              <div>
                <p className="eyebrow">Charging</p>
                <h2>Recent sessions</h2>
                <p className="status-copy">Scoped to {selectedChargerLabel}.</p>
              </div>
              <Button type="button" className="button-secondary" onClick={() => void loadChargingSessions(selectedChargerId)} disabled={busy}>
                <RefreshCcw aria-hidden="true" />
                <span className="button-label">Refresh</span>
              </Button>
            </div>
            {chargingSessions.length === 0 ? (
              <p>No charging sessions recorded yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Charger</th>
                      <th>Connector</th>
                      <th>Transaction</th>
                      <th>Tag</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th>Stopped</th>
                      <th>Meter Wh</th>
                      <th>Reason</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargingSessions.map((session) => (
                      <tr key={session.id}>
                        <td className="mono">{session.chargerId}</td>
                        <td>{session.connectorId}</td>
                        <td>{session.transactionId}</td>
                        <td className="mono">{session.idTag || "None"}</td>
                        <td>
                          <span className={`pill ${session.active ? "pill-good" : "pill-neutral"}`}>
                            {session.status}
                          </span>
                        </td>
                        <td>{formatDateTime(session.startedAt)}</td>
                        <td>{session.stoppedAt ? formatDateTime(session.stoppedAt) : "Active"}</td>
                        <td>
                          {session.startMeterWh ?? "-"}
                          {" / "}
                          {session.stopMeterWh ?? "-"}
                        </td>
                        <td>{session.stopReason || "-"}</td>
                        <td>
                          {session.active ? (
                            <div className="action-row compact-action-row">
                              <Button
                                type="button"
                                className="button-secondary icon-button"
                                onClick={() => void remoteStopChargingSession(session)}
                                disabled={busy}
                                title="Remote stop transaction"
                                aria-label={`Remote stop session ${session.transactionId}`}
                              >
                                <Power aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                className="button-secondary icon-button"
                                onClick={() => void closeChargingSession(session)}
                                disabled={busy}
                                title="Close lingering session"
                                aria-label={`Close lingering session ${session.transactionId}`}
                              >
                                <PowerOff aria-hidden="true" />
                              </Button>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : activeView === "Communication" ? (
          <section className="communication-layout">
            <section className="panel communication-filters-panel">
              <div className="compact-filter-heading">
                <div>
                  <p className="eyebrow">Journal</p>
                  <h2>Filters</h2>
                  <p className="status-copy">
                    Showing the last 24 hours by default, newest first, limit 200. Retention is {communicationRetentionHours ?? 24} hours. Scoped to {selectedChargerLabel}.
                  </p>
                </div>
                <SlidersHorizontal aria-hidden="true" />
              </div>
              <form className="communication-filter-form" onSubmit={applyCommunicationFilters}>
                <div className="communication-filter-primary">
                  <label className="field">
                    <span>OCPP method</span>
                    <input
                      value={communicationFilters.ocppMethod}
                      onChange={(event) => setCommunicationFilters((current) => ({ ...current, ocppMethod: event.target.value }))}
                      placeholder="BootNotification"
                    />
                  </label>
                  <label className="field">
                    <span>Message type</span>
                    <select
                      value={communicationFilters.messageType}
                      onChange={(event) => setCommunicationFilters((current) => ({ ...current, messageType: event.target.value }))}
                    >
                      <option value="">Any</option>
                      <option value="call">Call</option>
                      <option value="callResult">Call result</option>
                      <option value="callError">Call error</option>
                      <option value="connection">Connection</option>
                      <option value="disconnect">Disconnect</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>From</span>
                    <input
                      value={communicationFilters.from}
                      onChange={(event) => setCommunicationFilters((current) => ({ ...current, from: event.target.value }))}
                      type="datetime-local"
                    />
                  </label>
                  <label className="field">
                    <span>To</span>
                    <input
                      value={communicationFilters.to}
                      onChange={(event) => setCommunicationFilters((current) => ({ ...current, to: event.target.value }))}
                      type="datetime-local"
                    />
                  </label>
                  <div className="action-row communication-filter-actions">
                    <Button type="submit" disabled={busy}>
                      Apply filters
                    </Button>
                    <Button type="button" className="button-secondary" onClick={() => void resetCommunicationFilters()} disabled={busy}>
                      Reset
                    </Button>
                  </div>
                </div>

                <details className="advanced-filters">
                  <summary>
                    <span>Advanced filters</span>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <div className="communication-filters">
                    <label className="field">
                      <span>Source type</span>
                      <select
                        value={communicationFilters.sourceType}
                        onChange={(event) => setCommunicationFilters((current) => ({ ...current, sourceType: event.target.value }))}
                      >
                        <option value="">Any</option>
                        <option value="charger">Charger</option>
                        <option value="server">Server</option>
                        <option value="proxy">Proxy</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Source id</span>
                      <input
                        value={communicationFilters.sourceId}
                        onChange={(event) => setCommunicationFilters((current) => ({ ...current, sourceId: event.target.value }))}
                        placeholder="SMART-EVSE-1"
                      />
                    </label>
                    <label className="field">
                      <span>Target type</span>
                      <select
                        value={communicationFilters.targetType}
                        onChange={(event) => setCommunicationFilters((current) => ({ ...current, targetType: event.target.value }))}
                      >
                        <option value="">Any</option>
                        <option value="charger">Charger</option>
                        <option value="server">Server</option>
                        <option value="proxy">Proxy</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Target id</span>
                      <input
                        value={communicationFilters.targetId}
                        onChange={(event) => setCommunicationFilters((current) => ({ ...current, targetId: event.target.value }))}
                        placeholder="server"
                      />
                    </label>
                    <label className="field">
                      <span>Charger id</span>
                      {selectedChargerId ? (
                        <input value={communicationFilters.chargerId} disabled />
                      ) : (
                        <input
                          value={communicationFilters.chargerId}
                          onChange={(event) => setCommunicationFilters((current) => ({ ...current, chargerId: event.target.value }))}
                          placeholder="SMART-EVSE-1"
                        />
                      )}
                    </label>
                    <label className="field">
                      <span>Proxy target id</span>
                      <input
                        value={communicationFilters.proxyTargetId}
                        onChange={(event) => setCommunicationFilters((current) => ({ ...current, proxyTargetId: event.target.value }))}
                        placeholder="proxy-1"
                      />
                    </label>
                  </div>
                </details>
              </form>
            </section>

            <section className="panel table-panel communication-table-panel">
              <div className="topbar-actions">
                <div>
                  <p className="eyebrow">Communication</p>
                  <h2>Recent journal rows</h2>
                </div>
                <div className="action-row">
                  <Button type="button" className="button-secondary" onClick={() => void loadCommunicationJournal(selectedChargerId, communicationFilters)} disabled={busy}>
                    <RefreshCcw aria-hidden="true" />
                    <span className="button-label">Refresh</span>
                  </Button>
                  <Button type="button" className="button-ghost button-danger" onClick={() => void purgeCommunicationJournal()} disabled={busy}>
                    <Trash2 aria-hidden="true" />
                    <span className="button-label">Purge</span>
                  </Button>
                </div>
              </div>
              {communicationJournal.length === 0 ? (
                <p>No communication rows match these filters.</p>
              ) : (
                <div className="table-wrap communication-table-wrap">
                  <table className="communication-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Direction</th>
                        <th>Source</th>
                        <th>Target</th>
                        <th>Method</th>
                        <th>Message type</th>
                        <th>Charger</th>
                        <th>Proxy target</th>
                        <th>Transaction</th>
                        <th>Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {communicationJournal.map((item) => {
                        const isExpanded = expandedCommunicationJournalId === item.id;

                        return (
                          <Fragment key={item.id}>
                            <tr key={item.id}>
                              <td>{formatDateTime(item.createdAt)}</td>
                              <td>
                                <span className={`pill ${item.direction === "inbound" ? "pill-good" : "pill-neutral"}`}>{item.direction}</span>
                              </td>
                              <td className="mono">{renderCommunicationEndpoint(item.sourceType, item.sourceId)}</td>
                              <td className="mono">{renderCommunicationEndpoint(item.targetType, item.targetId)}</td>
                              <td className="mono">{item.ocppMethod || "-"}</td>
                              <td>{item.messageType}</td>
                              <td className="mono">{item.chargerId || "-"}</td>
                              <td className="mono">
                                {item.proxyTargetId ? <span title={item.proxyTargetId}>{formatProxyTargetLabel(item.proxyTargetId)}</span> : "-"}
                              </td>
                              <td>{item.transactionId ?? "-"}</td>
                              <td>
                                <div className="communication-summary">
                                  <Button
                                    type="button"
                                    className="button-secondary icon-button communication-toggle"
                                    onClick={() =>
                                      setExpandedCommunicationJournalId(isExpanded ? null : item.id)
                                    }
                                    aria-expanded={isExpanded}
                                    aria-controls={`journal-payload-${item.id}`}
                                    aria-label={isExpanded ? "Hide payload" : "Show payload"}
                                    title={isExpanded ? "Hide payload" : "Show payload"}
                                  >
                                    {isExpanded ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                                  </Button>
                                  <p>{buildCommunicationSummary(item)}</p>
                                </div>
                              </td>
                            </tr>
                            {isExpanded ? (
                              <tr key={`${item.id}-payload`}>
                                <td id={`journal-payload-${item.id}`} className="communication-expanded" colSpan={10}>
                                  <div className="communication-expanded__grid">
                                    <div>
                                      <p className="eyebrow">Payload</p>
                                      <pre className="communication-payload">{stringifyPayload(item.payload)}</pre>
                                    </div>
                                    <div className="communication-details">
                                      <p>
                                        <span className="eyebrow">Direction</span>
                                        <span>{item.direction}</span>
                                      </p>
                                      <p>
                                        <span className="eyebrow">Source</span>
                                        <span className="mono">{renderCommunicationEndpoint(item.sourceType, item.sourceId)}</span>
                                      </p>
                                      <p>
                                        <span className="eyebrow">Target</span>
                                        <span className="mono">{renderCommunicationEndpoint(item.targetType, item.targetId)}</span>
                                      </p>
                                      <p>
                                        <span className="eyebrow">Correlation</span>
                                        <span className="mono">{item.correlationId || "-"}</span>
                                      </p>
                                      <p>
                                        <span className="eyebrow">Error</span>
                                        <span className="mono">
                                          {item.errorCode ? item.errorCode : "-"}
                                          {item.errorDescription ? ` - ${item.errorDescription}` : ""}
                                        </span>
                                      </p>
                                      <p>
                                        <span className="eyebrow">Tag</span>
                                        <span className="mono">{item.idTag || "-"}</span>
                                      </p>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        ) : activeView === "Tags" ? (
          <>
            <section className="panel table-panel">
              <div className="topbar-actions page-section-header">
                <div>
                  <p className="eyebrow">Authorization</p>
                  <h2>Configured tags</h2>
                  <p className="status-copy">Tags stay global. Access below applies to the selected charger context.</p>
                </div>
                <Button type="button" onClick={startTagCreate} disabled={busy}>
                  <Plus aria-hidden="true" />
                  Add tag
                </Button>
              </div>
              {tags.length === 0 ? (
                <p>No tags configured yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tag UUID</th>
                        <th>Label</th>
                        <th>Status</th>
                        <th>Selected charger access</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tags.map((tag) => (
                        <tr key={tag.id}>
                          <td className="mono">{tag.uuid}</td>
                          <td>{tag.label || "Unlabeled"}</td>
                          <td>
                            <span className={`pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>
                              {tag.enabled ? "Enabled" : "Disabled"}
                            </span>
                          </td>
                          <td>
                            {selectedChargerId ? (
                              <span className={`pill ${getTagAccessForCharger(tag, selectedChargerId) ? "pill-good" : "pill-warning"}`}>
                                {getTagAccessForCharger(tag, selectedChargerId) ? "Allowed" : "Blocked"}
                              </span>
                            ) : (
                              <span className="status-copy">Select a charger</span>
                            )}
                          </td>
                          <td>{new Date(tag.createdAt).toLocaleString()}</td>
                          <td>
                            <div className="action-row">
                              <Button type="button" className="button-secondary" onClick={() => startTagEdit(tag)} disabled={busy}>
                                <Pencil aria-hidden="true" />
                                <span className="button-label">Edit</span>
                              </Button>
                              <Button type="button" onClick={() => void toggleTag(tag)} disabled={busy}>
                                {tag.enabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
                                <span className="button-label">{tag.enabled ? "Disable" : "Enable"}</span>
                              </Button>
                              <Button
                                type="button"
                                className="button-secondary"
                                onClick={() => void toggleTagAccess(tag)}
                                disabled={busy || !selectedChargerId}
                              >
                                {selectedChargerId && getTagAccessForCharger(tag, selectedChargerId) ? "Revoke access" : "Grant access"}
                              </Button>
                              <Button type="button" className="button-ghost" onClick={() => void deleteTag(tag)} disabled={busy}>
                                <Trash2 aria-hidden="true" />
                                <span className="button-label">Delete</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {tagModalOpen ? (
              <div className="modal-backdrop" role="presentation">
                <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="tag-modal-title">
                  <div className="topbar-actions page-section-header">
                    <div>
                      <p className="eyebrow">Allowlist</p>
                      <h2 id="tag-modal-title">{isEditingTag ? "Edit tag" : "Add tag"}</h2>
                      <p className="status-copy">Selected charger context: {selectedChargerLabel}.</p>
                    </div>
                    <Button type="button" className="button-ghost" onClick={cancelTagEdit} disabled={busy} aria-label="Close tag modal">
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                  <form className="form-grid" onSubmit={submitTag}>
                    <label className="field">
                      <span>Tag UUID</span>
                      <input
                        value={tagForm.uuid}
                        onChange={(event) => setTagForm((current) => ({ ...current, uuid: event.target.value }))}
                        placeholder="04A1B2C3"
                      />
                    </label>
                    <label className="field">
                      <span>Label</span>
                      <input
                        value={tagForm.label}
                        onChange={(event) => setTagForm((current) => ({ ...current, label: event.target.value }))}
                        placeholder="Main RFID"
                      />
                    </label>
                    <label className="check-row">
                      <input
                        checked={tagForm.enabled}
                        onChange={(event) => setTagForm((current) => ({ ...current, enabled: event.target.checked }))}
                        type="checkbox"
                      />
                      Enabled for charging
                    </label>
                    <div className="action-row modal-actions">
                      <Button type="button" className="button-secondary" onClick={cancelTagEdit} disabled={busy}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={busy || !tagForm.uuid.trim()}>
                        {isEditingTag ? "Save changes" : (
                          <>
                            <Plus aria-hidden="true" />
                            Add tag
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </section>
              </div>
            ) : null}
          </>
        ) : (
          <section className="proxy-target-layout">
            <section className="panel table-panel">
                <div className="topbar-actions page-section-header">
                  <div>
                  <p className="eyebrow">Routing</p>
                  <h2>Configured targets</h2>
                  <p className="status-copy">Targets are listed for the selected charger context.</p>
                  </div>
                  <Button type="button" onClick={startProxyTargetCreate} disabled={busy || !selectedChargerId}>
                    <Plus aria-hidden="true" />
                    Add target
                  </Button>
                </div>
                {proxyTargets.length === 0 ? (
                  <p>No proxy targets configured yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>URL</th>
                          <th>Station ID</th>
                          <th>Mode</th>
                          <th>Outage</th>
                          <th>Status</th>
                          <th>Credentials</th>
                          <th>Tag mappings</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proxyTargets.map((target) => (
                          <tr key={target.id}>
                            <td>{target.name}</td>
                            <td className="mono">{target.url}</td>
                            <td className="mono">{target.stationId || "Default"}</td>
                            <td>{target.mode === "deny-capable" ? "Deny capable" : "Monitor only"}</td>
                            <td>{target.outagePolicy === "fail-closed" ? "Fail closed" : "Fail open"}</td>
                            <td>
                              <span className={`pill ${target.enabled ? "pill-good" : "pill-warning"}`}>
                                {target.enabled ? "Enabled" : "Disabled"}
                              </span>
                            </td>
                            <td>{target.hasUsername || target.hasBasicAuthPassword ? "Configured" : "None"}</td>
                            <td>{formatTagMappingCount(target.tagMappings?.length ?? 0)}</td>
                            <td>
                              <div className="action-row">
                                <Button type="button" className="button-secondary" onClick={() => startProxyTargetEdit(target)} disabled={busy}>
                                  <Pencil aria-hidden="true" />
                                  <span className="button-label">Edit</span>
                                </Button>
                                <Button type="button" onClick={() => void toggleProxyTarget(target)} disabled={busy}>
                                  {target.enabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
                                  <span className="button-label">{target.enabled ? "Disable" : "Enable"}</span>
                                </Button>
                                <Button type="button" className="button-ghost" onClick={() => void deleteProxyTarget(target)} disabled={busy}>
                                  <Trash2 aria-hidden="true" />
                                  <span className="button-label">Delete</span>
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

            {proxyTargetModalOpen ? (
              <div className="modal-backdrop" role="presentation">
                <section className="panel modal-panel modal-panel-wide" role="dialog" aria-modal="true" aria-labelledby="proxy-target-modal-title">
                  <div className="topbar-actions page-section-header">
                    <div>
                      <p className="eyebrow">Upstream CSMS</p>
                      <h2 id="proxy-target-modal-title">{isEditingProxyTarget ? "Edit target" : "Add target"}</h2>
                      <p className="status-copy">Scoped to {selectedChargerLabel}.</p>
                    </div>
                    <Button type="button" className="button-ghost" onClick={cancelProxyTargetEdit} disabled={busy} aria-label="Close proxy target modal">
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                  <form className="form-grid modal-form-grid" onSubmit={submitProxyTarget}>
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={proxyTargetForm.name}
                        onChange={(event) => setProxyTargetForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Backend CSMS"
                      />
                    </label>
                    <label className="field">
                      <span>URL</span>
                      <input
                        aria-label="URL"
                        value={proxyTargetForm.url}
                        onChange={(event) => setProxyTargetForm((current) => ({ ...current, url: event.target.value }))}
                        placeholder="ws://evcc.local:8887"
                      />
                      <small>Use the upstream base URL. The station ID is appended as the OCPP identity path.</small>
                    </label>
                    <label className="field">
                      <span>Username</span>
                      <input
                        value={proxyTargetForm.username}
                        onChange={(event) =>
                          setProxyTargetForm((current) => ({
                            ...current,
                            username: event.target.value,
                            clearUsername: event.target.value ? false : current.clearUsername
                          }))
                        }
                        placeholder={isEditingProxyTarget ? "Leave blank to keep current username" : "Optional"}
                      />
                    </label>
                    <label className="field">
                      <span>Station ID</span>
                      <input
                        aria-label="Station ID"
                        value={proxyTargetForm.stationId}
                        onChange={(event) => setProxyTargetForm((current) => ({ ...current, stationId: event.target.value }))}
                        placeholder="Defaults to charger ID"
                      />
                      <small>Example: URL <span className="mono">ws://10.210.1.1:8887</span> and Station ID <span className="mono">8889</span> connects to <span className="mono">/8889</span>.</small>
                    </label>
                    <div className={`connection-preview ${proxyTargetFormHasDuplicatedStationPath ? "connection-preview-warning" : ""}`}>
                      <p className="eyebrow">Computed upstream URL</p>
                      <p className="mono">{proxyTargetFormConnectionUrl || "Enter a URL to preview the connection path."}</p>
                      {proxyTargetFormHasDuplicatedStationPath ? (
                        <p className="status-copy">
                          The URL already ends with the station ID. This would duplicate the path. Put the station only in Station ID.
                        </p>
                      ) : null}
                    </div>
                    <label className="field">
                      <span>Password</span>
                      <input
                        value={proxyTargetForm.basicAuthPassword}
                        onChange={(event) =>
                          setProxyTargetForm((current) => ({
                            ...current,
                            basicAuthPassword: event.target.value,
                            clearBasicAuthPassword: event.target.value ? false : current.clearBasicAuthPassword
                          }))
                        }
                        type="password"
                        placeholder={isEditingProxyTarget ? "Leave blank to keep current password" : "Optional"}
                      />
                    </label>
                    {isEditingProxyTarget ? (
                      <>
                        <p className="status-copy">
                          {proxyTargetForm.hasUsername ? "Stored username is set." : "No stored username is set."}
                        </p>
                        <label className="check-row">
                          <input
                            checked={proxyTargetForm.clearUsername}
                            onChange={(event) =>
                              setProxyTargetForm((current) => ({
                                ...current,
                                clearUsername: event.target.checked,
                                username: event.target.checked ? "" : current.username
                              }))
                            }
                            type="checkbox"
                          />
                          Clear stored username
                        </label>
                        <p className="status-copy">
                          {proxyTargetForm.hasBasicAuthPassword ? "Stored password is set." : "No stored password is set."}
                        </p>
                        <label className="check-row">
                          <input
                            checked={proxyTargetForm.clearBasicAuthPassword}
                            onChange={(event) =>
                              setProxyTargetForm((current) => ({
                                ...current,
                                clearBasicAuthPassword: event.target.checked,
                                basicAuthPassword: event.target.checked ? "" : current.basicAuthPassword
                              }))
                            }
                            type="checkbox"
                          />
                          Clear stored password
                        </label>
                      </>
                    ) : null}
                    <section className="tag-mapping-editor">
                      <div className="topbar-actions page-section-header">
                        <div>
                          <p className="eyebrow">Tag mapping</p>
                          <h3>Proxy authentication</h3>
                          <p className="status-copy">Replace local idTags only for this upstream proxy.</p>
                        </div>
                        <Button type="button" className="button-secondary" onClick={addProxyTagMapping} disabled={busy}>
                          <Plus aria-hidden="true" />
                          <span className="button-label">Add mapping</span>
                        </Button>
                      </div>
                      {proxyTargetForm.tagMappings.length === 0 ? (
                        <p className="status-copy">No tag mappings configured. The proxy receives the local charger tag unchanged.</p>
                      ) : (
                        <div className="tag-mapping-list">
                          {proxyTargetForm.tagMappings.map((mapping, index) => (
                            <div className="tag-mapping-row" key={mapping.id ?? index}>
                              <label className="field">
                                <span>Local tag</span>
                                <input
                                  list="known-tag-uuids"
                                  value={mapping.localIdTag}
                                  onChange={(event) => updateProxyTagMapping(index, { localIdTag: event.target.value })}
                                  placeholder="SmartEVSE idTag"
                                />
                              </label>
                              <label className="field">
                                <span>Outbound tag</span>
                                <input
                                  value={mapping.outboundIdTag}
                                  onChange={(event) => updateProxyTagMapping(index, { outboundIdTag: event.target.value })}
                                  placeholder="Proxy idTag"
                                />
                              </label>
                              <Button
                                type="button"
                                className="button-ghost icon-button tag-mapping-remove"
                                onClick={() => removeProxyTagMapping(index)}
                                disabled={busy}
                                title="Remove tag mapping"
                                aria-label={`Remove tag mapping ${index + 1}`}
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <datalist id="known-tag-uuids">
                        {tags.map((tag) => (
                          <option key={tag.id} value={tag.uuid}>
                            {tag.label ?? tag.uuid}
                          </option>
                        ))}
                      </datalist>
                    </section>
                    <label className="field">
                      <span>Mode</span>
                      <select
                        value={proxyTargetForm.mode}
                        onChange={(event) => setProxyTargetForm((current) => ({ ...current, mode: event.target.value as ProxyTarget["mode"] }))}
                      >
                        <option value="monitor-only">Monitor only</option>
                        <option value="deny-capable">Deny capable</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Outage policy</span>
                      <select
                        value={proxyTargetForm.outagePolicy}
                        onChange={(event) =>
                          setProxyTargetForm((current) => ({ ...current, outagePolicy: event.target.value as ProxyTarget["outagePolicy"] }))
                        }
                      >
                        <option value="fail-open">Fail open</option>
                        <option value="fail-closed">Fail closed</option>
                      </select>
                    </label>
                    <label className="check-row">
                      <input
                        checked={proxyTargetForm.enabled}
                        onChange={(event) => setProxyTargetForm((current) => ({ ...current, enabled: event.target.checked }))}
                        type="checkbox"
                      />
                      Enabled
                    </label>
                    <div className="action-row modal-actions">
                      <Button type="button" className="button-secondary" onClick={cancelProxyTargetEdit} disabled={busy}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={busy || !proxyTargetForm.name.trim() || !proxyTargetForm.url.trim() || (!selectedChargerId && !isEditingProxyTarget)}>
                        {isEditingProxyTarget ? "Save changes" : (
                          <>
                            <Plus aria-hidden="true" />
                            Add target
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </section>
              </div>
            ) : null}
          </section>
        )}
      </section>
    </main>
  );
}

function StatusTile({
  icon,
  label,
  value,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "good" | "neutral" | "warning";
}) {
  return (
    <article className={`status-tile ${tone}`}>
      <div className="tile-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}
