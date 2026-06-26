import { ChevronDown, ChevronRight, Power, PowerOff, Send } from "lucide-react";
import type { ActiveSessionAuditResponse, ChargingSession, ChargingStats } from "../types";
import {
  findAuditForSession,
  formatDateTime,
  formatEnergyWh,
  formatPowerW,
  formatTime,
  getMeterSourceLabel
} from "../app-helpers";
import { Button } from "./ui/button";

type SessionListItemProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  expanded: boolean;
  liveStats: ChargingStats | null;
  onForceClose: (session: ChargingSession) => void;
  onProxyStopRecovery: (session: ChargingSession) => void;
  onRemoteStop: (session: ChargingSession) => void;
  onToggleExpanded: () => void;
  session: ChargingSession;
};

export function SessionListItem({
  activeSessionAudit,
  busy,
  expanded,
  liveStats,
  onForceClose,
  onProxyStopRecovery,
  onRemoteStop,
  onToggleExpanded,
  session
}: SessionListItemProps) {
  const audit = findAuditForSession(activeSessionAudit, session);
  const energyUsedWh = getSessionEnergyUsedWh(session, liveStats);
  const meterSource = getSessionMeterSource(session, liveStats);

  return (
    <>
      <tr
        className="session-table-row"
        tabIndex={0}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
      >
        <td className="session-table-cell session-table-cell--expand">
          <Button
            type="button"
            className="button-secondary icon-button overview-icon-action session-expand-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded();
            }}
            title={expanded ? "Hide session details" : "Show session details"}
            aria-label={`${expanded ? "Hide" : "Show"} details for session ${session.transactionId}`}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </td>
        <td>
          <div className="session-table-primary">
            <strong>{formatTime(session.startedAt)}</strong>
            <span>Transaction {session.transactionId}</span>
          </div>
        </td>
        <td>
          <strong>{session.stoppedAt ? formatTime(session.stoppedAt) : "Active"}</strong>
        </td>
        <td title={getMeterSourceLabel(meterSource)}>
          <strong>{formatEnergyWh(energyUsedWh)}</strong>
        </td>
        <td>
          <strong className="session-live-value">
            {session.active && liveStats ? `${formatPowerW(liveStats.latestPowerW)} · ${formatEnergyWh(liveStats.energyUsedWh)}` : "-"}
          </strong>
        </td>
        <td>
          <div className="status-stack session-table-status">
            <span className={`pill overview-status-pill ${session.active ? "pill-good" : "pill-neutral"}`}>{session.status}</span>
            {audit && audit.warnings.length > 0 ? <span className="pill pill-warning">Missing stop?</span> : null}
          </div>
        </td>
        <td className="session-table-cell session-table-cell--actions" onClick={(event) => event.stopPropagation()}>
          <div className="dashboard-item__actions session-table-actions">
            {session.active ? (
              <>
                <Button
                  type="button"
                  className="button-secondary icon-button overview-icon-action"
                  onClick={() => onRemoteStop(session)}
                  disabled={busy}
                  title="Remote stop transaction"
                  aria-label={`Remote stop session ${session.transactionId}`}
                >
                  <Power aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  className="button-secondary icon-button overview-icon-action"
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
                className="button-secondary icon-button overview-icon-action"
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
        <tr className="session-detail-table-row">
          <td colSpan={7}>
            {audit ? (
              <div className="session-audit-row">
                <div className="session-audit-inline">
                  <span>{audit.warnings[0]?.message ?? "No audit warnings."}</span>
                  <span>Latest meter: {formatEnergyWh(audit.latestMeterWh)}</span>
                  <span>Status: {audit.latestStatus ?? "-"}</span>
                  <span>Proxy mappings: {audit.proxyMappings.length}</span>
                </div>
              </div>
            ) : null}
            <div className="session-detail-row">
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
                  <strong>
                    {session.startMeterWh ?? "-"} / {session.stopMeterWh ?? "-"}
                  </strong>
                </span>
                <span className="session-detail-item">
                  <span>Energy source</span>
                  <strong>{getMeterSourceLabel(meterSource)}</strong>
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
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function getSessionEnergyUsedWh(session: ChargingSession, liveStats: ChargingStats | null) {
  if (typeof session.startMeterWh !== "number") return null;

  if (typeof session.stopMeterWh === "number") {
    return Math.max(0, session.stopMeterWh - session.startMeterWh);
  }

  if (typeof liveStats?.energyUsedWh === "number") return liveStats.energyUsedWh;

  if (typeof liveStats?.latestMeterWh === "number") {
    return Math.max(0, liveStats.latestMeterWh - session.startMeterWh);
  }

  return null;
}

function getSessionMeterSource(session: ChargingSession, liveStats: ChargingStats | null) {
  if (typeof session.stopMeterWh === "number" && typeof session.startMeterWh === "number") return "session-stop-meter";
  if (typeof liveStats?.energyUsedWh === "number" || typeof liveStats?.latestMeterWh === "number") return "latest-meter-sample";
  if (typeof session.startMeterWh === "number") return "start-meter";
  return "unknown";
}
