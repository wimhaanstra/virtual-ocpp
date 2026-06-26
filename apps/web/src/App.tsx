import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  X
} from "lucide-react";
import { Button } from "./components/ui/button";
import { fetchAdminJson as fetchAdminJsonRequest, readErrorResponse } from "./api/client";
import {
  changeChargerConfiguration as changeChargerConfigurationRequest,
  getChargerConfiguration as getChargerConfigurationRequest,
  triggerChargerMessage as triggerChargerMessageRequest
} from "./api/charger-commands";
import { AppChrome } from "./components/AppChrome";
import { AuthPage } from "./components/AuthPage";
import { ChargerOnboardingModal } from "./components/ChargerOnboardingModal";
import { CommunicationPurgeModal } from "./components/CommunicationPurgeModal";
import { CommunicationView } from "./components/CommunicationView";
import { DashboardView } from "./components/DashboardView";
import { DiagnosticsView } from "./components/DiagnosticsView";
import { ForceClosePreviewModal } from "./components/ForceClosePreviewModal";
import { GlobalDashboardView } from "./components/GlobalDashboardView";
import { ProxyStopRecoveryModal } from "./components/ProxyStopRecoveryModal";
import { ProxyTargetsView } from "./components/ProxyTargetsView";
import { RemoteStopConfirmModal } from "./components/RemoteStopConfirmModal";
import { SettingsView } from "./components/SettingsView";
import { TagAccessView } from "./components/TagAccessView";
import { ChargerDeleteModal } from "./components/ChargerDeleteModal";
import { ChargerContextSwitcher } from "./components/ChargerContextSwitcher";
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
  CommunicationSettings,
  CommunicationJournalFilters,
  CommunicationJournalItem,
  CommunicationJournalResponse,
  CommunicationJournalStorageSummary,
  DashboardConfig,
  ForceClosePreview,
  LiveStatus,
  LiveUpdateEnvelope,
  LiveUpdateEvent,
  LogEntry,
  MeterGapEvent,
  MeterGapEventsResponse,
  MeterGapRecoveryPreview,
  MeterGapRecoverySubmitResponse,
  OnboardingSettings,
  OnboardingSettingsStatus,
  ProxyHealthResponse,
  ProxyStopRecoveryPreview,
  ProxyStopRecoverySuggestion,
  ProxyTagMapping,
  ProxyTarget,
  ProxyTargetFormState,
  SessionSummary,
  Tag,
  TagFormState,
  TimeFormatPreference,
  ThemeMode
} from "./types";
import {
  buildCommunicationJournalQuery,
  buildCommunicationJournalExportQuery,
  buildCommunicationViewUrl,
  buildProxyTargetConnectionUrl,
  buildViewUrl,
  emptyCommunicationJournalFilters,
  emptyProxyTargetForm,
  emptyTagForm,
  getChargerContextId,
  getChargerDisplayLabel,
  getInitialSidebarCollapsed,
  getInitialTheme,
  getInitialTimeFormat,
  getCommunicationFiltersFromSearch,
  getSearchParam,
  getTagAccessForCharger,
  getViewFromPath,
  getProxyTargetUpstreamIdentity,
  proxyUrlIncludesStationId,
  setTimeFormatPreference,
  setStoredPreference,
  sortChargers,
  withChargerContext
} from "./app-helpers";

type LiveRefreshTopic =
  | "chargers"
  | "sessions"
  | "charging-stats"
  | "logs"
  | "communication"
  | "proxy-targets"
  | "proxy-health"
  | "tags";

type ChargerWizardMode = "add-charger" | "manual-onboarding" | "first-run-onboarding";
type OnboardingTagMode = "skip" | "existing" | "create";
const MAX_ENABLED_PROXY_TARGETS_PER_CHARGER = 3;
const chargerScopedViews = new Set<ActiveView>(["Charger dashboard", "Diagnostics", "Sessions", "Proxy targets", "Tag access"]);
type OnboardingProxyDraft = {
  enabled: boolean;
  name: string;
  url: string;
  username: string;
  basicAuthPassword: string;
  stationId: string;
  mode: ProxyTarget["mode"];
  outagePolicy: ProxyTarget["outagePolicy"];
};

const emptyOnboardingProxyDraft = (): OnboardingProxyDraft => ({
  enabled: false,
  name: "",
  url: "",
  username: "",
  basicAuthPassword: "",
  stationId: "",
  mode: "monitor-only",
  outagePolicy: "fail-open"
});

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
  const [meterGapEvents, setMeterGapEvents] = useState<MeterGapEvent[]>([]);
  const [proxyHealth, setProxyHealth] = useState<ProxyHealthResponse | null>(null);
  const [activeSessionAudit, setActiveSessionAudit] = useState<ActiveSessionAuditResponse | null>(null);
  const [chargingStatsStatus, setChargingStatsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [forceClosePreview, setForceClosePreview] = useState<ForceClosePreview | null>(null);
  const [forceCloseLoading, setForceCloseLoading] = useState(false);
  const [proxyStopRecoverySession, setProxyStopRecoverySession] = useState<ChargingSession | null>(null);
  const [proxyStopRecoveryTargetId, setProxyStopRecoveryTargetId] = useState("");
  const [proxyStopRecoveryExternalId, setProxyStopRecoveryExternalId] = useState("");
  const [proxyStopRecoveryPreview, setProxyStopRecoveryPreview] = useState<ProxyStopRecoveryPreview | null>(null);
  const [proxyStopRecoverySuggestion, setProxyStopRecoverySuggestion] = useState<ProxyStopRecoverySuggestion | null>(null);
  const [proxyStopRecoveryLoading, setProxyStopRecoveryLoading] = useState(false);
  const [meterGapSubmitPreview, setMeterGapSubmitPreview] = useState<MeterGapRecoveryPreview | null>(null);
  const [meterGapSubmitStartAt, setMeterGapSubmitStartAt] = useState("");
  const [meterGapSubmitStopAt, setMeterGapSubmitStopAt] = useState("");
  const [meterGapSubmitLoading, setMeterGapSubmitLoading] = useState(false);
  const [meterGapSubmitResult, setMeterGapSubmitResult] = useState<MeterGapRecoverySubmitResponse | null>(null);
  const [remoteStopTarget, setRemoteStopTarget] = useState<ChargingSession | null>(null);
  const [chargerLabelTarget, setChargerLabelTarget] = useState<ChargerRegistryRow | null>(null);
  const [chargerLabelValue, setChargerLabelValue] = useState("");
  const [chargerDeleteTarget, setChargerDeleteTarget] = useState<ChargerRegistryRow | null>(null);
  const [chargerDeleteAdminPassword, setChargerDeleteAdminPassword] = useState("");
  const [chargerDeleteConfirmation, setChargerDeleteConfirmation] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [communicationJournal, setCommunicationJournal] = useState<CommunicationJournalItem[]>([]);
  const [communicationRetentionHours, setCommunicationRetentionHours] = useState<number | null>(null);
  const [communicationStorage, setCommunicationStorage] = useState<CommunicationJournalStorageSummary | null>(null);
  const [communicationFilters, setCommunicationFilters] = useState<CommunicationJournalFilters>(() => getCommunicationFiltersFromSearch());
  const [communicationNextCursor, setCommunicationNextCursor] = useState<string | null>(null);
  const [communicationHasMore, setCommunicationHasMore] = useState(false);
  const [communicationLoadingMore, setCommunicationLoadingMore] = useState(false);
  const [expandedCommunicationJournalId, setExpandedCommunicationJournalId] = useState<string | null>(null);
  const [communicationPurgeOpen, setCommunicationPurgeOpen] = useState(false);
  const [communicationPurgeScope, setCommunicationPurgeScope] = useState<"retention" | "filters">("retention");
  const [communicationPurgeConfirmation, setCommunicationPurgeConfirmation] = useState("");
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig | null>(null);
  const [onboardingSettings, setOnboardingSettings] = useState<OnboardingSettings | null>(null);
  const [onboardingSettingsStatus, setOnboardingSettingsStatus] = useState<OnboardingSettingsStatus>("idle");
  const [communicationSettings, setCommunicationSettings] = useState<CommunicationSettings | null>(null);
  const [communicationSettingsStatus, setCommunicationSettingsStatus] = useState<OnboardingSettingsStatus>("idle");
  const [tagForm, setTagForm] = useState<TagFormState>(() => emptyTagForm());
  const [proxyTargetForm, setProxyTargetForm] = useState<ProxyTargetFormState>(() => emptyProxyTargetForm());
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [proxyTargetModalOpen, setProxyTargetModalOpen] = useState(false);
  const [chargerWizardOpen, setChargerWizardOpen] = useState(false);
  const [chargerWizardStartedAt, setChargerWizardStartedAt] = useState("");
  const [chargerWizardKnownIds, setChargerWizardKnownIds] = useState<string[]>([]);
  const [chargerWizardLabel, setChargerWizardLabel] = useState("");
  const [chargerWizardLoading, setChargerWizardLoading] = useState(false);
  const [chargerWizardMode, setChargerWizardMode] = useState<ChargerWizardMode>("add-charger");
  const [onboardingTagMode, setOnboardingTagMode] = useState<OnboardingTagMode>("skip");
  const [onboardingSelectedTagId, setOnboardingSelectedTagId] = useState("");
  const [onboardingTagUuid, setOnboardingTagUuid] = useState("");
  const [onboardingTagLabel, setOnboardingTagLabel] = useState("");
  const [onboardingProxyDraft, setOnboardingProxyDraft] = useState<OnboardingProxyDraft>(() => emptyOnboardingProxyDraft());
  const [selectedChargerId, setSelectedChargerId] = useState(() => getSearchParam("chargerId"));
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [timeFormat, setTimeFormat] = useState<TimeFormatPreference>(() => getInitialTimeFormat());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getInitialSidebarCollapsed());
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [message, setMessage] = useState("Sign in to manage proxy targets.");
  const [busy, setBusy] = useState(false);
  const onboardingSettingsRequestId = useRef(0);
  const communicationSettingsRequestId = useRef(0);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const liveRefreshInFlightRef = useRef(false);
  const pendingLiveRefreshTopicsRef = useRef(new Set<LiveRefreshTopic>());

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
        lastErrorCode: null,
        reconnectFailureCount: 0
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
  const enabledProxyTargetCount = proxyTargets.filter((target) => target.enabled).length;
  const proxyTargetEnabledLimitReached = enabledProxyTargetCount >= MAX_ENABLED_PROXY_TARGETS_PER_CHARGER;
  const proxyTargetFormIdentity = proxyTargetForm.stationId.trim() || selectedChargerId;
  const proxyTargetFormConnectionUrl = buildProxyTargetConnectionUrl(proxyTargetForm.url, proxyTargetFormIdentity);
  const proxyTargetFormHasDuplicatedStationPath = proxyUrlIncludesStationId(proxyTargetForm.url, proxyTargetFormIdentity);
  const meterGapRecoveryReadyTargets = meterGapSubmitPreview?.targets.filter((target) => target.canSubmit) ?? [];
  const meterGapRecoveryBusyTargets = meterGapSubmitPreview?.targets.filter((target) => target.hasActiveTransaction) ?? [];
  const meterGapSubmitDisabledReason =
    !meterGapSubmitPreview
      ? ""
      : meterGapSubmitPreview.targets.length === 0
        ? "No proxy target has recovery submissions enabled."
        : meterGapRecoveryReadyTargets.length === 0 && meterGapRecoveryBusyTargets.length > 0
          ? "Recovery is blocked while the selected proxy target has an active upstream charge transaction."
          : meterGapRecoveryReadyTargets.length === 0
            ? "No recovery-enabled proxy target is currently available."
            : "";

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
      return id;
    }

    const proxyName = formatProxyTargetLabel(id);
    return (
      <span title={id}>
        {proxyName}
      </span>
    );
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.classList.toggle("wa-dark", theme === "dark");
    document.documentElement.classList.toggle("wa-light", theme === "light");
    setStoredPreference("virtual-ocpp-theme", theme);
  }, [theme]);

  useEffect(() => {
    setStoredPreference("virtual-ocpp-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    function handlePopState() {
      const nextView = getViewFromPath();
      setActiveView(nextView);
      setSelectedChargerId(getSearchParam("chargerId"));
      if (nextView === "Communication") {
        setCommunicationFilters(getCommunicationFiltersFromSearch());
      }
      setTagModalOpen(false);
      setProxyTargetModalOpen(false);
      setChargerWizardOpen(false);
      setChargerLabelTarget(null);
      setChargerLabelValue("");
      setChargerDeleteTarget(null);
      setChargerDeleteAdminPassword("");
      setChargerDeleteConfirmation("");
      setRemoteStopTarget(null);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    const nextUrl = activeView === "Communication" ? buildCommunicationViewUrl(selectedChargerId, communicationFilters) : buildViewUrl(activeView, selectedChargerId);
    window.history.replaceState({}, "", nextUrl);
  }, [activeView, selectedChargerId, communicationFilters, authenticated]);

  useEffect(() => {
    if (!authenticated || activeView !== "Communication") return;
    const timeout = window.setTimeout(() => {
      void loadCommunicationJournal(selectedChargerId, communicationFilters, { mode: "replace" });
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [activeView, authenticated, selectedChargerId, communicationFilters]);

  useEffect(() => {
    if (!authenticated || !message) return;

    const timeout = window.setTimeout(() => setMessage(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [authenticated, message]);

  useEffect(() => {
    if (!authenticated || chargers.length === 0 || !chargerScopedViews.has(activeView)) return;
    if (selectedCharger) return;

    const firstCharger = sortChargers(chargers)[0];
    if (firstCharger) {
      setSelectedChargerId(getChargerContextId(firstCharger));
    }
  }, [activeView, authenticated, chargers, selectedCharger]);

  useEffect(() => {
    if (!authenticated) return;
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

    return () => {
      events.close();
      if (liveRefreshTimerRef.current !== null) {
        window.clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
      pendingLiveRefreshTopicsRef.current.clear();
      liveRefreshInFlightRef.current = false;
    };
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
    setChargerWizardMode("add-charger");
    resetOnboardingSetupState();
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
    setChargerWizardMode("add-charger");
    resetOnboardingSetupState();
    setCommunicationJournal([]);
    setCommunicationRetentionHours(null);
    setCommunicationStorage(null);
    setCommunicationNextCursor(null);
    setCommunicationHasMore(false);
    setCommunicationLoadingMore(false);
    setProxyHealth(null);
    setActiveSessionAudit(null);
    setCommunicationFilters(emptyCommunicationJournalFilters());
    setExpandedCommunicationJournalId(null);
    setCommunicationPurgeOpen(false);
    setCommunicationPurgeScope("retention");
    setCommunicationPurgeConfirmation("");
    setChargerLabelTarget(null);
    setChargerLabelValue("");
    setChargerDeleteTarget(null);
    setChargerDeleteAdminPassword("");
    setChargerDeleteConfirmation("");
    setRemoteStopTarget(null);
    setOnboardingSettings(null);
    setOnboardingSettingsStatus("idle");
    setCommunicationSettings(null);
    setCommunicationSettingsStatus("idle");
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
    return fetchAdminJsonRequest<T>(url, handleUnauthorized);
  }

  function eventAppliesToSelectedCharger(event: LiveUpdateEvent) {
    return !selectedChargerId || !event.chargerId || event.chargerId === selectedChargerId;
  }

  function getRefreshTopicsForLiveEvent(event: LiveUpdateEvent): LiveRefreshTopic[] {
    if (event.type === "refresh") {
      return event.topic === "charger" ? ["chargers"] : event.topic ? [event.topic] : ["sessions"];
    }

    if (event.type === "charger.connected" || event.type === "charger.disconnected" || event.type === "charger.updated") {
      return ["chargers", "proxy-health"];
    }

    if (event.type === "session.created" || event.type === "session.stopped") {
      return ["sessions", "charging-stats", "logs"];
    }

    if (event.type === "meter.sample.recorded") {
      return ["charging-stats"];
    }

    if (event.type === "proxy.health.changed") {
      return ["proxy-health"];
    }

    if (event.type === "log.recorded") {
      return ["logs"];
    }

    if (event.type === "journal.purged") {
      return ["communication"];
    }

    return ["sessions"];
  }

  function handleLiveUpdate(event: LiveUpdateEvent) {
    if (event.type === "journal.recorded" && activeView === "Communication") {
      if (communicationEventMatchesFilters(event, communicationFilters, selectedChargerId)) {
        void loadCommunicationJournal(selectedChargerId, communicationFilters, { mode: "prepend" });
      }
      return;
    }

    if (!eventAppliesToSelectedCharger(event)) {
      queueLiveRefresh(["chargers"]);
      return;
    }

    queueLiveRefresh(getRefreshTopicsForLiveEvent(event));
  }

  function queueLiveRefresh(topics: LiveRefreshTopic[]) {
    for (const topic of topics) {
      pendingLiveRefreshTopicsRef.current.add(topic);
    }

    if (liveRefreshTimerRef.current !== null) return;
    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      void flushLiveRefreshes();
    }, 250);
  }

  async function flushLiveRefreshes() {
    if (liveRefreshInFlightRef.current) {
      if (liveRefreshTimerRef.current === null) {
        liveRefreshTimerRef.current = window.setTimeout(() => {
          liveRefreshTimerRef.current = null;
          void flushLiveRefreshes();
        }, 250);
      }
      return;
    }

    const topics = new Set(pendingLiveRefreshTopicsRef.current);
    pendingLiveRefreshTopicsRef.current.clear();
    if (topics.size === 0) return;

    liveRefreshInFlightRef.current = true;
    await Promise.allSettled(buildLiveRefreshTasks(topics));
    liveRefreshInFlightRef.current = false;

    if (pendingLiveRefreshTopicsRef.current.size > 0 && liveRefreshTimerRef.current === null) {
      liveRefreshTimerRef.current = window.setTimeout(() => {
        liveRefreshTimerRef.current = null;
        void flushLiveRefreshes();
      }, 250);
    }
  }

  function buildLiveRefreshTasks(topics: Set<LiveRefreshTopic>) {
    const tasks: Array<Promise<void>> = [];
    const addTask = (task: Promise<unknown>) => tasks.push(task.then(() => undefined));

    if (topics.has("chargers")) addTask(loadChargers());
    if (topics.has("tags")) addTask(loadTags());
    if (topics.has("proxy-targets")) addTask(loadProxyTargets(selectedChargerId));
    if (topics.has("proxy-health")) addTask(loadProxyHealth(selectedChargerId));
    if (topics.has("sessions")) {
      addTask(loadChargingSessions(selectedChargerId));
      addTask(loadSessionSummary(selectedChargerId));
      addTask(loadActiveSessionAudit(selectedChargerId));
      addTask(loadMeterGapEvents(selectedChargerId));
    }
    if (topics.has("charging-stats")) {
      addTask(loadChargingStats(selectedChargerId));
      addTask(loadSessionSummary(selectedChargerId));
    }
    if (topics.has("logs")) addTask(loadLogs(selectedChargerId));
    if (topics.has("communication")) {
      if (activeView === "Communication") {
        addTask(loadCommunicationJournal(selectedChargerId, communicationFilters, { mode: "replace" }));
      }
      addTask(loadCommunicationSettings());
    }

    return tasks;
  }

  async function loadAdminData(chargerId = selectedChargerId) {
    await Promise.all([loadDashboardConfig(), loadChargers(), loadOnboardingSettings({ autoOpen: true }), loadCommunicationSettings()]);
  }

  async function loadScopedData(chargerId = selectedChargerId) {
    await Promise.all([
      loadChargers(),
      loadProxyTargets(chargerId),
      loadProxyHealth(chargerId),
      loadActiveSessionAudit(chargerId),
      loadMeterGapEvents(chargerId),
      loadTags(),
      loadChargingSessions(chargerId),
      loadSessionSummary(chargerId),
      loadChargingStats(chargerId),
      loadLogs(chargerId)
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

  async function getChargerConfiguration(chargerId: string, keys: string[]) {
    setBusy(true);
    try {
      return await getChargerConfigurationRequest(chargerId, keys, handleUnauthorized);
    } finally {
      setBusy(false);
    }
  }

  async function changeChargerConfiguration(chargerId: string, key: string, value: string) {
    setBusy(true);
    try {
      return await changeChargerConfigurationRequest(chargerId, key, value, handleUnauthorized);
    } finally {
      setBusy(false);
    }
  }

  async function triggerChargerMessage(chargerId: string, requestedMessage: string, connectorId: number | null) {
    setBusy(true);
    try {
      return await triggerChargerMessageRequest(chargerId, requestedMessage, connectorId, handleUnauthorized);
    } finally {
      setBusy(false);
    }
  }

  async function loadOnboardingSettings(options: { autoOpen?: boolean } = {}) {
    const requestId = onboardingSettingsRequestId.current + 1;
    onboardingSettingsRequestId.current = requestId;
    setOnboardingSettingsStatus("loading");

    const response = await fetch("/api/settings/onboarding", { credentials: "include" });
    if (handleUnauthorized(response)) return;
    if (requestId !== onboardingSettingsRequestId.current) return;
    if (response.status === 404) {
      setOnboardingSettings(null);
      setOnboardingSettingsStatus("unavailable");
      return;
    }

    if (!response.ok) {
      setOnboardingSettings(null);
      setOnboardingSettingsStatus("error");
      return;
    }

    const data = (await response.json()) as OnboardingSettings;
    setOnboardingSettings(data);
    setOnboardingSettingsStatus("ready");

    if (options.autoOpen && !data.completedAt && !data.skippedAt) {
      void openChargerWizard("first-run-onboarding");
    }
  }

  async function updateOnboardingSettings(action: "completed" | "skipped" | "reset") {
    const requestId = onboardingSettingsRequestId.current + 1;
    onboardingSettingsRequestId.current = requestId;
    const response = await fetch("/api/settings/onboarding", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [action]: true })
    });

    if (handleUnauthorized(response)) return null;
    if (requestId !== onboardingSettingsRequestId.current) return null;
    if (!response.ok) {
      setMessage("Could not update onboarding state.");
      return null;
    }

    const data = (await response.json()) as OnboardingSettings;
    setOnboardingSettings(data);
    setOnboardingSettingsStatus("ready");
    return data;
  }

  async function loadCommunicationSettings() {
    const requestId = communicationSettingsRequestId.current + 1;
    communicationSettingsRequestId.current = requestId;
    setCommunicationSettingsStatus("loading");

    const response = await fetch("/api/settings/communication", { credentials: "include" });
    if (handleUnauthorized(response)) return;
    if (requestId !== communicationSettingsRequestId.current) return;
    if (!response.ok) {
      setCommunicationSettings(null);
      setCommunicationSettingsStatus("error");
      return;
    }

    const data = (await response.json()) as CommunicationSettings;
    setCommunicationSettings(data);
    setCommunicationStorage(data.storage ?? null);
    setCommunicationSettingsStatus("ready");
  }

  async function updateCommunicationRetentionHours(retentionHours: number) {
    setBusy(true);
    const requestId = communicationSettingsRequestId.current + 1;
    communicationSettingsRequestId.current = requestId;
    try {
      const response = await fetch("/api/settings/communication", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionHours })
      });
      if (handleUnauthorized(response)) return;
      if (requestId !== communicationSettingsRequestId.current) return;
      if (!response.ok) {
        setMessage("Could not update communication retention.");
        return;
      }
      const data = (await response.json()) as CommunicationSettings;
      setCommunicationSettings(data);
      setCommunicationSettingsStatus("ready");
      setCommunicationRetentionHours(data.retentionHours);
      setCommunicationStorage(data.storage ?? null);
      setMessage(`Communication retention updated to ${data.retentionHours} hours.`);
    } finally {
      setBusy(false);
    }
  }

  async function purgeExpiredCommunicationJournalFromSettings() {
    setBusy(true);
    setMessage("Purging expired communication rows...");
    try {
      const response = await fetch("/api/communication-journal/purge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "retention" })
      });
      if (handleUnauthorized(response)) return;
      if (!response.ok) {
        setMessage("Could not purge expired communication rows.");
        return;
      }

      const result = (await response.json().catch(() => null)) as { deletedCount?: number; retentionHours?: number } | null;
      if (typeof result?.retentionHours === "number") {
        setCommunicationRetentionHours(result.retentionHours);
      }
      setMessage(
        typeof result?.deletedCount === "number"
          ? `Purged ${result.deletedCount} expired communication row${result.deletedCount === 1 ? "" : "s"}.`
          : "Expired communication rows purged."
      );
      await Promise.all([
        loadCommunicationSettings(),
        activeView === "Communication" ? loadCommunicationJournal(selectedChargerId, communicationFilters, { mode: "replace" }) : Promise.resolve()
      ]);
    } finally {
      setBusy(false);
    }
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

  function resetOnboardingSetupState() {
    setOnboardingTagMode("skip");
    setOnboardingSelectedTagId("");
    setOnboardingTagUuid("");
    setOnboardingTagLabel("");
    setOnboardingProxyDraft(emptyOnboardingProxyDraft());
  }

  async function openChargerWizard(mode: ChargerWizardMode = "add-charger") {
    setChargerWizardLabel("");
    setChargerWizardMode(mode);
    resetOnboardingSetupState();
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
    if (mode !== "add-charger") {
      await loadTags();
    }
    setChargerWizardLoading(false);
    void loadDashboardConfig();
  }

  async function closeChargerWizard() {
    const shouldSkipFirstRun = chargerWizardMode === "first-run-onboarding";
    setChargerWizardOpen(false);
    setChargerWizardLabel("");
    setChargerWizardKnownIds([]);
    setChargerWizardStartedAt("");
    setChargerWizardLoading(false);
    setChargerWizardMode("add-charger");
    resetOnboardingSetupState();
    setMessage("");

    if (shouldSkipFirstRun) {
      const updated = await updateOnboardingSettings("skipped");
      if (updated) {
        setMessage("Onboarding skipped.");
      }
    }
  }

  async function copyChargerWizardUrl(url: string) {
    if (!url) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard not available");
      }
      await navigator.clipboard.writeText(url);
      setMessage("Copied example charger URL.");
    } catch {
      setMessage("Could not copy example charger URL.");
    }
  }

  async function finishChargerWizard() {
    if (!chargerWizardDetectedCharger) return;
    const chargerId = getChargerContextId(chargerWizardDetectedCharger);
    const label = chargerWizardLabel.trim();
    const runsSetupSteps = chargerWizardMode !== "add-charger";

    if (runsSetupSteps) {
      if (onboardingTagMode === "existing" && !onboardingSelectedTagId) {
        setMessage("Select a tag or skip tag setup.");
        return;
      }
      if (onboardingTagMode === "create" && !onboardingTagUuid.trim()) {
        setMessage("Enter a tag ID or skip tag setup.");
        return;
      }
      if (onboardingProxyDraft.enabled && (!onboardingProxyDraft.name.trim() || !onboardingProxyDraft.url.trim())) {
        setMessage("Enter a proxy target name and URL or skip proxy setup.");
        return;
      }
    }

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

      if (runsSetupSteps && !(await applyOnboardingSetup(chargerId))) {
        return;
      }

      await loadChargers();
      const shouldCompleteFirstRun = chargerWizardMode === "first-run-onboarding";
      setChargerWizardOpen(false);
      setChargerWizardLabel("");
      setChargerWizardKnownIds([]);
      setChargerWizardStartedAt("");
      setChargerWizardLoading(false);
      setChargerWizardMode("add-charger");
      resetOnboardingSetupState();
      if (shouldCompleteFirstRun) {
        const updated = await updateOnboardingSettings("completed");
        if (!updated) return;
      }
      setSelectedChargerId(chargerId);
      setActiveView("Charger dashboard");
      setMessage(runsSetupSteps ? "Onboarding setup completed." : label ? `Charger ${label} added.` : `Charger ${chargerId} added.`);
    } finally {
      setBusy(false);
    }
  }

  async function applyOnboardingSetup(chargerId: string) {
    let grantedTagId = onboardingTagMode === "existing" ? onboardingSelectedTagId : "";

    if (onboardingTagMode === "create") {
      const tagBody: Record<string, unknown> = {
        uuid: onboardingTagUuid.trim(),
        enabled: true
      };
      if (onboardingTagLabel.trim()) {
        tagBody.label = onboardingTagLabel.trim();
      }

      const tagResponse = await fetch("/api/tags", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tagBody)
      });

      if (tagResponse.status === 409) {
        setMessage("That tag ID already exists.");
        return false;
      }
      if (handleUnauthorized(tagResponse)) return false;
      if (!tagResponse.ok) {
        setMessage("Could not create onboarding tag.");
        return false;
      }

      const createdTag = (await tagResponse.json()) as Tag;
      grantedTagId = createdTag.id;
    }

    if (grantedTagId) {
      const grantResponse = await fetch(`/api/tags/${grantedTagId}/chargers/${encodeURIComponent(chargerId)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true })
      });

      if (handleUnauthorized(grantResponse)) return false;
      if (!grantResponse.ok) {
        setMessage("Could not grant tag access for the charger.");
        return false;
      }
      await loadTags();
    }

    if (onboardingProxyDraft.enabled) {
      const proxyBody: Record<string, unknown> = {
        chargerId,
        name: onboardingProxyDraft.name.trim(),
        url: onboardingProxyDraft.url.trim(),
        enabled: true,
        mode: onboardingProxyDraft.mode,
        outagePolicy: onboardingProxyDraft.outagePolicy,
        allowRecoverySubmissions: false,
        tagMappings: []
      };

      if (onboardingProxyDraft.username.trim()) {
        proxyBody.username = onboardingProxyDraft.username.trim();
      }
      if (onboardingProxyDraft.basicAuthPassword.trim()) {
        proxyBody.basicAuthPassword = onboardingProxyDraft.basicAuthPassword.trim();
      }
      if (onboardingProxyDraft.stationId.trim()) {
        proxyBody.stationId = onboardingProxyDraft.stationId.trim();
      }

      const proxyResponse = await fetch("/api/proxy-targets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proxyBody)
      });

      if (handleUnauthorized(proxyResponse)) return false;
      if (!proxyResponse.ok) {
        setMessage("Could not create onboarding proxy target.");
        return false;
      }
      await loadProxyTargets(chargerId);
    }

    return true;
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

  async function loadMeterGapEvents(chargerId = selectedChargerId) {
    const data = await fetchAdminJson<MeterGapEventsResponse>(withChargerContext("/api/meter-gap-events?status=pending", chargerId));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load meter gap events.");
      return;
    }
    setMeterGapEvents(data.items);
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

  async function scanMeterGaps(chargerId = selectedChargerId) {
    if (!chargerId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/chargers/${encodeURIComponent(chargerId)}/meter-gaps/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({})
      });
      if (!response.ok) {
        setMessage("Could not scan meter gaps.");
        return;
      }

      const result = (await response.json()) as { created: number; existing: number; ignored: number };
      setMessage(
        result.created > 0
          ? `Detected ${result.created} meter gap${result.created === 1 ? "" : "s"}.`
          : "No new meter gaps detected."
      );
      await Promise.all([loadMeterGapEvents(chargerId), loadChargingSessions(chargerId), loadSessionSummary(chargerId)]);
    } finally {
      setBusy(false);
    }
  }

  async function dismissMeterGap(event: MeterGapEvent) {
    setBusy(true);
    try {
      const response = await fetch(`/api/meter-gap-events/${event.id}/dismiss`, {
        method: "POST",
        credentials: "include"
      });
      if (!response.ok) {
        setMessage("Could not dismiss meter gap.");
        return;
      }
      setMessage("Meter gap dismissed.");
      await loadMeterGapEvents(event.chargerId);
    } finally {
      setBusy(false);
    }
  }

  async function openMeterGapSubmit(event: MeterGapEvent) {
    setBusy(true);
    setMeterGapSubmitLoading(true);
    try {
      const previewResponse = await fetch(`/api/meter-gap-events/${event.id}/recovery-preview`, { credentials: "include" });
      if (!previewResponse.ok) {
        setMessage("Could not prepare meter gap submission.");
        return;
      }
      const preview = (await previewResponse.json()) as MeterGapRecoveryPreview;
      setMeterGapSubmitPreview(preview);
      setMeterGapSubmitStartAt(preview.startAt);
      setMeterGapSubmitStopAt(preview.stopAt);
      setMeterGapSubmitResult(null);
      if (preview.targets.filter((target) => target.canSubmit).length === 0) {
        setMessage(preview.targets.length === 0 ? "No proxy targets are enabled for meter-gap recovery." : "All recovery-enabled proxy targets are busy.");
      }
    } finally {
      setMeterGapSubmitLoading(false);
      setBusy(false);
    }
  }

  function cancelMeterGapSubmit() {
    setMeterGapSubmitPreview(null);
    setMeterGapSubmitStartAt("");
    setMeterGapSubmitStopAt("");
    setMeterGapSubmitLoading(false);
    setMeterGapSubmitResult(null);
  }

  async function submitMeterGapRecovery() {
    if (!meterGapSubmitPreview) return;

    setBusy(true);
    setMeterGapSubmitLoading(true);
    try {
      const response = await fetch(`/api/meter-gap-events/${meterGapSubmitPreview.event.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ startAt: meterGapSubmitStartAt, stopAt: meterGapSubmitStopAt })
      });
      if (!response.ok) {
        setMessage("Could not submit meter gap recovery.");
        return;
      }
      const result = (await response.json()) as MeterGapRecoverySubmitResponse;
      setMeterGapSubmitResult(result);
      await loadMeterGapEvents(meterGapSubmitPreview.event.chargerId);
      if (result.status === "submitted") {
        setMessage("Meter gap recovery submitted.");
        cancelMeterGapSubmit();
      } else {
        setMessage("Meter gap recovery needs review.");
      }
    } finally {
      setMeterGapSubmitLoading(false);
      setBusy(false);
    }
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

  function startProxyStopRecovery(session: ChargingSession) {
    const firstEnabledTarget = proxyTargets.find((target) => target.enabled) ?? proxyTargets[0] ?? null;
    setProxyStopRecoverySession(session);
    setProxyStopRecoveryTargetId(firstEnabledTarget?.id ?? "");
    setProxyStopRecoveryExternalId("");
    setProxyStopRecoveryPreview(null);
    setProxyStopRecoverySuggestion(null);
    if (firstEnabledTarget) {
      void loadProxyStopRecoverySuggestion(session, firstEnabledTarget.id);
    }
  }

  function cancelProxyStopRecovery() {
    setProxyStopRecoverySession(null);
    setProxyStopRecoveryTargetId("");
    setProxyStopRecoveryExternalId("");
    setProxyStopRecoveryPreview(null);
    setProxyStopRecoverySuggestion(null);
    setProxyStopRecoveryLoading(false);
  }

  async function loadProxyStopRecoverySuggestion(session: ChargingSession, proxyTargetId: string) {
    if (!proxyTargetId) return;

    setProxyStopRecoveryLoading(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}/proxy-stop-recovery-suggestion`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyTargetId })
      });

      if (handleUnauthorized(response) || !response.ok) return;

      const suggestion = (await response.json()) as ProxyStopRecoverySuggestion;
      setProxyStopRecoverySuggestion(suggestion);
      if (typeof suggestion.predictedExternalTransactionId === "number") {
        setProxyStopRecoveryExternalId(String(suggestion.predictedExternalTransactionId));
      }
    } finally {
      setProxyStopRecoveryLoading(false);
    }
  }

  async function previewProxyStopRecovery() {
    if (!proxyStopRecoverySession) return;

    setBusy(true);
    setProxyStopRecoveryLoading(true);
    setMessage(`Preparing proxy stop recovery for session ${proxyStopRecoverySession.transactionId}...`);
    try {
      const response = await fetch(`/api/sessions/${proxyStopRecoverySession.id}/proxy-stop-recovery-preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxyTargetId: proxyStopRecoveryTargetId,
          externalTransactionId: Number(proxyStopRecoveryExternalId)
        })
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not prepare proxy stop recovery preview.");
        return;
      }

      const preview = (await response.json()) as ProxyStopRecoveryPreview;
      setProxyStopRecoveryPreview(preview);
      setMessage(`Review proxy StopTransaction for external transaction ${preview.externalTransactionId}.`);
    } finally {
      setProxyStopRecoveryLoading(false);
      setBusy(false);
    }
  }

  async function submitProxyStopRecovery() {
    if (!proxyStopRecoverySession || !proxyStopRecoveryPreview) return;

    setBusy(true);
    setProxyStopRecoveryLoading(true);
    setMessage(`Sending proxy StopTransaction ${proxyStopRecoveryPreview.externalTransactionId}...`);
    try {
      const response = await fetch(`/api/sessions/${proxyStopRecoverySession.id}/proxy-stop-recovery`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxyTargetId: proxyStopRecoveryPreview.proxyTarget.id,
          externalTransactionId: proxyStopRecoveryPreview.externalTransactionId
        })
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage(response.status === 409 ? "Session is still active; use force close first." : "Could not send proxy stop recovery.");
        return;
      }

      const result = (await response.json()) as ProxyStopRecoveryPreview;
      cancelProxyStopRecovery();
      setMessage(result.result?.ok ? `Proxy stop sent for external transaction ${result.externalTransactionId}.` : `Proxy stop recovery failed for external transaction ${result.externalTransactionId}.`);
      await Promise.all([loadChargingSessions(selectedChargerId), loadLogs(selectedChargerId), loadCommunicationJournal(selectedChargerId)]);
    } finally {
      setProxyStopRecoveryLoading(false);
      setBusy(false);
    }
  }

  function startRemoteStopChargingSession(session: ChargingSession) {
    setRemoteStopTarget(session);
  }

  function cancelRemoteStopChargingSession() {
    setRemoteStopTarget(null);
  }

  async function remoteStopChargingSession() {
    if (!remoteStopTarget) return;

    setBusy(true);
    setMessage(`Requesting remote stop for session ${remoteStopTarget.transactionId}...`);
    try {
      const response = await fetch(`/api/sessions/${remoteStopTarget.id}/remote-stop`, {
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
      setMessage(result?.status === "Accepted" ? `Remote stop accepted for session ${remoteStopTarget.transactionId}.` : `Remote stop returned ${result?.status ?? "Unknown"}.`);
      setRemoteStopTarget(null);
      await Promise.all([loadChargingSessions(selectedChargerId), loadChargingStats(selectedChargerId), loadActiveSessionAudit(selectedChargerId), loadLogs(selectedChargerId), loadCommunicationJournal(selectedChargerId)]);
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

  async function loadCommunicationJournal(
    chargerId = selectedChargerId,
    filters = communicationFilters,
    options: { mode?: "replace" | "append" | "prepend"; cursor?: string } = {}
  ) {
    const mode = options.mode ?? "replace";
    const data = await fetchAdminJson<CommunicationJournalResponse>(buildCommunicationJournalQuery(filters, chargerId, options.cursor ?? ""));
    if (data === null) return;
    if (data === undefined) {
      setMessage("Could not load communication journal.");
      return;
    }
    setCommunicationJournal((current) => {
      if (mode === "append") {
        return mergeCommunicationRows(current, data.items);
      }
      if (mode === "prepend") {
        return mergeCommunicationRows(data.items, current);
      }
      return data.items;
    });
    setCommunicationRetentionHours(data.retentionHours);
    setCommunicationStorage(data.storage ?? null);
    setCommunicationNextCursor(data.nextCursor);
    setCommunicationHasMore(data.hasMore);
    if (mode === "replace") {
      setExpandedCommunicationJournalId(null);
    }
  }

  async function loadMoreCommunicationJournal() {
    if (!communicationNextCursor || communicationLoadingMore) return;
    setCommunicationLoadingMore(true);
    try {
      await loadCommunicationJournal(selectedChargerId, communicationFilters, { mode: "append", cursor: communicationNextCursor });
    } finally {
      setCommunicationLoadingMore(false);
    }
  }

  function exportCommunicationJournal() {
    const href = buildCommunicationJournalExportQuery(communicationFilters, selectedChargerId);
    const link = document.createElement("a");
    link.href = href;
    link.download = "communication-journal.csv";
    document.body.append(link);
    link.click();
    link.remove();
  }

  function openCommunicationPurge() {
    setCommunicationPurgeScope("retention");
    setCommunicationPurgeConfirmation("");
    setCommunicationPurgeOpen(true);
  }

  async function purgeCommunicationJournal() {
    setBusy(true);
    setMessage("Purging communication journal...");
    try {
      const body =
        communicationPurgeScope === "filters"
          ? JSON.stringify({
              scope: "filters",
              confirm: communicationPurgeConfirmation.trim(),
              filters: buildCommunicationPurgeFilters(communicationFilters, selectedChargerId)
            })
          : JSON.stringify({ scope: "retention" });
      const response = await fetch("/api/communication-journal/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "include"
      });

      if (handleUnauthorized(response)) return;

      if (!response.ok) {
        setMessage("Could not purge communication journal.");
        return;
      }

      const result = (await response.json().catch(() => null)) as { deletedCount?: number; retentionHours?: number; scope?: string } | null;
      if (typeof result?.retentionHours === "number") {
        setCommunicationRetentionHours(result.retentionHours);
      }

      setCommunicationPurgeOpen(false);
      setCommunicationPurgeConfirmation("");
      setMessage(
        typeof result?.deletedCount === "number"
          ? `Purged ${result.deletedCount} communication row${result.deletedCount === 1 ? "" : "s"}${result.scope === "filters" ? " matching current filters" : ""}.`
          : "Communication journal purged."
      );
      await Promise.all([loadCommunicationSettings(), loadCommunicationJournal(selectedChargerId, communicationFilters, { mode: "replace" })]);
    } finally {
      setBusy(false);
    }
  }

  async function resetCommunicationFilters() {
    const nextFilters = emptyCommunicationJournalFilters();
    updateCommunicationFilters(nextFilters);
  }

  function updateCommunicationFilters(nextFilters: CommunicationJournalFilters) {
    setCommunicationFilters(nextFilters);
    if (activeView === "Communication") {
      window.history.pushState({}, "", buildCommunicationViewUrl(selectedChargerId, nextFilters));
    }
  }

  function openCommunicationForFilters(filters: Partial<CommunicationJournalFilters>, chargerId = selectedChargerId) {
    const nextFilters = { ...emptyCommunicationJournalFilters(), chargerId, ...filters };
    setCommunicationFilters(nextFilters);
    setSelectedChargerId(chargerId);
    setActiveView("Communication");
    window.history.pushState({}, "", buildCommunicationViewUrl(chargerId, nextFilters));
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

  function updateTimeFormat(value: TimeFormatPreference) {
    setTimeFormat(value);
    setTimeFormatPreference(value);
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
    setProxyTargetForm({
      ...emptyProxyTargetForm(),
      enabled: !proxyTargetEnabledLimitReached
    });
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
      allowRecoverySubmissions: target.allowRecoverySubmissions,
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
        outagePolicy: proxyTargetForm.outagePolicy,
        allowRecoverySubmissions: proxyTargetForm.allowRecoverySubmissions
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
        const error = await readErrorResponse(response);
        setMessage(error === "proxy_target_limit_exceeded" ? `A charger can have at most ${MAX_ENABLED_PROXY_TARGETS_PER_CHARGER} enabled proxy targets.` : "Could not save proxy target.");
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
    if (!target.enabled && proxyTargetEnabledLimitReached) {
      setMessage(`A charger can have at most ${MAX_ENABLED_PROXY_TARGETS_PER_CHARGER} enabled proxy targets.`);
      return;
    }

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
        const error = await readErrorResponse(response);
        setMessage(error === "proxy_target_limit_exceeded" ? `A charger can have at most ${MAX_ENABLED_PROXY_TARGETS_PER_CHARGER} enabled proxy targets.` : "Could not update proxy target.");
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
      appVersion={dashboardConfig?.appVersion ?? null}
      busy={busy}
      message={message}
      sidebarCollapsed={sidebarCollapsed}
      theme={theme}
      liveStatus={liveStatus}
      onLogout={() => void logout()}
      onNavigate={navigateToView}
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
            meterGapEvents={meterGapEvents}
            onOpenCommunication={(filters, chargerId) => openCommunicationForFilters(filters, chargerId)}
            onOpenSessions={openSessionsForCharger}
            onNavigate={navigateToView}
            onSelectCharger={setSelectedChargerId}
          />
        ) : activeView === "Charger dashboard" ? (
          <DashboardView
            chargingStats={chargingStats}
            chargingStatsStatus={chargingStatsStatus}
            proxyTargetHealth={proxyTargetHealth}
            selectedChargerId={selectedChargerId}
            onOpenCommunication={(filters) => openCommunicationForFilters(filters)}
            onOpenSessions={() => openSessionsForCharger(selectedChargerId)}
            onNavigate={navigateToView}
          />
        ) : activeView === "Diagnostics" ? (
          <>
            <ChargerContextSwitcher
              chargers={chargers}
              selectedChargerId={selectedChargerId}
              selectedChargerLabel={selectedChargerLabel}
              status={selectedConnectionStatus}
              statusTone={selectedConnectionTone}
              onSelectCharger={setSelectedChargerId}
            />
            <DiagnosticsView
              activeSessionAudit={activeSessionAudit}
              busy={busy}
              meterGapEvents={meterGapEvents}
              selectedChargerId={selectedChargerId}
              selectedChargerLabel={selectedChargerLabel}
              onChangeConfiguration={(chargerId, key, value) => changeChargerConfiguration(chargerId, key, value)}
              onDismissMeterGap={(event) => void dismissMeterGap(event)}
              onGetConfiguration={(chargerId, keys) => getChargerConfiguration(chargerId, keys)}
              onOpenSessions={() => openSessionsForCharger(selectedChargerId)}
              onScanMeterGaps={() => void scanMeterGaps(selectedChargerId)}
              onSubmitMeterGap={(event) => void openMeterGapSubmit(event)}
              onTriggerMessage={(chargerId, requestedMessage, connectorId) => triggerChargerMessage(chargerId, requestedMessage, connectorId)}
            />
          </>
        ) : activeView === "Chargers" ? (
          <ChargersView
            busy={busy}
            chargers={chargers}
            onAddCharger={() => void openChargerWizard("add-charger")}
            onDelete={(charger) => void startChargerDelete(charger)}
            onEditLabel={(charger) => void startChargerLabelEdit(charger)}
            onRefresh={() => void loadChargers()}
          />
        ) : activeView === "Settings" ? (
          <SettingsView
            busy={busy}
            communicationSettings={communicationSettings}
            communicationSettingsStatus={communicationSettingsStatus}
            onboardingSettings={onboardingSettings}
            onboardingSettingsStatus={onboardingSettingsStatus}
            timeFormat={timeFormat}
            onCommunicationRetentionChange={(value) => void updateCommunicationRetentionHours(value)}
            onPurgeExpiredCommunication={() => void purgeExpiredCommunicationJournalFromSettings()}
            onRefreshCommunicationSettings={() => void loadCommunicationSettings()}
            onRefreshOnboarding={() => void loadOnboardingSettings()}
            onRunOnboarding={() => void openChargerWizard("manual-onboarding")}
            onTimeFormatChange={updateTimeFormat}
          />
        ) : activeView === "Sessions" ? (
          <SessionsView
            activeSessionAudit={activeSessionAudit}
            busy={busy}
            chargingSessions={chargingSessions}
            chargingStats={chargingStats}
            onForceClose={(session) => void previewForceCloseChargingSession(session)}
            onProxyStopRecovery={startProxyStopRecovery}
            onRefresh={() => void loadScopedData(selectedChargerId)}
            onRemoteStop={startRemoteStopChargingSession}
          />
        ) : activeView === "Communication" ? (
          <CommunicationView
            busy={busy}
            communicationFilters={communicationFilters}
            communicationJournal={communicationJournal}
            hasMore={communicationHasMore}
            loadingMore={communicationLoadingMore}
            communicationRetentionHours={communicationRetentionHours}
            communicationStorage={communicationStorage}
            expandedCommunicationJournalId={expandedCommunicationJournalId}
            proxyTargets={proxyTargets}
            selectedChargerId={selectedChargerId}
            selectedChargerLabel={selectedChargerLabel}
            onExport={exportCommunicationJournal}
            onExpandedCommunicationJournalIdChange={setExpandedCommunicationJournalId}
            onLoadMore={() => void loadMoreCommunicationJournal()}
            onPurge={openCommunicationPurge}
            onRefresh={() => void loadCommunicationJournal(selectedChargerId, communicationFilters, { mode: "replace" })}
            onRenderEndpoint={renderCommunicationEndpoint}
            onResetFilters={() => void resetCommunicationFilters()}
            onCommunicationFiltersChange={updateCommunicationFilters}
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
          <>
            <TagAccessView
              busy={busy}
              selectedChargerId={selectedChargerId}
              selectedChargerLabel={selectedChargerLabel}
              tags={tags}
              onToggleAccess={(tag) => void toggleTagAccess(tag)}
            />
          </>
        ) : (
          <>
            <section className="proxy-target-layout">
              <ProxyTargetsView
                busy={busy}
                enabledCount={enabledProxyTargetCount}
                enabledLimit={MAX_ENABLED_PROXY_TARGETS_PER_CHARGER}
                enabledLimitReached={proxyTargetEnabledLimitReached}
                proxyTargets={proxyTargets}
                selectedChargerId={selectedChargerId}
                onAdd={startProxyTargetCreate}
                onDelete={(target) => void deleteProxyTarget(target)}
                onEdit={startProxyTargetEdit}
                onToggle={(target) => void toggleProxyTarget(target)}
              />

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
                            disabled={
                              proxyTargetEnabledLimitReached &&
                              (!isEditingProxyTarget || proxyTargets.find((target) => target.id === proxyTargetForm.id)?.enabled !== true)
                            }
                            type="checkbox"
                          />
                          Enabled
                        </label>
                        <label className="check-row">
                          <input
                            checked={proxyTargetForm.allowRecoverySubmissions}
                            onChange={(event) => setProxyTargetForm((current) => ({ ...current, allowRecoverySubmissions: event.target.checked }))}
                            type="checkbox"
                          />
                          Allow recovery submissions
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
          </>
        )}
      <ForceClosePreviewModal
        busy={busy}
        forceCloseLoading={forceCloseLoading}
        forceClosePreview={forceClosePreview}
        onCancel={cancelForceClosePreview}
        onExecute={() => void executeForceCloseChargingSession()}
      />
      <ProxyStopRecoveryModal
        busy={busy}
        externalTransactionId={proxyStopRecoveryExternalId}
        loading={proxyStopRecoveryLoading}
        preview={proxyStopRecoveryPreview}
        proxyTargetId={proxyStopRecoveryTargetId}
        proxyTargets={proxyTargets}
        session={proxyStopRecoverySession}
        suggestion={proxyStopRecoverySuggestion}
        onCancel={cancelProxyStopRecovery}
        onExternalTransactionIdChange={(value) => {
          setProxyStopRecoveryExternalId(value);
          setProxyStopRecoveryPreview(null);
        }}
        onPreview={() => void previewProxyStopRecovery()}
        onProxyTargetChange={(proxyTargetId) => {
          setProxyStopRecoveryTargetId(proxyTargetId);
          setProxyStopRecoveryExternalId("");
          setProxyStopRecoveryPreview(null);
          setProxyStopRecoverySuggestion(null);
          if (proxyStopRecoverySession) {
            void loadProxyStopRecoverySuggestion(proxyStopRecoverySession, proxyTargetId);
          }
        }}
        onSubmit={() => void submitProxyStopRecovery()}
      />
      {meterGapSubmitPreview ? (
        <div className="modal-backdrop" role="presentation">
          <section className="panel modal-panel modal-panel-wide" role="dialog" aria-modal="true" aria-labelledby="meter-gap-submit-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Recovery replay</p>
                <h2 id="meter-gap-submit-title">Submit meter gap</h2>
                <p className="status-copy">Virtual OCPP will replay one synthetic StartTransaction and StopTransaction to recovery-enabled targets.</p>
              </div>
              <Button type="button" className="button-ghost icon-button" onClick={cancelMeterGapSubmit} disabled={busy} aria-label="Close meter gap recovery modal">
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="modal-section-form">
              <section className="modal-form-section">
                <h3>Replay window</h3>
                <div className="form-grid modal-form-grid">
                  <label className="field">
                    <span>Start time</span>
                    <input value={meterGapSubmitStartAt} onChange={(event) => setMeterGapSubmitStartAt(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Stop time</span>
                    <input value={meterGapSubmitStopAt} onChange={(event) => setMeterGapSubmitStopAt(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Start meter</span>
                    <input readOnly value={`${meterGapSubmitPreview.meterStart} Wh`} />
                  </label>
                  <label className="field">
                    <span>Stop meter</span>
                    <input readOnly value={`${meterGapSubmitPreview.meterStop} Wh`} />
                  </label>
                </div>
                {meterGapSubmitDisabledReason ? (
                  <div className="notice notice-warning">
                    <strong>Submit unavailable</strong>
                    <p>{meterGapSubmitDisabledReason}</p>
                  </div>
                ) : null}
              </section>
              <section className="modal-form-section">
                <h3>Target payload</h3>
                {meterGapSubmitPreview.targets.length > 0 ? (
                  <div className="recovery-preview-grid">
                    {meterGapSubmitPreview.targets.map((target) => (
                    <article className="recovery-preview-target" key={target.proxyTargetId}>
                      <div className="proxy-health-item__header">
                        <div>
                          <strong>{target.proxyTargetName}</strong>
                          <p className="status-copy mono">{target.proxyTargetId}</p>
                        </div>
                        <span className={`pill ${target.canSubmit ? "pill-good" : "pill-warning"}`}>{target.canSubmit ? "Ready" : "Active transaction"}</span>
                      </div>
                      {!target.canSubmit && target.hasActiveTransaction ? (
                        <p className="status-copy">This target already has an active upstream proxy transaction. Finish or close that session before replaying recovery energy.</p>
                      ) : null}
                      <pre>
                        {JSON.stringify(
                          {
                            StartTransaction: target.startTransaction ? { ...target.startTransaction, timestamp: meterGapSubmitStartAt } : null,
                            StopTransaction: target.stopTransaction ? { ...target.stopTransaction, timestamp: meterGapSubmitStopAt } : null
                          },
                          null,
                          2
                        )}
                      </pre>
                    </article>
                    ))}
                  </div>
                ) : (
                  <p className="status-copy">No proxy target has recovery submissions enabled. Enable it on a proxy target before submitting this gap.</p>
                )}
              </section>
              {meterGapSubmitResult ? (
                <section className="modal-form-section">
                  <h3>Submission result</h3>
                  <div className="recovery-result-list">
                    {meterGapSubmitResult.results.map((result) => (
                      <article className="proxy-health-item" key={result.proxyTargetId}>
                        <div className="proxy-health-item__header">
                          <div>
                            <strong>{result.proxyTargetName}</strong>
                            <p className="status-copy">{result.reason ?? (result.ok ? `Transaction ${result.externalTransactionId ?? "-"}` : "Submission failed")}</p>
                          </div>
                          <span className={`pill ${result.ok ? "pill-good" : "pill-warning"}`}>{result.ok ? "Submitted" : result.attempted ? "Failed" : "Skipped"}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="action-row modal-actions">
                <Button type="button" className="button-secondary" onClick={cancelMeterGapSubmit} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void submitMeterGapRecovery()}
                  disabled={
                    busy ||
                    meterGapSubmitLoading ||
                    !meterGapSubmitStartAt ||
                    !meterGapSubmitStopAt ||
                    meterGapRecoveryReadyTargets.length === 0
                  }
                >
                  Submit recovery
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <RemoteStopConfirmModal
        busy={busy}
        session={remoteStopTarget}
        onCancel={cancelRemoteStopChargingSession}
        onConfirm={() => void remoteStopChargingSession()}
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
      {communicationPurgeOpen ? (
        <CommunicationPurgeModal
          busy={busy}
          confirmation={communicationPurgeConfirmation}
          filters={communicationFilters}
          retentionHours={communicationRetentionHours}
          scope={communicationPurgeScope}
          selectedChargerLabel={selectedChargerLabel}
          onCancel={() => setCommunicationPurgeOpen(false)}
          onConfirmationChange={setCommunicationPurgeConfirmation}
          onConfirm={() => void purgeCommunicationJournal()}
          onScopeChange={(scope) => {
            setCommunicationPurgeScope(scope);
            setCommunicationPurgeConfirmation("");
          }}
        />
      ) : null}
      {chargerWizardOpen ? (
        <ChargerOnboardingModal
          busy={busy}
          dashboardConfig={dashboardConfig}
          detectedCharger={chargerWizardDetectedCharger}
          knownChargerCount={chargerWizardKnownIds.length}
          label={chargerWizardLabel}
          proxyDraft={onboardingProxyDraft}
          selectedTagId={onboardingSelectedTagId}
          showSetupSteps={chargerWizardMode !== "add-charger"}
          startedAt={chargerWizardStartedAt}
          tagLabel={onboardingTagLabel}
          tagMode={onboardingTagMode}
          tagUuid={onboardingTagUuid}
          tags={tags}
          onClose={() => void closeChargerWizard()}
          onCopyUrl={(url) => void copyChargerWizardUrl(url)}
          onFinish={() => void finishChargerWizard()}
          onLabelChange={setChargerWizardLabel}
          onProxyDraftChange={(patch) => setOnboardingProxyDraft((current) => ({ ...current, ...patch }))}
          onRefresh={() => void loadChargers()}
          onSelectedTagChange={setOnboardingSelectedTagId}
          onTagDraftChange={(patch) => {
            if (patch.mode) setOnboardingTagMode(patch.mode);
            if (patch.uuid !== undefined) setOnboardingTagUuid(patch.uuid);
            if (patch.label !== undefined) setOnboardingTagLabel(patch.label);
          }}
        />
      ) : null}
    </AppChrome>
  );
}

function buildCommunicationPurgeFilters(filters: CommunicationJournalFilters, chargerId: string) {
  const output: Partial<CommunicationJournalFilters> = {};

  if (chargerId.trim()) {
    output.chargerId = chargerId.trim();
  }

  for (const [key, value] of Object.entries(filters) as Array<[keyof CommunicationJournalFilters, string]>) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (key === "preset" && trimmed === "24h" && !filters.from.trim() && !filters.to.trim()) {
      continue;
    }
    if (trimmed) {
      output[key] = trimmed;
    }
  }

  return output;
}

function mergeCommunicationRows(primary: CommunicationJournalItem[], secondary: CommunicationJournalItem[]) {
  const seen = new Set<string>();
  const merged: CommunicationJournalItem[] = [];
  for (const item of [...primary, ...secondary]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

function communicationEventMatchesFilters(event: LiveUpdateEvent, filters: CommunicationJournalFilters, selectedChargerId: string) {
  if (event.type !== "journal.recorded") return false;
  const scopedChargerId = selectedChargerId.trim() || filters.chargerId.trim();
  if (scopedChargerId && event.chargerId !== scopedChargerId) return false;
  if (filters.sourceType.trim() && event.sourceType !== filters.sourceType.trim()) return false;
  if (filters.sourceId.trim() && event.sourceId !== filters.sourceId.trim()) return false;
  if (filters.targetType.trim() && event.targetType !== filters.targetType.trim()) return false;
  if (filters.targetId.trim() && event.targetId !== filters.targetId.trim()) return false;
  if (filters.proxyTargetId.trim() && event.proxyTargetId !== filters.proxyTargetId.trim()) return false;
  if (filters.messageType.trim() && event.messageType !== filters.messageType.trim()) return false;
  if (filters.ocppMethod.trim() && !String(event.ocppMethod ?? "").toLowerCase().includes(filters.ocppMethod.trim().toLowerCase())) return false;
  if (filters.transactionId.trim() && String(event.transactionId ?? "") !== filters.transactionId.trim()) return false;
  if (!event.createdAt) return true;

  const createdAt = new Date(event.createdAt).getTime();
  if (Number.isNaN(createdAt)) return true;
  const range = getCommunicationTimeRange(filters);
  if (range.from && createdAt < range.from.getTime()) return false;
  if (range.to && createdAt > range.to.getTime()) return false;
  return true;
}

function getCommunicationTimeRange(filters: CommunicationJournalFilters) {
  const from = parseFilterDate(filters.from);
  const to = parseFilterDate(filters.to);
  if (from || to || filters.preset === "custom") {
    return { from, to };
  }

  const presetMs: Record<string, number> = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000
  };
  const windowMs = presetMs[filters.preset] ?? presetMs["24h"];
  return { from: new Date(Date.now() - windowMs), to: new Date() };
}

function parseFilterDate(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
