import { Fragment, useState } from "react";
import { Info, Power, PowerOff, RefreshCcw } from "lucide-react";
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
          <table>
            <thead>
              <tr>
                <th>Charger</th>
                <th>Connector</th>
                <th>Status</th>
                <th>Live</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Energy used</th>
                <th>Details</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedSessions.map((group) => (
                <Fragment key={group.dateKey}>
                  <tr className="session-date-row">
                    <td colSpan={9}>{group.label}</td>
                  </tr>
                  {group.sessions.map((session) => {
                    const audit = findAuditForSession(activeSessionAudit, session);
                    const liveStats = chargingStats.find((entry) => entry.sessionId === session.id || entry.transactionId === session.transactionId) ?? null;
                    const energyUsedWh = getSessionEnergyUsedWh(session, liveStats);
                    const expanded = expandedSessionId === session.id;
                    return (
                      <Fragment key={session.id}>
                        <tr>
                          <td className="mono">{session.chargerId}</td>
                          <td>{session.connectorId}</td>
                          <td>
                            <div className="status-stack">
                              <span className={`pill ${session.active ? "pill-good" : "pill-neutral"}`}>
                                {session.status}
                              </span>
                              {audit && audit.warnings.length > 0 ? <span className="pill pill-warning">Missing stop?</span> : null}
                            </div>
                          </td>
                          <td>
                            {session.active && liveStats ? (
                              <span className="session-live-value">
                                {formatPowerW(liveStats.latestPowerW)} · {formatEnergyWh(liveStats.energyUsedWh)}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{formatSessionTime(session.startedAt)}</td>
                          <td>{session.stoppedAt ? formatSessionTime(session.stoppedAt) : "Active"}</td>
                          <td>{formatEnergyWh(energyUsedWh)}</td>
                          <td>
                            <Button
                              type="button"
                              className="button-secondary icon-button"
                              onClick={() => setExpandedSessionId(expanded ? null : session.id)}
                              title={expanded ? "Hide session details" : "Show session details"}
                              aria-label={`${expanded ? "Hide" : "Show"} details for session ${session.transactionId}`}
                            >
                              <Info aria-hidden="true" />
                            </Button>
                          </td>
                          <td>
                            {session.active ? (
                              <div className="action-row compact-action-row">
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
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr>
                            <td className="session-detail-row" colSpan={9}>
                              <div className="session-detail-grid">
                                <span>Transaction: <strong>{session.transactionId}</strong></span>
                                <span>Tag: <strong className="mono">{session.idTag || "None"}</strong></span>
                                <span>Reason: <strong>{session.stopReason || "-"}</strong></span>
                                <span>Meter: <strong>{session.startMeterWh ?? "-"} / {session.stopMeterWh ?? "-"}</strong></span>
                                <span>Started: <strong>{formatDateTime(session.startedAt)}</strong></span>
                                <span>Ended: <strong>{session.stoppedAt ? formatDateTime(session.stoppedAt) : "Active"}</strong></span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {audit ? (
                          <tr>
                            <td className="session-audit-row" colSpan={9}>
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
    minute: "2-digit"
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
