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
        <div className="charging-session-stack">
          {groupedSessions.map((group) => (
            <section key={group.dateKey} aria-label={group.label}>
              <p className="eyebrow">{group.label}</p>
              <div className="charging-session-stack">
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
