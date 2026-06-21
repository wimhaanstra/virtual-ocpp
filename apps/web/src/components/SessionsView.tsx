import { Fragment } from "react";
import { Power, PowerOff, RefreshCcw } from "lucide-react";
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
                <th>Transaction</th>
                <th>Tag</th>
                <th>Status</th>
                <th>Live</th>
                <th>Started</th>
                <th>Stopped</th>
                <th>Meter Wh</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {chargingSessions.map((session) => {
                const audit = findAuditForSession(activeSessionAudit, session);
                const liveStats = chargingStats.find((entry) => entry.sessionId === session.id || entry.transactionId === session.transactionId) ?? null;
                return (
                  <Fragment key={session.id}>
                    <tr>
                      <td className="mono">{session.chargerId}</td>
                      <td>{session.connectorId}</td>
                      <td>{session.transactionId}</td>
                      <td className="mono">{session.idTag || "None"}</td>
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
                      <td>{formatDateTime(session.startedAt)}</td>
                      <td>{session.stoppedAt ? formatDateTime(session.stoppedAt) : "Active"}</td>
                      <td>
                        {session.startMeterWh ?? "-"}
                        {" / "}
                        {session.stopMeterWh ?? "-"}
                      </td>
                      <td>{session.stopReason || "-"}</td>
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
                    {audit ? (
                      <tr>
                        <td className="session-audit-row" colSpan={11}>
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
            </tbody>
          </table>
        </div>
      )}
    </section>

  );
}
