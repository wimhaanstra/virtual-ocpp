import { Fragment, useState } from "react";
import { ArrowRight, BatteryCharging, ChevronDown, ChevronRight, Gauge, MessagesSquare } from "lucide-react";
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
  const [expandedChargers, setExpandedChargers] = useState<Set<string>>(new Set());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const orderedChargers = sortChargers(chargers);
  const connectedChargers = orderedChargers.filter((charger) => charger.active);
  const activeSessions = chargingSessions.filter((session) => session.active);

  function toggleExpandedCharger(chargerId: string) {
    setExpandedChargers((current) => {
      const next = new Set(current);
      if (next.has(chargerId)) next.delete(chargerId);
      else next.add(chargerId);
      return next;
    });
  }

  function toggleExpandedSession(sessionId: string) {
    setExpandedSessions((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  return (
    <section className="global-dashboard">

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
            <div className="overview-table-wrap">
              <table className="overview-table runtime-status-table">
                <thead>
                  <tr>
                    <th aria-label="Expand row"></th>
                    <th>Charger</th>
                    <th>State</th>
                    <th>Active</th>
                    <th>Live charge</th>
                    <th>Last seen</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
              {orderedChargers.map((charger) => {
                const chargerId = getChargerContextId(charger);
                const sessions = getActiveSessions(chargerId, chargingSessions);
                const stats = getLatestChargingStats(chargerId, chargingStats);
                const warning = charger.connectionWarning?.message;
                const expanded = expandedChargers.has(chargerId);
                const label = getChargerConnectionLabel(charger);
                const tone = getChargerConnectionTone(charger);

                return (
                  <Fragment key={charger.id}>
                    <tr
                      className="overview-table-row"
                      tabIndex={0}
                      onClick={() => toggleExpandedCharger(chargerId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleExpandedCharger(chargerId);
                        }
                      }}
                    >
                      <td className="overview-table-expander-cell">
                        <Button
                          className="button-secondary icon-button overview-icon-action session-expand-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpandedCharger(chargerId);
                          }}
                          title={expanded ? "Hide charger details" : "Show charger details"}
                          aria-label={`${expanded ? "Hide" : "Show"} details for charger ${chargerId}`}
                        >
                          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                        </Button>
                      </td>
                      <td>
                        <div className="overview-table-primary">{getChargerDisplayLabel(charger)}</div>
                        <div className="overview-table-subtitle overview-table-id mono" title={chargerId}>
                          {chargerId}
                        </div>
                      </td>
                      <td>
                        <span className={`pill overview-status-pill ${tone}`} title={warning || undefined} aria-label={warning ? `${label}: ${warning}` : label}>
                          {label}
                        </span>
                      </td>
                      <td>
                        <button className="overview-cell-link" type="button" onClick={() => onOpenSessions(chargerId)}>
                          {sessions.length}
                        </button>
                      </td>
                      <td>{stats ? `${formatPowerW(stats.latestPowerW)} · ${formatEnergyWh(stats.energyUsedWh)}` : "Idle"}</td>
                      <td>{formatDateTime(charger.lastSeenAt ?? charger.connectedAt ?? charger.updatedAt ?? null)}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="action-row compact-action-row overview-table-actions">
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
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="overview-table-detail-row">
                        <td colSpan={7}>
                          {warning ? (
                            <div className="session-audit-row overview-warning-row">
                              <div className="session-audit-inline">{warning}</div>
                            </div>
                          ) : null}
                          <div className="session-detail-row">
                            <div className="session-detail-grid">
                              <span className="session-detail-item">
                                <span>Charger ID</span>
                                <strong className="overview-table-id mono" title={chargerId}>
                                  {chargerId}
                                </strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Last boot</span>
                                <strong>{formatDateTime(charger.lastBootAt ?? null)}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Vendor</span>
                                <strong>{charger.chargePointVendor || "-"}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Model</span>
                                <strong>{charger.chargePointModel || "-"}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Firmware</span>
                                <strong>{charger.firmwareVersion || "-"}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Updated</span>
                                <strong>{formatDateTime(charger.updatedAt ?? null)}</strong>
                              </span>
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
            <div className="overview-table-wrap">
              <table className="overview-table active-sessions-table">
                <thead>
                  <tr>
                    <th aria-label="Expand row"></th>
                    <th>Transaction</th>
                    <th>Charger</th>
                    <th>Connector</th>
                    <th>Duration</th>
                    <th>Energy / power</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
              {activeSessions.map((session) => {
                const stats = chargingStats.find((entry) => entry.sessionId === session.id) ?? null;
                const expanded = expandedSessions.has(session.id);

                return (
                  <Fragment key={session.id}>
                    <tr
                      className="overview-table-row"
                      tabIndex={0}
                      onClick={() => toggleExpandedSession(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleExpandedSession(session.id);
                        }
                      }}
                    >
                      <td className="overview-table-expander-cell">
                        <Button
                          className="button-secondary icon-button overview-icon-action session-expand-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpandedSession(session.id);
                          }}
                          title={expanded ? "Hide session details" : "Show session details"}
                          aria-label={`${expanded ? "Hide" : "Show"} details for session ${session.transactionId}`}
                        >
                          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                        </Button>
                      </td>
                      <td>
                        <div className="overview-table-primary">Transaction {session.transactionId}</div>
                        <div className="overview-table-subtitle">{session.status}</div>
                      </td>
                      <td>
                        <span className="overview-table-id mono" title={session.chargerId}>
                          {session.chargerId}
                        </span>
                      </td>
                      <td>{session.connectorId}</td>
                      <td>{formatDuration(Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000))}</td>
                      <td>{stats ? `${formatEnergyWh(stats.energyUsedWh)} · ${formatPowerW(stats.latestPowerW)}` : formatEnergyWh(session.stopMeterWh)}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="action-row compact-action-row overview-table-actions">
                          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={() => onOpenSessions(session.chargerId)} title="Open sessions" aria-label={`Open sessions for ${session.chargerId}`}>
                            <ArrowRight aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="overview-table-detail-row">
                        <td colSpan={7}>
                          <div className="session-detail-row">
                            <div className="session-detail-grid">
                              <span className="session-detail-item">
                                <span>Started</span>
                                <strong>{formatDateTime(session.startedAt)}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>ID tag</span>
                                <strong className="mono">{session.idTag ?? "None"}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Meter</span>
                                <strong>{formatEnergyWh(stats?.latestMeterWh ?? session.stopMeterWh)}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Latest sample</span>
                                <strong>{formatDateTime(stats?.latestSampleAt ?? null)}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Association</span>
                                <strong>{stats?.sampleAssociation ?? "-"}</strong>
                              </span>
                              <span className="session-detail-item">
                                <span>Start meter</span>
                                <strong>{formatEnergyWh(session.startMeterWh)}</strong>
                              </span>
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
    </section>
  );
}
