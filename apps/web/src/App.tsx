import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  X
} from "lucide-react";
import { Button } from "./components/ui/button";
import { AppChrome } from "./components/AppChrome";
import { AuthPage } from "./components/AuthPage";
import { ChargerOnboardingModal } from "./components/ChargerOnboardingModal";
import { CommunicationView } from "./components/CommunicationView";
import { DashboardView } from "./components/DashboardView";
import { ForceClosePreviewModal } from "./components/ForceClosePreviewModal";
import { GlobalDashboardView } from "./components/GlobalDashboardView";
import { TagAccessView } from "./components/TagAccessView";
import { ChargerDeleteModal } from "./components/ChargerDeleteModal";
import { ChargerLabelModal } from "./components/ChargerLabelModal";
import { ChargersView } from "./components/ChargersView";
import { SessionsView } from "./components/SessionsView";
import { TagsView } from "./components/TagsView";
import type {
  ActiveSessionAuditResponse,
  ActiveView,
  ChargerRegistryRow,
  ChargingSession,
  ChargingStats,
  CommunicationJournalFilters,
  CommunicationJournalItem,
  CommunicationJournalResponse,
  DashboardConfig,
  ForceClosePreview,
  LiveStatus,
  LiveUpdateEnvelope,
  LiveUpdateEvent,
  LogEntry,
  ProxyHealthResponse,
  ProxyTagMapping,
  ProxyTarget,
  ProxyTargetFormState,
  SessionSummary,
  Tag,
  TagFormState,
  ThemeMode
} from "./types";
import {
  buildCommunicationJournalQuery,
  buildProxyTargetConnectionUrl,
  buildViewUrl,
  emptyCommunicationJournalFilters,
  emptyProxyTargetForm,
  emptyTagForm,
  formatTagMappingCount,
  getChargerContextId,
  getChargerDisplayLabel,
  getInitialSidebarCollapsed,
  getInitialTheme,
  getSearchParam,
  getTagAccessForCharger,
  getViewFromPath,
  getProxyTargetUpstreamIdentity,
  proxyUrlIncludesStationId,
  setStoredPreference,
  withChargerContext
} from "./app-helpers";

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
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [proxyHealth, setProxyHealth] = useState<ProxyHealthResponse | null>(null);
  const [activeSessionAudit, setActiveSessionAudit] = useState<ActiveSessionAuditResponse | null>(null);
  const [chargingStatsStatus, setChargingStatsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [forceClosePreview, setForceClosePreview] = useState<ForceClosePreview | null>(null);
  const [forceCloseLoading, setForceCloseLoading] = useState(false);
  const [chargerLabelTarget, setChargerLabelTarget] = useState<ChargerRegistryRow | null>(null);
  const [chargerLabelValue, setChargerLabelValue] = useState("");
  const [chargerDeleteTarget, setChargerDeleteTarget] = useState<ChargerRegistryRow | null>(null);
  const [chargerDeleteAdminPassword, setChargerDeleteAdminPassword] = useState("");
  const [chargerDeleteConfirmation, setChargerDeleteConfirmation] = useState("");
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
  const [chargerWizardOpen, setChargerWizardOpen] = useState(false);
  const [chargerWizardStartedAt, setChargerWizardStartedAt] = useState("");
  const [chargerWizardKnownIds, setChargerWizardKnownIds] = useState<string[]>([]);
  const [chargerWizardLabel, setChargerWizardLabel] = useState("");
  const [chargerWizardLoading, setChargerWizardLoading] = useState(false);
  const [selectedChargerId, setSelectedChargerId] = useState(() => getSearchParam("chargerId"));
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getInitialSidebarCollapsed());
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [message, setMessage] = useState("Sign in to manage proxy targets.");
  const [busy, setBusy] = useState(false);

  const connectedChargerCount = useMemo(() => chargers.filter((charger) => charger.active).length, [chargers]);
  const selectedCharger = useMemo(
    () => chargers.find((charger) => charger.id === selectedChargerId || charger.chargerId === selectedChargerId) ?? null,
    [chargers, selectedChargerId]
  );
  const chargerWizardDetectedCharger = useMemo(() => {
    if (!chargerWizardOpen || chargerWizardLoading) return null;
    const knownIds = new Set(chargerWizardKnownIds);

    return chargers.find((charger) => !knownIds.has(getChargerContextId(charger))) ?? null;
  }, [chargerWizardKnownIds, chargerWizardLoading, chargerWizardOpen, chargers]);
  const selectedChargerLabel = selectedCharger ? getChargerDisplayLabel(selectedCharger) : "All chargers";
  const proxyTargetHealth = useMemo(
    () =>
      (proxyHealth?.targets ?? proxyTargets.map((target) => ({
        proxyTargetId: target.id,
        name: target.name,
        chargerId: target.chargerId ?? null,
        enabled: target.enabled,
        mode: target.mode,
        outagePolicy: target.outagePolicy,
        connected: false,
        state: target.enabled ? "unknown" as const : "disabled" as const,
        detail: target.enabled ? "No runtime proxy health loaded yet." : "Target is disabled.",
        upstreamIdentity: getProxyTargetUpstreamIdentity(target, selectedChargerId),
        hadSuccessfulConnection: false,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        nextReconnectAt: null,
        lastErrorCode: null
      }))).map((health) => {
        const target = proxyTargets.find((entry) => entry.id === health.proxyTargetId);
        return {
          target,
          health,
          connectionUrl: target
            ? buildProxyTargetConnectionUrl(target.url, health.upstreamIdentity ?? getProxyTargetUpstreamIdentity(target, selectedChargerId))
            : health.upstreamIdentity ?? ""
        };
      }),
    [proxyHealth, proxyTargets, selectedChargerId]
  );
  const proxyHealthCounts = useMemo(
    () => ({
      connected: proxyHealth?.summary.connected ?? proxyTargetHealth.filter((entry) => entry.health.state === "connected").length,
      failing: proxyTargetHealth.filter((entry) => entry.health.state === "backoff" || entry.health.state === "disconnected").length,
      enabled: proxyTargetHealth.filter((entry) => entry.health.enabled).length
    }),
    [proxyHealth, proxyTargetHealth]
  );
  const proxyTargetFormIdentity = proxyTargetForm.stationId.trim() || selectedChargerId;
  const proxyTargetFormConnectionUrl = buildProxyTargetConnectionUrl(proxyTargetForm.url, proxyTargetFormIdentity);
  const proxyTargetFormHasDuplicatedStationPath = proxyUrlIncludesStationId(proxyTargetForm.url, proxyTargetFormIdentity);

  const isEditingTag = tagForm.id !== null;
  const isEditingProxyTarget = proxyTargetForm.id !== null;
  const selectedConnectionStatus = selectedCharger?.active ? "Connected" : selectedCharger ? "Registered" : connectedChargerCount > 0 ? "Connected" : "Idle";
  const selectedConnectionTone = selectedCharger?.active || (!selectedCharger && connectedChargerCount > 0) ? "pill-good" : "pill-neutral";

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
      setChargerWizardOpen(false);
      setChargerLabelTarget(null);
      setChargerLabelValue("");
      setChargerDeleteTarget(null);
      setChargerDeleteAdminPassword("");
      setChargerDeleteConfirmation("");
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
    if (!authenticated || !message) return;

    const timeout = window.setTimeout(() => setMessage(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [authenticated, message]);

  useEffect(() => {
    if (!authenticated) return;
    setCommunicationFilters((current) => (current.chargerId === selectedChargerId ? current : { ...current, chargerId: selectedChargerId }));
    void loadScopedData(selectedChargerId);
  }, [authenticated, selectedChargerId]);

  useEffect(() => {
    if (!authenticated) {
      setLiveStatus("connecting");
      return;
    }

    setLiveStatus("connecting");
    if (typeof EventSource === "undefined") {
      setLiveStatus("stale");
      return;
    }

    const events = new EventSource("/api/live-updates", { withCredentials: true });

    events.onopen = () => setLiveStatus("live");
    events.onerror = () => setLiveStatus("stale");
    const handleLiveEvent = (event: MessageEvent<string>) => {
      setLiveStatus("live");
      try {
        const parsed = JSON.parse(event.data) as LiveUpdateEnvelope | LiveUpdateEvent;
        const liveEvent = "event" in parsed && parsed.event ? parsed.event : (parsed as LiveUpdateEvent);
        handleLiveUpdate(liveEvent);
      } catch {
        handleLiveUpdate({ type: "refresh", topic: "sessions" });
      }
    };

    events.addEventListener("message", handleLiveEvent as EventListener);
    events.addEventListener("live-update", handleLiveEvent as EventListener);

    return () => events.close();
  }, [authenticated, selectedChargerId]);

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
    setChargerWizardOpen(false);
    setChargerLabelTarget(null);
    setChargerLabelValue("");
    setChargerDeleteTarget(null);
    setChargerDeleteAdminPassword("");
    setChargerDeleteConfirmation("");
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
    setSessionSummary(null);
    setChargingStatsStatus("idle");
    setLogs([]);
    setDashboardConfig(null);
    setTagForm(emptyTagForm());
    setProxyTargetForm(emptyProxyTargetForm());
    setTagModalOpen(false);
    setProxyTargetModalOpen(false);
    setChargerWizardOpen(false);
    setChargerWizardKnownIds([]);
    setChargerWizardLabel("");
    setChargerWizardStartedAt("");
    setChargerWizardLoading(false);
    setCommunicationJournal([]);
    setCommunicationRetentionHours(null);
    setProxyHealth(null);
    setActiveSessionAudit(null);
    setCommunicationFilters(emptyCommunicationJournalFilters());
    setExpandedCommunicationJournalId(null);
    setChargerLabelTarget(null);
    setChargerLabelValue("");
    setChargerDeleteTarget(null);
    setChargerDeleteAdminPassword("");
    setChargerDeleteConfirmation("");
    setSelectedChargerId("");
    setActiveView("Home");
    setLiveStatus("connecting");
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

  function eventAppliesToSelectedCharger(event: LiveUpdateEvent) {
    return !selectedChargerId || !event.chargerId || event.chargerId === selectedChargerId;
  }

  function handleLiveUpdate(event: LiveUpdateEvent) {
    if (!eventAppliesToSelectedCharger(event)) {
      void loadChargers();
      return;
    }

    void loadScopedData(selectedChargerId);
  }

  async function loadAdminData(chargerId = selectedChargerId) {
    await Promise.all([loadDashboardConfig(), loadChargers()]);
  }

  async function loadScopedData(chargerId = selectedChargerId) {
    await Promise.all([
      loadChargers(),
      loadProxyTargets(chargerId),
      loadProxyHealth(chargerId),
      loadActiveSessionAudit(chargerId),
      loadTags(),
      loadChargingSessions(chargerId),
      loadSessionSummary(chargerId),
      loadChargingStats(chargerId),
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

  async function loadTags() {
    const data = await fetchAdminJson<Tag[]>("/api/tags");
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

  function startChargerLabelEdit(charger: ChargerRegistryRow) {
    navigateToView("Chargers");
    setChargerLabelTarget(charger);
    setChargerLabelValue(charger.label ?? "");
  }

  function cancelChargerLabelEdit() {
    setChargerLabelTarget(null);
    setChargerLabelValue("");
  }

  async function submitChargerLabelEdit() {
    if (!chargerLabelTarget) return;

    setBusy(true);
    setMessage(`Saving label for charger ${chargerLabelTarget.id}...`);
    try {
      const response = await fetch(`/api/chargers/${encodeURIComponent(chargerLabelTarget.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: chargerLabelValue.trim() ? chargerLabelValue.trim() : null })
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not save charger label.");
        return;
      }

      cancelChargerLabelEdit();
      setMessage(`Charger ${chargerLabelTarget.id} label updated.`);
      await loadChargers();
    } finally {
      setBusy(false);
    }
  }

  function startChargerDelete(charger: ChargerRegistryRow) {
    navigateToView("Chargers");
    setChargerDeleteTarget(charger);
    setChargerDeleteAdminPassword("");
    setChargerDeleteConfirmation("");
  }

  function cancelChargerDelete() {
    setChargerDeleteTarget(null);
    setChargerDeleteAdminPassword("");
    setChargerDeleteConfirmation("");
  }

  async function submitChargerDelete() {
    if (!chargerDeleteTarget) return;

    const chargerId = chargerDeleteTarget.id;
    const confirmation = chargerDeleteConfirmation.trim();
    if (confirmation !== chargerId || !chargerDeleteAdminPassword.length) return;

    setBusy(true);
    setMessage(`Deleting charger ${chargerId}...`);
    try {
      const response = await fetch(`/api/chargers/${encodeURIComponent(chargerId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminPassword: chargerDeleteAdminPassword,
          chargerIdConfirmation: confirmation
        })
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        if (response.status === 403) {
          setMessage("Admin password was rejected.");
        } else if (response.status === 409) {
          setMessage("Charger id confirmation does not match.");
        } else {
          setMessage("Could not delete charger.");
        }
        return;
      }

      const deletedSelectedCharger = selectedChargerId === getChargerContextId(chargerDeleteTarget);
      cancelChargerDelete();
      if (deletedSelectedCharger) {
        setSelectedChargerId("");
      }
      setMessage("Charger deleted.");
      await (deletedSelectedCharger ? loadScopedData("") : loadChargers());
    } finally {
      setBusy(false);
    }
  }

  async function openChargerWizard() {
    setChargerWizardLabel("");
    setChargerWizardOpen(true);
    setChargerWizardLoading(true);
    const startedAt = new Date().toISOString();
    setChargerWizardStartedAt(startedAt);
    const chargerData = await fetchAdminJson<ChargerRegistryRow[]>("/api/chargers");
    if (chargerData === null) return;
    if (chargerData === undefined) {
      setMessage("Could not load charger registry.");
      setChargerWizardLoading(false);
      return;
    }

    setChargers(chargerData);
    setChargerWizardKnownIds(chargerData.map((charger) => getChargerContextId(charger)));
    setChargerWizardLoading(false);
    void loadDashboardConfig();
  }

  function closeChargerWizard() {
    setChargerWizardOpen(false);
    setChargerWizardLabel("");
    setChargerWizardKnownIds([]);
    setChargerWizardStartedAt("");
    setChargerWizardLoading(false);
    setMessage("");
  }

  async function copyChargerWizardUrl() {
    if (!dashboardConfig?.ocppWebSocketUrl) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard not available");
      }
      await navigator.clipboard.writeText(dashboardConfig.ocppWebSocketUrl);
      setMessage("Copied charger URL.");
    } catch {
      setMessage("Could not copy charger URL.");
    }
  }

  async function finishChargerWizard() {
    if (!chargerWizardDetectedCharger) return;
    const chargerId = getChargerContextId(chargerWizardDetectedCharger);
    const label = chargerWizardLabel.trim();

    setBusy(true);
    try {
      if (label) {
        const response = await fetch(`/api/chargers/${encodeURIComponent(chargerId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label })
        });

        if (handleUnauthorized(response)) return;
        if (!response.ok) {
          setMessage("Could not save charger label.");
          return;
        }
      }

      await loadChargers();
      closeChargerWizard();
      setSelectedChargerId(chargerId);
      setActiveView("Charger dashboard");
      setMessage(label ? `Charger ${label} added.` : `Charger ${chargerId} added.`);
    } finally {
      setBusy(false);
    }
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

  async function loadSessionSummary(chargerId = selectedChargerId) {
    if (!chargerId) {
      setSessionSummary(null);
      return;
    }

    const data = await fetchAdminJson<SessionSummary>(withChargerContext("/api/session-summary", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load session summary.");
      return;
    }
    setSessionSummary(data);
  }

  async function loadProxyHealth(chargerId = selectedChargerId) {
    if (!chargerId) {
      setProxyHealth(null);
      return;
    }
    const data = await fetchAdminJson<ProxyHealthResponse>(withChargerContext("/api/proxy-health", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load proxy health.");
      return;
    }
    setProxyHealth(data);
  }

  async function loadActiveSessionAudit(chargerId = selectedChargerId) {
    const data = await fetchAdminJson<ActiveSessionAuditResponse>(withChargerContext("/api/active-session-audit", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load session audit.");
      return;
    }
    setActiveSessionAudit(data);
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

  async function previewForceCloseChargingSession(session: ChargingSession) {
    setBusy(true);
    setForceCloseLoading(true);
    setMessage(`Preparing force close preview for session ${session.transactionId}...`);
    try {
      const response = await fetch(`/api/sessions/${session.id}/force-close-preview`, {
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not prepare force close preview.");
        return;
      }

      const preview = (await response.json()) as ForceClosePreview;
      setForceClosePreview(preview);
      setMessage(`Review force close payload for session ${session.transactionId}.`);
    } finally {
      setForceCloseLoading(false);
      setBusy(false);
    }
  }

  async function executeForceCloseChargingSession() {
    if (!forceClosePreview) return;

    setBusy(true);
    setForceCloseLoading(true);
    setMessage(`Force closing session ${forceClosePreview.session.transactionId}...`);
    try {
      const response = await fetch(`/api/sessions/${forceClosePreview.session.id}/force-close`, {
        method: "POST",
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage(response.status === 409 ? "Session is no longer active." : "Could not force close charging session.");
        return;
      }

      const result = (await response.json()) as ForceClosePreview;
      const failed = result.proxyResults?.filter((entry) => entry.attempted && !entry.ok).length ?? 0;
      setForceClosePreview(null);
      setMessage(failed > 0 ? `Force closed session ${result.session.transactionId}; ${failed} proxy stop attempt failed.` : `Force closed session ${result.session.transactionId}.`);
      await Promise.all([loadChargingSessions(selectedChargerId), loadChargingStats(selectedChargerId), loadActiveSessionAudit(selectedChargerId), loadLogs(selectedChargerId), loadCommunicationJournal(selectedChargerId)]);
    } finally {
      setForceCloseLoading(false);
      setBusy(false);
    }
  }

  function cancelForceClosePreview() {
    setForceClosePreview(null);
    setForceCloseLoading(false);
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
      await Promise.all([loadChargingSessions(selectedChargerId), loadChargingStats(selectedChargerId), loadActiveSessionAudit(selectedChargerId), loadLogs(selectedChargerId)]);
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

  function openCommunicationForFilters(filters: Partial<CommunicationJournalFilters>, chargerId = selectedChargerId) {
    const nextFilters = { ...emptyCommunicationJournalFilters(), chargerId, ...filters };
    setCommunicationFilters(nextFilters);
    setSelectedChargerId(chargerId);
    setActiveView("Communication");
    window.history.pushState({}, "", buildViewUrl("Communication", chargerId));
    void loadCommunicationJournal(chargerId, nextFilters);
  }

  function openSessionsForCharger(chargerId = selectedChargerId) {
    setSelectedChargerId(chargerId);
    setActiveView("Sessions");
    window.history.pushState({}, "", buildViewUrl("Sessions", chargerId));
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
      await loadTags();
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
      await loadTags();
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
      await loadTags();
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
      await loadTags();
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
      username: target.hasUsername ? "********" : "",
      stationId: target.stationId ?? "",
      enabled: target.enabled,
      mode: target.mode,
      outagePolicy: target.outagePolicy,
      basicAuthPassword: target.hasBasicAuthPassword ? "********" : "",
      hasUsername: target.hasUsername,
      hasBasicAuthPassword: target.hasBasicAuthPassword,
      usernameDirty: false,
      basicAuthPasswordDirty: false,
      tagMappings: target.tagMappings?.map((mapping) => ({ ...mapping })) ?? [],
      tagMappingsDirty: false
    });
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
        if (proxyTargetForm.usernameDirty) {
          body.username = proxyTargetForm.username.trim() ? proxyTargetForm.username.trim() : null;
        }

        body.stationId = proxyTargetForm.stationId.trim() ? proxyTargetForm.stationId.trim() : null;

        if (proxyTargetForm.basicAuthPasswordDirty) {
          body.basicAuthPassword = proxyTargetForm.basicAuthPassword.trim() ? proxyTargetForm.basicAuthPassword.trim() : null;
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
      <AuthPage
        username={username}
        password={password}
        message={message}
        busy={busy}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onSubmit={login}
      />
    );
  }

  return (
    <AppChrome
      activeView={activeView}
      busy={busy}
      chargers={chargers}
      message={message}
      selectedChargerId={selectedChargerId}
      selectedChargerLabel={selectedChargerLabel}
      sidebarCollapsed={sidebarCollapsed}
      theme={theme}
      liveStatus={liveStatus}
      onLogout={() => void logout()}
      onOpenChargerWizard={() => void openChargerWizard()}
      onNavigate={navigateToView}
      onSelectedChargerChange={setSelectedChargerId}
      onSidebarCollapsedChange={setSidebarCollapsed}
      onThemeToggle={toggleTheme}
    >
        {activeView === "Home" ? (
          <GlobalDashboardView
            activeSessionAudit={activeSessionAudit}
            busy={busy}
            chargers={chargers}
            chargingSessions={chargingSessions}
            chargingStats={chargingStats}
            chargingStatsStatus={chargingStatsStatus}
            onOpenCommunication={(filters, chargerId) => openCommunicationForFilters(filters, chargerId)}
            onOpenSessions={openSessionsForCharger}
            onNavigate={navigateToView}
            onRefresh={() => void loadScopedData("")}
            onSelectCharger={setSelectedChargerId}
          />
        ) : activeView === "Charger dashboard" ? (
          <DashboardView
            activeSessionAudit={activeSessionAudit}
            busy={busy}
            chargingStats={chargingStats}
            chargingStatsStatus={chargingStatsStatus}
            dashboardConfig={dashboardConfig}
            proxyTargetHealth={proxyTargetHealth}
            sessionSummary={sessionSummary}
            selectedChargerId={selectedChargerId}
            selectedChargerLabel={selectedChargerLabel}
            selectedConnectionStatus={selectedConnectionStatus}
            selectedConnectionTone={selectedConnectionTone}
            onOpenCommunication={(filters) => openCommunicationForFilters(filters)}
            onOpenSessions={() => openSessionsForCharger(selectedChargerId)}
            onNavigate={navigateToView}
            onRefresh={() => void loadScopedData(selectedChargerId)}
          />
        ) : activeView === "Chargers" ? (
          <ChargersView
            busy={busy}
            chargers={chargers}
            onDelete={(charger) => void startChargerDelete(charger)}
            onEditLabel={(charger) => void startChargerLabelEdit(charger)}
            onRefresh={() => void loadChargers()}
          />
        ) : activeView === "Sessions" ? (
          <SessionsView
            activeSessionAudit={activeSessionAudit}
            busy={busy}
            chargingSessions={chargingSessions}
            chargingStats={chargingStats}
            selectedChargerLabel={selectedChargerLabel}
            onForceClose={(session) => void previewForceCloseChargingSession(session)}
            onRefresh={() => void loadScopedData(selectedChargerId)}
            onRemoteStop={(session) => void remoteStopChargingSession(session)}
          />
        ) : activeView === "Communication" ? (
          <CommunicationView
            busy={busy}
            communicationFilters={communicationFilters}
            communicationJournal={communicationJournal}
            communicationRetentionHours={communicationRetentionHours}
            expandedCommunicationJournalId={expandedCommunicationJournalId}
            proxyTargets={proxyTargets}
            selectedChargerId={selectedChargerId}
            selectedChargerLabel={selectedChargerLabel}
            onApplyFilters={applyCommunicationFilters}
            onCommunicationFiltersChange={setCommunicationFilters}
            onExpandedCommunicationJournalIdChange={setExpandedCommunicationJournalId}
            onPurge={() => void purgeCommunicationJournal()}
            onRefresh={() => void loadScopedData(selectedChargerId)}
            onRenderEndpoint={renderCommunicationEndpoint}
            onResetFilters={() => void resetCommunicationFilters()}
          />
        ) : activeView === "Tags" ? (
          <>
            <TagsView
              busy={busy}
              tags={tags}
              onCreateTag={startTagCreate}
              onDeleteTag={(tag) => void deleteTag(tag)}
              onEditTag={startTagEdit}
              onToggleTag={(tag) => void toggleTag(tag)}
            />

            {tagModalOpen ? (
              <div className="modal-backdrop" role="presentation">
                <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="tag-modal-title">
                  <div className="topbar-actions page-section-header">
                    <div>
                      <p className="eyebrow">Allowlist</p>
                      <h2 id="tag-modal-title">{isEditingTag ? "Edit tag" : "Add tag"}</h2>
                      <p className="status-copy">This tag can be granted to chargers from the Tag access page.</p>
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
        ) : activeView === "Tag access" ? (
          <TagAccessView
            busy={busy}
            selectedChargerId={selectedChargerId}
            selectedChargerLabel={selectedChargerLabel}
            tags={tags}
            onRefresh={() => void loadTags()}
            onToggleAccess={(tag) => void toggleTagAccess(tag)}
          />
        ) : (
          <section className="proxy-target-layout">
            <section className="panel table-panel">
                <div className="topbar-actions page-section-header">
                  <div>
                  <p className="eyebrow">Routing</p>
                  <h2>Configured targets</h2>
                  <p className="status-copy">Targets are listed for the selected charger context.</p>
                  </div>
                  <Button
                    type="button"
                    className="button-secondary icon-button"
                    onClick={startProxyTargetCreate}
                    disabled={busy || !selectedChargerId}
                    title="Add target"
                    aria-label="Add target"
                  >
                    <Plus aria-hidden="true" />
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
                              <div className="action-row compact-action-row">
                                <Button
                                  type="button"
                                  className="button-secondary icon-button"
                                  onClick={() => startProxyTargetEdit(target)}
                                  disabled={busy}
                                  title="Edit proxy target"
                                  aria-label="Edit"
                                >
                                  <Pencil aria-hidden="true" />
                                </Button>
                                <Button
                                  type="button"
                                  className="icon-button"
                                  onClick={() => void toggleProxyTarget(target)}
                                  disabled={busy}
                                  title={target.enabled ? "Disable proxy target" : "Enable proxy target"}
                                  aria-label={target.enabled ? "Disable proxy target" : "Enable proxy target"}
                                >
                                  {target.enabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
                                </Button>
                                <Button
                                  type="button"
                                  className="button-ghost icon-button"
                                  onClick={() => void deleteProxyTarget(target)}
                                  disabled={busy}
                                  title="Delete proxy target"
                                  aria-label="Delete"
                                >
                                  <Trash2 aria-hidden="true" />
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
                  <form className="modal-section-form" onSubmit={submitProxyTarget}>
                    <section className="modal-form-section">
                      <div>
                        <h3>Connection</h3>
                      </div>
                      <div className="form-grid modal-form-grid">
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
                        </label>
                        <label className="field">
                          <span>Station ID</span>
                          <input
                            aria-label="Station ID"
                            value={proxyTargetForm.stationId}
                            onChange={(event) => setProxyTargetForm((current) => ({ ...current, stationId: event.target.value }))}
                            placeholder="Defaults to charger ID"
                          />
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
                      </div>
                    </section>

                    <section className="modal-form-section">
                      <div>
                        <h3>Credentials</h3>
                      </div>
                      <div className="form-grid modal-form-grid">
                        <label className="field">
                          <span>Username</span>
                          <input
                            value={proxyTargetForm.username}
                            onChange={(event) =>
                              setProxyTargetForm((current) => ({
                                ...current,
                                username: event.target.value,
                                usernameDirty: true
                              }))
                            }
                            placeholder="Optional"
                          />
                        </label>
                        <label className="field">
                          <span>Password</span>
                          <input
                            value={proxyTargetForm.basicAuthPassword}
                            onChange={(event) =>
                              setProxyTargetForm((current) => ({
                                ...current,
                                basicAuthPassword: event.target.value,
                                basicAuthPasswordDirty: true
                              }))
                            }
                            type="password"
                            placeholder="Optional"
                          />
                        </label>
                      </div>
                    </section>

                    <section className="modal-form-section">
                      <div>
                        <h3>Behavior</h3>
                      </div>
                      <div className="form-grid modal-form-grid">
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
                      </div>
                    </section>

                    <section className="tag-mapping-editor">
                      <div className="topbar-actions page-section-header">
                        <div>
                          <p className="eyebrow">Tag mapping</p>
                          <h3>Proxy authentication</h3>
                          <p className="status-copy">Replace local idTags only for this upstream proxy.</p>
                        </div>
                        <Button
                          type="button"
                          className="button-secondary icon-button"
                          onClick={addProxyTagMapping}
                          disabled={busy}
                          title="Add tag mapping"
                          aria-label="Add mapping"
                        >
                          <Plus aria-hidden="true" />
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
      <ForceClosePreviewModal
        busy={busy}
        forceCloseLoading={forceCloseLoading}
        forceClosePreview={forceClosePreview}
        onCancel={cancelForceClosePreview}
        onExecute={() => void executeForceCloseChargingSession()}
      />
      <ChargerLabelModal
        busy={busy}
        charger={chargerLabelTarget}
        label={chargerLabelValue}
        onCancel={cancelChargerLabelEdit}
        onLabelChange={setChargerLabelValue}
        onSubmit={() => void submitChargerLabelEdit()}
      />
      <ChargerDeleteModal
        adminPassword={chargerDeleteAdminPassword}
        busy={busy}
        charger={chargerDeleteTarget}
        confirmation={chargerDeleteConfirmation}
        onAdminPasswordChange={setChargerDeleteAdminPassword}
        onCancel={cancelChargerDelete}
        onConfirmationChange={setChargerDeleteConfirmation}
        onSubmit={() => void submitChargerDelete()}
      />
      {chargerWizardOpen ? (
        <ChargerOnboardingModal
          busy={busy}
          dashboardConfig={dashboardConfig}
          detectedCharger={chargerWizardDetectedCharger}
          knownChargerCount={chargerWizardKnownIds.length}
          label={chargerWizardLabel}
          startedAt={chargerWizardStartedAt}
          onClose={closeChargerWizard}
          onCopyUrl={() => void copyChargerWizardUrl()}
          onFinish={() => void finishChargerWizard()}
          onLabelChange={setChargerWizardLabel}
          onRefresh={() => void loadChargers()}
        />
      ) : null}
    </AppChrome>
  );
}
