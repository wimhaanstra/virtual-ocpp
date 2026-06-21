import { ArrowRight, Gauge, RefreshCcw } from "lucide-react";
import { Button } from "./ui/button";
import type { ActiveSessionAuditResponse, ActiveView, ChargingStats, DashboardConfig, ProxyHealthTarget, ProxyTarget } from "../types";
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
  proxyTargetHealth: ProxyTargetHealthEntry[];
  selectedChargerId: string;
  selectedChargerLabel: string;
  selectedConnectionStatus: string;
  selectedConnectionTone: string;
  onNavigate: (view: ActiveView) => void;
  onRefresh: () => void;
};

export function DashboardView({
  activeSessionAudit,
  busy,
  chargingStats,
  chargingStatsStatus,
  dashboardConfig,
  proxyTargetHealth,
  selectedChargerId,
  selectedChargerLabel,
  selectedConnectionStatus,
  selectedConnectionTone,
  onNavigate,
  onRefresh
}: DashboardViewProps) {
  return (
    <section className="home-stack">
      <section className="dashboard-grid home-dashboard-grid">
        <section className="panel home-panel">
          <div className="topbar-actions">
            <div>
              <p className="eyebrow">Charging ingress</p>
              <h2>Charger connection</h2>
            </div>
            <span className={`pill ${selectedConnectionTone}`}>{selectedConnectionStatus}</span>
            <Button type="button" className="button-secondary" onClick={onRefresh} disabled={busy}>
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
            <Button type="button" className="button-secondary" onClick={() => onNavigate("Communication")}>
              Communication
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button type="button" className="button-secondary" onClick={() => onNavigate("Sessions")}>
              Sessions
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button type="button" className="button-secondary" onClick={() => onNavigate("Proxy targets")}>
              Proxy targets
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </section>

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
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel table-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Proxy health</p>
            <h2>Upstream targets</h2>
            <p className="status-copy">Scoped to {selectedChargerLabel}.</p>
          </div>
          <Button type="button" className="button-secondary" onClick={() => onNavigate("Proxy targets")}>
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
              <article className="proxy-health-item" key={health.proxyTargetId}>
                <div className="proxy-health-item__header">
                  <div>
                    <h3>{health.name}</h3>
                    <p className="mono">{connectionUrl}</p>
                  </div>
                  <span className={`pill ${proxyHealthTone(health.state)}`}>
                    {formatProxyHealthState(health.state)}
                  </span>
                </div>
                <p className="status-copy">
                  {health.detail}
                  {health.lastSuccessAt ? ` Last success ${formatDateTime(health.lastSuccessAt)}.` : ""}
                  {health.nextReconnectAt ? ` Next retry ${formatDateTime(health.nextReconnectAt)}.` : ""}
                  {!target ? " Target configuration is not loaded." : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>

  );
}
