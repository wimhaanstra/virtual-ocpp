import { ArrowRight, BatteryCharging, Gauge, MessageSquareText, RefreshCcw, TriangleAlert } from "lucide-react";
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
  meterGapEvents,
  onOpenCommunication,
  onOpenSessions,
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
          <strong>{flaggedSessions.length + meterGapEvents.length}</strong>
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
            <div className="record-list registry-list runtime-status-list">
              {orderedChargers.map((charger) => {
                const chargerId = getChargerContextId(charger);
                const sessions = getActiveSessions(chargerId, chargingSessions);
                const stats = getLatestChargingStats(chargerId, chargingStats);
                const warning = charger.connectionWarning?.message;

                return (
                  <article className="record-card registry-card runtime-status-card" key={charger.id}>
                    <div className="record-card__summary">
                      <div>
                        <div className="record-card__title">{getChargerDisplayLabel(charger)}</div>
                        <div className="record-card__subtitle mono">{chargerId}</div>
                      </div>
                      <span className={`pill ${getChargerConnectionTone(charger)}`}>
                        {getChargerConnectionLabel(charger)}
                      </span>
                    </div>
                    {warning ? <p className="notice notice-warning compact-notice">{warning}</p> : null}
                    <dl className="detail-grid compact-detail-grid">
                      <div>
                        <dt>Active</dt>
                        <dd>
                          <button className="inline-drilldown" type="button" onClick={() => onOpenSessions(chargerId)}>
                            {sessions.length}
                          </button>
                        </dd>
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
                    <div className="record-card__actions">
                      <div className="action-row compact-action-row">
                        <Button
                          type="button"
                          className="button-secondary icon-button"
                          onClick={() => onOpenCommunication({ sourceType: "charger", sourceId: chargerId }, chargerId)}
                          title="Show charger communication"
                          aria-label={`Show communication for ${chargerId}`}
                        >
                          <MessageSquareText aria-hidden="true" />
                        </Button>
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
                      </div>
                    </div>
                  </article>
                );
              })}
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
                    <div className="global-session-actions">
                      <span>{stats ? `${formatPowerW(stats.latestPowerW)} · ${formatEnergyWh(stats.energyUsedWh)}` : formatEnergyWh(session.stopMeterWh)}</span>
                      <div className="action-row compact-action-row">
                        <Button type="button" className="button-secondary icon-button" onClick={() => onOpenSessions(session.chargerId)} title="Open sessions" aria-label={`Open sessions for ${session.chargerId}`}>
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
