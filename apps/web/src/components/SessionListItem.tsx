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
    <article
      className="charging-session-card"
      tabIndex={0}
      onClick={onToggleExpanded}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleExpanded();
        }
      }}
    >
      <div className="charging-session-card__header">
        <div>
          <p className="mono charging-session-card__title">Transaction {session.transactionId}</p>
          <p className="status-copy">
            {session.chargerId} · connector {session.connectorId}
          </p>
        </div>
        <div className="action-row compact-action-row">
          <div className="status-stack">
            <span className={`pill ${session.active ? "pill-good" : "pill-neutral"}`}>{session.status}</span>
            {audit && audit.warnings.length > 0 ? <span className="pill pill-warning">Missing stop?</span> : null}
          </div>
          <Button
            type="button"
            className="button-secondary icon-button session-expand-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded();
            }}
            title={expanded ? "Hide session details" : "Show session details"}
            aria-label={`${expanded ? "Hide" : "Show"} details for session ${session.transactionId}`}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <div className="charging-session-summary">
        <div>
          <span>Started</span>
          <strong>{formatTime(session.startedAt)}</strong>
        </div>
        <div>
          <span>Ended</span>
          <strong>{session.stoppedAt ? formatTime(session.stoppedAt) : "Active"}</strong>
        </div>
        <div title={getMeterSourceLabel(meterSource)}>
          <span>Energy used</span>
          <strong>{formatEnergyWh(energyUsedWh)}</strong>
        </div>
        <div>
          <span>Live</span>
          <strong className="charging-session-status session-live-value">
            {session.active && liveStats ? `${formatPowerW(liveStats.latestPowerW)} · ${formatEnergyWh(liveStats.energyUsedWh)}` : "-"}
          </strong>
        </div>
      </div>
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
      {expanded ? (
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
      ) : null}
      <div className="action-row compact-action-row" onClick={(event) => event.stopPropagation()}>
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
    </article>
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
