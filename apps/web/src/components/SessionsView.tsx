import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { ActiveSessionAuditResponse, ChargingSession, ChargingStats } from "../types";
import { Button } from "./ui/button";
import { SessionListItem } from "./SessionListItem";

type SessionsViewProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  chargingSessions: ChargingSession[];
  chargingStats: ChargingStats[];
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
  onForceClose,
  onProxyStopRecovery,
  onRefresh,
  onRemoteStop
}: SessionsViewProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const groupedSessions = groupSessionsByDate(chargingSessions);

  return (
    <section className="sessions-page">
      <div className="dashboard-section-header">
        <div>
          <p className="eyebrow">Charging</p>
          <h2>Recent sessions</h2>
        </div>
        <div className="dashboard-section-header__actions">
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
            <RefreshCcw aria-hidden="true" />
          </Button>
        </div>
      </div>
      {chargingSessions.length === 0 ? (
        <p className="dashboard-empty-state">No charging sessions recorded yet.</p>
      ) : (
        <div className="sessions-date-stack">
          {groupedSessions.map((group) => (
            <section className="sessions-date-group" key={group.dateKey} aria-label={group.label}>
              <div className="sessions-date-group__header">
                <p className="eyebrow">{group.label}</p>
              </div>
              <div className="sessions-table-wrap">
                <table className="sessions-table">
                  <thead>
                    <tr>
                      <th aria-label="Expand session details" />
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Energy used</th>
                      <th>Live</th>
                      <th>Status</th>
                      <th className="sessions-table__actions-heading">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.sessions.map((session) => {
                      const liveStats = chargingStats.find((entry) => entry.sessionId === session.id || entry.transactionId === session.transactionId) ?? null;
                      const expanded = expandedSessionId === session.id;

                      return (
                        <SessionListItem
                          key={session.id}
                          activeSessionAudit={activeSessionAudit}
                          busy={busy}
                          expanded={expanded}
                          liveStats={liveStats}
                          onForceClose={onForceClose}
                          onProxyStopRecovery={onProxyStopRecovery}
                          onRemoteStop={onRemoteStop}
                          onToggleExpanded={() => setExpandedSessionId(expanded ? null : session.id)}
                          session={session}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
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
