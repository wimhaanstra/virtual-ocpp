import { ArrowRight, BatteryCharging, Gauge, RefreshCcw, TriangleAlert } from "lucide-react";
import type { ActiveSessionAuditResponse, ActiveView, ChargerRegistryRow, ChargingSession, ChargingStats } from "../types";
import { formatDateTime, formatDuration, formatEnergyWh, formatPowerW, getChargerContextId, getChargerDisplayLabel, sortChargers } from "../app-helpers";
import { Button } from "./ui/button";

type GlobalDashboardViewProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  chargers: ChargerRegistryRow[];
  chargingSessions: ChargingSession[];
  chargingStats: ChargingStats[];
  chargingStatsStatus: "idle" | "loading" | "ready" | "error";
  onNavigate: (view: ActiveView) => void;
  onRefresh: () => void;
  onSelectCharger: (chargerId: string) => void;
};

function getLatestChargingStats(chargerId: string, chargingStats: ChargingStats[]) {
  return chargingStats.find((stats) => stats.chargerId === chargerId) ?? null;
}

function getActiveSessions(chargerId: string, chargingSessions: ChargingSession[]) {
  return chargingSessions.filter((session) => session.active && session.chargerId === chargerId);
}

export function GlobalDashboardView({
  activeSessionAudit,
  busy,
  chargers,
  chargingSessions,
  chargingStats,
  chargingStatsStatus,
  onNavigate,
  onRefresh,
  onSelectCharger
}: GlobalDashboardViewProps) {
  const orderedChargers = sortChargers(chargers);
  const connectedChargers = orderedChargers.filter((charger) => charger.active);
  const activeSessions = chargingSessions.filter((session) => session.active);
  const flaggedSessions = activeSessionAudit?.items.filter((item) => item.warnings.length > 0) ?? [];

  return (
    <section className="global-dashboard">
      <section className="global-dashboard-hero" aria-label="Global charger overview">
        <div>
          <p className="eyebrow">Operator overview</p>
          <h2>Fleet status</h2>
          <p className="status-copy">A compact view of live charger connectivity and active charging across the installation.</p>
        </div>
        <Button type="button" className="button-secondary icon-button" onClick={onRefresh} disabled={busy} title="Refresh dashboard" aria-label="Refresh dashboard">
          <RefreshCcw aria-hidden="true" />
        </Button>
      </section>

      <section className="global-metrics" aria-label="Fleet metrics">
        <article>
          <BatteryCharging aria-hidden="true" />
          <span>Connected chargers</span>
          <strong>
            {connectedChargers.length}/{orderedChargers.length}
          </strong>
        </article>
        <article>
          <Gauge aria-hidden="true" />
          <span>Active sessions</span>
          <strong>{activeSessions.length}</strong>
        </article>
        <article>
          <Gauge aria-hidden="true" />
          <span>Charging now</span>
          <strong>{chargingStatsStatus === "error" ? "-" : chargingStats.length}</strong>
        </article>
        <article>
          <TriangleAlert aria-hidden="true" />
          <span>Needs attention</span>
          <strong>{flaggedSessions.length}</strong>
        </article>
      </section>

      <section className="global-dashboard-main">
        <section className="panel table-panel">
          <div className="topbar-actions page-section-header">
            <div>
              <p className="eyebrow">Chargers</p>
              <h2>Runtime status</h2>
            </div>
            <Button type="button" className="button-secondary" onClick={() => onNavigate("Chargers")}>
              Manage
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          {orderedChargers.length === 0 ? (
            <p>No chargers have connected yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Charger</th>
                    <th>Status</th>
                    <th>Active sessions</th>
                    <th>Live charge</th>
                    <th>Last seen</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {orderedChargers.map((charger) => {
                    const chargerId = getChargerContextId(charger);
                    const sessions = getActiveSessions(chargerId, chargingSessions);
                    const stats = getLatestChargingStats(chargerId, chargingStats);

                    return (
                      <tr key={charger.id}>
                        <td>
                          <strong>{getChargerDisplayLabel(charger)}</strong>
                          <span className="status-copy mono">{chargerId}</span>
                        </td>
                        <td>
                          <span className={`pill ${charger.active ? "pill-good" : "pill-neutral"}`}>
                            {charger.active ? "Connected" : "Disconnected"}
                          </span>
                        </td>
                        <td>{sessions.length}</td>
                        <td>
                          {stats ? (
                            <span>
                              {formatPowerW(stats.latestPowerW)} · {formatEnergyWh(stats.energyUsedWh)}
                            </span>
                          ) : (
                            <span className="status-copy">Idle</span>
                          )}
                        </td>
                        <td>{formatDateTime(charger.lastSeenAt ?? charger.connectedAt ?? charger.updatedAt ?? null)}</td>
                        <td>
                          <Button
                            type="button"
                            className="button-secondary icon-button"
                            onClick={() => {
                              onSelectCharger(chargerId);
                              onNavigate("Charger dashboard");
                            }}
                            title="Open charger dashboard"
                            aria-label="Open charger dashboard"
                          >
                            <ArrowRight aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel table-panel global-active-sessions">
          <div className="topbar-actions page-section-header">
            <div>
              <p className="eyebrow">Charging</p>
              <h2>Active sessions</h2>
            </div>
            <Button type="button" className="button-secondary" onClick={() => onNavigate("Sessions")}>
              Sessions
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
          {activeSessions.length === 0 ? (
            <p>No active sessions.</p>
          ) : (
            <div className="global-session-list">
              {activeSessions.map((session) => {
                const stats = chargingStats.find((entry) => entry.sessionId === session.id) ?? null;

                return (
                  <article key={session.id}>
                    <div>
                      <strong>Transaction {session.transactionId}</strong>
                      <p className="status-copy">
                        {session.chargerId} · connector {session.connectorId} · {formatDuration(Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000))}
                      </p>
                    </div>
                    <span>{stats ? `${formatPowerW(stats.latestPowerW)} · ${formatEnergyWh(stats.energyUsedWh)}` : formatEnergyWh(session.stopMeterWh)}</span>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </section>
  );
}
