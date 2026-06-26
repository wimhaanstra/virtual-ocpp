import { ArrowRight, BatteryCharging, Gauge, MessagesSquare, TriangleAlert } from "lucide-react";
import type { ActiveSessionAuditResponse, ActiveView, ChargerRegistryRow, ChargingSession, ChargingStats, CommunicationJournalFilters, MeterGapEvent } from "../types";
import {
  formatDateTime,
  formatDuration,
  formatEnergyWh,
  formatPowerW,
  getChargerConnectionLabel,
  getChargerConnectionTone,
  getChargerContextId,
  getChargerDisplayLabel,
  sortChargers
} from "../app-helpers";
import { Button } from "./ui/button";

type GlobalDashboardViewProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  chargers: ChargerRegistryRow[];
  chargingSessions: ChargingSession[];
  chargingStats: ChargingStats[];
  chargingStatsStatus: "idle" | "loading" | "ready" | "error";
  meterGapEvents: MeterGapEvent[];
  onOpenCommunication: (filters: Partial<CommunicationJournalFilters>, chargerId: string) => void;
  onOpenSessions: (chargerId: string) => void;
  onNavigate: (view: ActiveView) => void;
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
  meterGapEvents,
  onOpenCommunication,
  onOpenSessions,
  onNavigate,
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
          <strong>{flaggedSessions.length + meterGapEvents.length}</strong>
        </article>
      </section>

      <section className="global-dashboard-main">
        <section className="overview-section overview-runtime-section">
          <div className="dashboard-section-header">
            <div>
              <p className="eyebrow">Chargers</p>
              <h2>Runtime status</h2>
            </div>
            <div className="dashboard-section-header__actions">
              <Button type="button" className="button-secondary overview-section-action" onClick={() => onNavigate("Chargers")}>
                Manage
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
          {orderedChargers.length === 0 ? (
            <p>No chargers have connected yet.</p>
          ) : (
            <div className="record-list registry-list runtime-status-list">
              {orderedChargers.map((charger) => {
                const chargerId = getChargerContextId(charger);
                const sessions = getActiveSessions(chargerId, chargingSessions);
                const stats = getLatestChargingStats(chargerId, chargingStats);
                const warning = charger.connectionWarning?.message;

                return (
                  <article className="record-card registry-card runtime-status-card" key={charger.id}>
                    <div className="runtime-status-card__header">
                      <div>
                        <div className="record-card__title">{getChargerDisplayLabel(charger)}</div>
                        <div className="record-card__subtitle mono">{chargerId}</div>
                      </div>
                      <div className="runtime-status-card__controls">
                        <span
                          className={`pill overview-status-pill ${getChargerConnectionTone(charger)}`}
                          title={warning || undefined}
                          aria-label={warning ? `${getChargerConnectionLabel(charger)}: ${warning}` : getChargerConnectionLabel(charger)}
                        >
                          {getChargerConnectionLabel(charger)}
                        </span>
                        <div className="action-row compact-action-row runtime-status-card__actions">
                          <Button
                            type="button"
                            className="button-secondary icon-button overview-icon-action"
                            onClick={() => onOpenCommunication({ sourceType: "charger", sourceId: chargerId }, chargerId)}
                            title="Show charger communication"
                            aria-label={`Show communication for ${chargerId}`}
                          >
                            <MessagesSquare aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            className="button-secondary icon-button overview-icon-action"
                            onClick={() => {
                              onSelectCharger(chargerId);
                              onNavigate("Charger dashboard");
                            }}
                            title="Open charger dashboard"
                            aria-label="Open charger dashboard"
                          >
                            <ArrowRight aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <dl className="overview-stat-grid">
                      <div
                        className="overview-stat-chip-clickable"
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenSessions(chargerId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpenSessions(chargerId);
                          }
                        }}
                      >
                        <dt>Active</dt>
                        <dd>{sessions.length}</dd>
                      </div>
                      <div>
                        <dt>Live charge</dt>
                        <dd>{stats ? `${formatPowerW(stats.latestPowerW)} · ${formatEnergyWh(stats.energyUsedWh)}` : "Idle"}</dd>
                      </div>
                      <div>
                        <dt>Last seen</dt>
                        <dd>{formatDateTime(charger.lastSeenAt ?? charger.connectedAt ?? charger.updatedAt ?? null)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="overview-section global-active-sessions">
          <div className="dashboard-section-header">
            <div>
              <p className="eyebrow">Charging</p>
              <h2>Active sessions</h2>
            </div>
            <div className="dashboard-section-header__actions">
              <Button type="button" className="button-secondary overview-section-action" onClick={() => onNavigate("Sessions")}>
                Sessions
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
          {activeSessions.length === 0 ? (
            <p>No active sessions.</p>
          ) : (
            <div className="global-session-list">
              {activeSessions.map((session) => {
                const stats = chargingStats.find((entry) => entry.sessionId === session.id) ?? null;

                return (
                  <article key={session.id}>
                    <div className="global-session-card__body">
                      <strong>Transaction {session.transactionId}</strong>
                      <p className="status-copy">
                        {session.chargerId} · connector {session.connectorId} · {formatDuration(Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000))}
                      </p>
                    </div>
                    <div className="global-session-actions">
                      <span>{stats ? `${formatPowerW(stats.latestPowerW)} · ${formatEnergyWh(stats.energyUsedWh)}` : formatEnergyWh(session.stopMeterWh)}</span>
                      <div className="action-row compact-action-row">
                        <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={() => onOpenSessions(session.chargerId)} title="Open sessions" aria-label={`Open sessions for ${session.chargerId}`}>
                          <ArrowRight aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
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
