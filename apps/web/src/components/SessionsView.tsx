import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Power, PowerOff, RefreshCcw, Send } from "lucide-react";
import type { ActiveSessionAuditResponse, ChargingSession, ChargingStats } from "../types";
import { findAuditForSession, formatDateTime, formatEnergyWh, formatPowerW } from "../app-helpers";
import { Button } from "./ui/button";

type SessionsViewProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  chargingSessions: ChargingSession[];
  chargingStats: ChargingStats[];
  selectedChargerLabel: string;
  onForceClose: (session: ChargingSession) => void;
  onProxyStopRecovery: (session: ChargingSession) => void;
  onRefresh: () => void;
  onRemoteStop: (session: ChargingSession) => void;
};

export function SessionsView({
  activeSessionAudit,
  busy,
  chargingSessions,
  chargingStats,
  selectedChargerLabel,
  onForceClose,
  onProxyStopRecovery,
  onRefresh,
  onRemoteStop
}: SessionsViewProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const groupedSessions = groupSessionsByDate(chargingSessions);

  return (
    <section className="panel table-panel">
      <div className="topbar-actions">
        <div>
          <p className="eyebrow">Charging</p>
          <h2>Recent sessions</h2>
          <p className="status-copy">Scoped to {selectedChargerLabel}.</p>
        </div>
        <Button type="button" className="button-secondary icon-button" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
          <RefreshCcw aria-hidden="true" />
        </Button>
      </div>
      {chargingSessions.length === 0 ? (
        <p>No charging sessions recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="sessions-table">
            <thead>
              <tr>
                <th aria-label="Expand"></th>
                <th>Started</th>
                <th>Ended</th>
                <th>Energy used</th>
                <th>Live</th>
                <th>Status</th>
                <th className="table-actions-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedSessions.map((group) => (
                <Fragment key={group.dateKey}>
                  <tr className="session-date-row">
                    <td colSpan={7}>{group.label}</td>
                  </tr>
                  {group.sessions.map((session) => {
                    const audit = findAuditForSession(activeSessionAudit, session);
                    const liveStats = chargingStats.find((entry) => entry.sessionId === session.id || entry.transactionId === session.transactionId) ?? null;
                    const energyUsedWh = getSessionEnergyUsedWh(session, liveStats);
                    const expanded = expandedSessionId === session.id;
                    return (
                      <Fragment key={session.id}>
                        <tr
                          className="session-row"
                          tabIndex={0}
                          onClick={() => setExpandedSessionId(expanded ? null : session.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setExpandedSessionId(expanded ? null : session.id);
                            }
                          }}
                        >
                          <td>
                            <Button
                              type="button"
                              className="button-secondary icon-button session-expand-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedSessionId(expanded ? null : session.id);
                              }}
                              title={expanded ? "Hide session details" : "Show session details"}
                              aria-label={`${expanded ? "Hide" : "Show"} details for session ${session.transactionId}`}
                            >
                              {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                            </Button>
                          </td>
                          <td>{formatSessionTime(session.startedAt)}</td>
                          <td>{session.stoppedAt ? formatSessionTime(session.stoppedAt) : "Active"}</td>
                          <td>{formatEnergyWh(energyUsedWh)}</td>
                          <td>
                            {session.active && liveStats ? (
                              <span className="session-live-value">
                                {formatPowerW(liveStats.latestPowerW)} · {formatEnergyWh(liveStats.energyUsedWh)}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>
                            <div className="status-stack">
                              <span className={`pill ${session.active ? "pill-good" : "pill-neutral"}`}>
                                {session.status}
                              </span>
                              {audit && audit.warnings.length > 0 ? <span className="pill pill-warning">Missing stop?</span> : null}
                            </div>
                          </td>
                          <td className="table-actions-cell" onClick={(event) => event.stopPropagation()}>
                            <div className="action-row compact-action-row">
                              {session.active ? (
                                <>
                                  <Button
                                    type="button"
                                    className="button-secondary icon-button"
                                    onClick={() => onRemoteStop(session)}
                                    disabled={busy}
                                    title="Remote stop transaction"
                                    aria-label={`Remote stop session ${session.transactionId}`}
                                  >
                                    <Power aria-hidden="true" />
                                  </Button>
                                  <Button
                                    type="button"
                                    className="button-secondary icon-button"
                                    onClick={() => onForceClose(session)}
                                    disabled={busy}
                                    title="Force close with preview"
                                    aria-label={`Force close session ${session.transactionId}`}
                                  >
                                    <PowerOff aria-hidden="true" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  className="button-secondary icon-button"
                                  onClick={() => onProxyStopRecovery(session)}
                                  disabled={busy}
                                  title="Recover proxy stop"
                                  aria-label={`Recover proxy stop for session ${session.transactionId}`}
                                >
                                  <Send aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr>
                            <td className="session-detail-row" colSpan={7}>
                              <div className="session-detail-grid">
                                <span className="session-detail-item">
                                  <span>Charger</span>
                                  <strong className="mono">{session.chargerId}</strong>
                                </span>
                                <span className="session-detail-item">
                                  <span>Connector</span>
                                  <strong>{session.connectorId}</strong>
                                </span>
                                <span className="session-detail-item">
                                  <span>Transaction</span>
                                  <strong>{session.transactionId}</strong>
                                </span>
                                <span className="session-detail-item">
                                  <span>Tag</span>
                                  <strong className="mono">{session.idTag || "None"}</strong>
                                </span>
                                <span className="session-detail-item">
                                  <span>Reason</span>
                                  <strong>{session.stopReason || "-"}</strong>
                                </span>
                                <span className="session-detail-item">
                                  <span>Meter</span>
                                  <strong>{session.startMeterWh ?? "-"} / {session.stopMeterWh ?? "-"}</strong>
                                </span>
                                <span className="session-detail-item">
                                  <span>Started</span>
                                  <strong>{formatDateTime(session.startedAt)}</strong>
                                </span>
                                <span className="session-detail-item">
                                  <span>Ended</span>
                                  <strong>{session.stoppedAt ? formatDateTime(session.stoppedAt) : "Active"}</strong>
                                </span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {audit ? (
                          <tr>
                            <td className="session-audit-row" colSpan={7}>
                              <div className="session-audit-inline">
                                <span>{audit.warnings[0]?.message ?? "No audit warnings."}</span>
                                <span>Latest meter: {formatEnergyWh(audit.latestMeterWh)}</span>
                                <span>Status: {audit.latestStatus ?? "-"}</span>
                                <span>Proxy mappings: {audit.proxyMappings.length}</span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

  );
}

function groupSessionsByDate(sessions: ChargingSession[]) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const groups = new Map<string, { dateKey: string; label: string; sessions: ChargingSession[] }>();

  for (const session of sessions) {
    const date = new Date(session.startedAt);
    const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const existing = groups.get(dateKey);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(dateKey, {
        dateKey,
        label: formatter.format(date),
        sessions: [session]
      });
    }
  }

  return Array.from(groups.values());
}

function formatSessionTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getSessionEnergyUsedWh(session: ChargingSession, liveStats: ChargingStats | null) {
  if (typeof liveStats?.energyUsedWh === "number") return liveStats.energyUsedWh;
  if (typeof session.startMeterWh !== "number") return null;

  if (typeof session.stopMeterWh === "number") {
    return Math.max(0, session.stopMeterWh - session.startMeterWh);
  }

  if (typeof liveStats?.latestMeterWh === "number") {
    return Math.max(0, liveStats.latestMeterWh - session.startMeterWh);
  }

  return null;
}
