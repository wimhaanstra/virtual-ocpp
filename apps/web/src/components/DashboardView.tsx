import { useState } from "react";
import { ArrowRight, CheckCircle2, Gauge, Info, MessageSquareText, RefreshCcw, X } from "lucide-react";
import { Button } from "./ui/button";
import type {
  ActiveSessionAuditResponse,
  ActiveView,
  ChargingStats,
  CommunicationJournalFilters,
  DashboardConfig,
  MeterGapEvent,
  ProxyHealthTarget,
  ProxyTarget,
  SessionSummary
} from "../types";
import { formatDateTime, formatDecimalUnit, formatDuration, formatEnergyWh, formatPowerW, formatProxyHealthState, proxyHealthTone } from "../app-helpers";

type ProxyTargetHealthEntry = {
  target: ProxyTarget | undefined;
  health: ProxyHealthTarget;
  connectionUrl: string;
};

type DashboardViewProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  chargingStats: ChargingStats[];
  chargingStatsStatus: "idle" | "loading" | "ready" | "error";
  dashboardConfig: DashboardConfig | null;
  meterGapEvents: MeterGapEvent[];
  proxyTargetHealth: ProxyTargetHealthEntry[];
  sessionSummary: SessionSummary | null;
  selectedChargerId: string;
  selectedChargerLabel: string;
  onNavigate: (view: ActiveView) => void;
  onOpenCommunication: (filters: Partial<CommunicationJournalFilters>) => void;
  onOpenSessions: () => void;
  onRefresh: () => void;
  onDismissMeterGap: (event: MeterGapEvent) => void;
  onScanMeterGaps: () => void;
  onSubmitMeterGap: (event: MeterGapEvent) => void;
};

export function DashboardView({
  activeSessionAudit,
  busy,
  chargingStats,
  chargingStatsStatus,
  dashboardConfig,
  meterGapEvents,
  proxyTargetHealth,
  sessionSummary,
  selectedChargerId,
  selectedChargerLabel,
  onNavigate,
  onOpenCommunication,
  onOpenSessions,
  onRefresh,
  onDismissMeterGap,
  onScanMeterGaps,
  onSubmitMeterGap
}: DashboardViewProps) {
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const primaryActiveSession = chargingStats[0] ?? null;
  const primarySessionAwaitingMeterValues = primaryActiveSession?.latestSampleAt === null;
  const activeSessionCount = selectedChargerId ? (sessionSummary?.activeSessions ?? chargingStats.length) : 0;
  const hasFailingProxy = proxyTargetHealth.some(({ health }) => health.state === "backoff" || health.state === "disconnected");

  return (
    <section className="home-stack">
      <section className="charger-dashboard-hero" aria-label="Charger summary">
        <div className="charger-dashboard-hero__header">
          <div>
            <p className="eyebrow">Selected charger</p>
            <h2>{selectedChargerLabel}</h2>
            <p className="status-copy mono">{selectedChargerId || "Select a charger context"}</p>
          </div>
          <div className="topbar-actions">
            <Button
              type="button"
              className="button-secondary icon-button"
              onClick={() => setConnectionDialogOpen(true)}
              disabled={!selectedChargerId}
              title="Show OCPP connection info"
              aria-label="Show OCPP connection info"
            >
              <Info aria-hidden="true" />
            </Button>
            <Button
              type="button"
              className="button-secondary icon-button"
              onClick={onRefresh}
              disabled={busy}
              title="Refresh dashboard"
              aria-label="Refresh dashboard"
            >
              <RefreshCcw aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="charger-dashboard-metrics">
          <article>
            <span>Total sessions</span>
            <strong>{sessionSummary ? sessionSummary.totalSessions : "-"}</strong>
          </article>
          <article>
            <span>Total energy</span>
            <strong>{formatEnergyWh(sessionSummary?.totalEnergyWh ?? null)}</strong>
          </article>
          <article>
            <span>Last session</span>
            <strong>{formatEnergyWh(sessionSummary?.lastSession?.energyWh ?? null)}</strong>
          </article>
          <article>
            <span>Session active</span>
            <strong>{activeSessionCount > 0 ? "Yes" : "No"}</strong>
          </article>
          <article>
            <span>Proxy health</span>
            <strong>{hasFailingProxy ? "Review" : `${proxyTargetHealth.filter(({ health }) => health.connected).length}/${proxyTargetHealth.length}`}</strong>
          </article>
        </div>
      </section>

      {connectionDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="charger-connection-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Selected charger</p>
                <h2 id="charger-connection-title">OCPP connection</h2>
                <p className="status-copy mono">{selectedChargerId}</p>
              </div>
              <Button type="button" className="button-ghost icon-button" onClick={() => setConnectionDialogOpen(false)} aria-label="Close OCPP connection info">
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="charger-connection-details">
              <div>
                <p className="eyebrow">OCPP URL</p>
                <p className="mono connection-url">{dashboardConfig?.ocppWebSocketUrl ?? "Loading connection URL..."}</p>
              </div>
              <div>
                <p className="eyebrow">Protocol</p>
                <p className="mono">{dashboardConfig?.ocppProtocol ?? "ocpp1.6"}</p>
              </div>
              <div>
                <p className="eyebrow">Authentication</p>
                <p>{dashboardConfig?.ocppBasicAuthRequired ? `Basic Auth: ${dashboardConfig.ocppBasicAuthUsername ?? "charger id"}` : "No charger Basic Auth"}</p>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <section className="panel home-panel">
        <section className="charging-stats-panel charging-stats-panel-standalone" aria-label="Live charging stats">
            <div className="current-state__header">
              <div>
                <p className="eyebrow">Live charging</p>
                <h3>
                  {chargingStatsStatus === "error"
                    ? "Stats unavailable"
                    : chargingStats.length > 1
                      ? `${chargingStats.length} active sessions`
                      : primaryActiveSession
                        ? primarySessionAwaitingMeterValues
                          ? "Charging"
                          : `Transaction ${primaryActiveSession.transactionId}`
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
                    <div className="charging-session-card__header">
                      {chargingStats.length > 1 ? (
                        <p className="mono charging-session-card__title">
                          {stats.chargerId} / tx {stats.transactionId}
                        </p>
                      ) : null}
                      <span className={`pill ${stats.latestSampleAt === null ? "pill-warning" : "pill-good"}`}>Charging</span>
                    </div>
                    <div className="charging-session-summary">
                      <div>
                        <span>Transaction</span>
                        <strong>{stats.transactionId}</strong>
                      </div>
                      <div>
                        <span>Tag</span>
                        <strong>{stats.idTag ?? "None"}</strong>
                      </div>
                      <div>
                        <span>Start meter</span>
                        <strong>{formatEnergyWh(stats.startMeterWh)}</strong>
                      </div>
                      <div>
                        <span>Status</span>
                        <strong className="charging-session-status">Charging</strong>
                      </div>
                    </div>
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
                      {stats.latestSampleAt === null
                        ? `Charging, waiting for first MeterValues. Started ${formatDuration(stats.elapsedSeconds)} ago on connector ${stats.connectorId}.`
                        : `Charging. Started ${formatDuration(stats.elapsedSeconds)} ago on connector ${stats.connectorId}; last meter sample ${formatDateTime(stats.latestSampleAt)}.`}
                    </p>
                    <div className="action-row compact-action-row">
                      <Button type="button" className="button-secondary icon-button" onClick={onOpenSessions} title="Open session" aria-label={`Open session ${stats.transactionId}`}>
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="status-copy">Start a charging session to see live meter values from OCPP MeterValues.</p>
            )}
        </section>
      </section>

      <section className="panel table-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Proxy health</p>
            <h2>Upstream targets</h2>
          </div>
          <Button type="button" className="button-secondary icon-button" onClick={() => onNavigate("Proxy targets")} title="Proxy targets" aria-label="Proxy targets">
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        {!selectedChargerId ? (
          <p>Select a charger context to view upstream proxy health.</p>
        ) : proxyTargetHealth.length === 0 ? (
          <p>No proxy targets configured for this charger.</p>
        ) : (
          <div className="proxy-health-list">
            {proxyTargetHealth.map(({ target, health, connectionUrl }) => (
              <article className="proxy-health-list-item" key={health.proxyTargetId}>
                <div>
                  <strong>{health.name}</strong>
                  <span className="status-copy">{buildProxyHealthDetail(health)}</span>
                  <span className="status-copy mono">{connectionUrl || health.upstreamIdentity || "No upstream identity"}</span>
                </div>
                <div className="proxy-health-actions">
                  <span className={`pill ${proxyHealthTone(health.state)}`} title={target ? undefined : "Target configuration is not loaded."}>
                    {formatProxyHealthState(health.state)}
                  </span>
                  <Button
                    type="button"
                    className="button-secondary icon-button"
                    onClick={() => onOpenCommunication({ proxyTargetId: health.proxyTargetId })}
                    title="Show proxy communication"
                    aria-label={`Show communication for ${health.name}`}
                  >
                    <MessageSquareText aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel table-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Recovery</p>
            <h2>Meter gaps</h2>
            <p className="status-copy">Possible missed charging between a previous stop meter and a later session start meter.</p>
          </div>
          <Button type="button" className="button-secondary" onClick={onScanMeterGaps} disabled={busy || !selectedChargerId}>
            Scan
            <RefreshCcw aria-hidden="true" />
          </Button>
        </div>
        {meterGapEvents.length > 0 ? (
          <div className="meter-gap-list">
            {meterGapEvents.slice(0, 3).map((event) => (
              <article key={event.id}>
                <div>
                  <strong>{formatEnergyWh(event.deltaWh)} gap</strong>
                  <p className="status-copy">
                    Connector {event.connectorId} · {formatDateTime(event.previousStoppedAt)} to {formatDateTime(event.newStartedAt)}
                  </p>
                </div>
                <div className="action-row compact-action-row">
                  <span className="pill pill-warning">{event.status}</span>
                  <Button
                    type="button"
                    className="button-secondary icon-button"
                    onClick={() => onSubmitMeterGap(event)}
                    disabled={busy}
                    title="Submit recovery"
                    aria-label={`Submit meter gap ${event.id}`}
                  >
                    <CheckCircle2 aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    className="button-ghost icon-button"
                    onClick={() => onDismissMeterGap(event)}
                    disabled={busy}
                    title="Dismiss gap"
                    aria-label={`Dismiss meter gap ${event.id}`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>No pending meter gaps.</p>
        )}
      </section>

      <section className="panel table-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Session audit</p>
            <h2>Missing stop checks</h2>
            <p className="status-copy">Flagged active sessions scoped to {selectedChargerLabel}.</p>
          </div>
          <Button type="button" className="button-secondary" onClick={() => onNavigate("Sessions")}>
            Sessions
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        {!activeSessionAudit || activeSessionAudit.items.filter((item) => item.warnings.length > 0).length === 0 ? (
          <p>No active sessions need attention.</p>
        ) : (
          <div className="session-audit-list">
            {activeSessionAudit.items.filter((item) => item.warnings.length > 0).map((item) => (
              <article className="session-audit-item" key={item.sessionId}>
                <div className="proxy-health-item__header">
                  <div>
                    <h3>Transaction {item.transactionId}</h3>
                    <p className="status-copy">
                      Connector {item.connectorId}
                      {item.latestMeterWh !== null ? `; latest meter ${formatEnergyWh(item.latestMeterWh)}` : ""}
                      {item.latestStatus ? `; status ${item.latestStatus}` : ""}
                    </p>
                  </div>
                  <span className="pill pill-warning">Needs review</span>
                </div>
                <p className="status-copy">{item.warnings[0]?.message}</p>
                <div className="action-row compact-action-row">
                  <Button type="button" className="button-secondary icon-button" onClick={onOpenSessions} title="Open sessions" aria-label={`Open session ${item.transactionId}`}>
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

    </section>

  );
}

function buildProxyHealthDetail(health: ProxyHealthTarget) {
  if (!health.enabled) return "Disabled";

  const details = [health.connected ? "Connected" : formatProxyHealthState(health.state), health.detail];
  if (health.lastFailureAt) {
    details.push(`last failure ${formatDateTime(health.lastFailureAt)}`);
  } else if (health.lastSuccessAt) {
    details.push(`last success ${formatDateTime(health.lastSuccessAt)}`);
  }

  if (health.nextReconnectAt) {
    details.push(`retry ${formatDateTime(health.nextReconnectAt)}`);
  }

  if (health.lastErrorCode) {
    details.push(health.lastErrorCode);
  }

  return details.filter(Boolean).join(" · ");
}
