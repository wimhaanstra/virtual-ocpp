import { useState } from "react";
import { ArrowRight, BatteryCharging, Gauge, MessagesSquare } from "lucide-react";
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
import { ExpandableDataTable, type ExpandableDataTableColumn } from "./ExpandableDataTable";
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
  const chargerColumns: Array<ExpandableDataTableColumn<ChargerRegistryRow>> = [
    {
      key: "charger",
      header: "Charger",
      render: (charger) => {
        const chargerId = getChargerContextId(charger);
        return (
          <div className="session-table-primary">
            <strong className="table-truncate" title={getChargerDisplayLabel(charger)}>
              {getChargerDisplayLabel(charger)}
            </strong>
            <span className="mono table-truncate" title={chargerId}>
              {chargerId}
            </span>
          </div>
        );
      }
    },
    {
      key: "state",
      header: "State",
      render: (charger) => {
        const label = getChargerConnectionLabel(charger);
        const tone = getChargerConnectionTone(charger);
        const warning = charger.connectionWarning?.message;
        return (
          <span className={`pill overview-status-pill ${tone}`} title={warning || undefined} aria-label={warning ? `${label}: ${warning}` : label}>
            {label}
          </span>
        );
      }
    },
    {
      key: "active",
      header: "Active",
      render: (charger) => {
        const chargerId = getChargerContextId(charger);
        return (
          <button className="overview-cell-link" type="button" onClick={() => onOpenSessions(chargerId)}>
            {getActiveSessions(chargerId, chargingSessions).length}
          </button>
        );
      }
    },
    {
      key: "live-charge",
      header: "Live charge",
      render: (charger) => {
        const stats = getLatestChargingStats(getChargerContextId(charger), chargingStats);
        return stats ? `${formatPowerW(stats.latestPowerW)} · ${formatEnergyWh(stats.energyUsedWh)}` : "Idle";
      }
    },
    {
      key: "last-seen",
      header: "Last seen",
      render: (charger) => formatDateTime(charger.lastSeenAt ?? charger.connectedAt ?? charger.updatedAt ?? null)
    },
    {
      key: "actions",
      headingClassName: "sessions-table__actions-heading",
      headerAriaLabel: "Actions",
      cellClassName: "session-table-cell session-table-cell--actions",
      stopPropagation: true,
      render: (charger) => {
        const chargerId = getChargerContextId(charger);
        return (
          <div className="action-row compact-action-row session-table-actions">
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
        );
      }
    }
  ];
  const activeSessionColumns: Array<ExpandableDataTableColumn<ChargingSession>> = [
    {
      key: "transaction",
      header: "Transaction",
      render: (session) => (
        <div className="session-table-primary">
          <strong>Transaction {session.transactionId}</strong>
          <span>{session.status}</span>
        </div>
      )
    },
    {
      key: "charger",
      header: "Charger",
      render: (session) => (
        <span className="mono table-truncate" title={session.chargerId}>
          {session.chargerId}
        </span>
      )
    },
    {
      key: "connector",
      header: "Connector",
      render: (session) => session.connectorId
    },
    {
      key: "duration",
      header: "Duration",
      render: (session) => formatDuration(Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000))
    },
    {
      key: "energy-power",
      header: "Energy / power",
      render: (session) => {
        const stats = chargingStats.find((entry) => entry.sessionId === session.id) ?? null;
        return stats ? `${formatEnergyWh(stats.energyUsedWh)} · ${formatPowerW(stats.latestPowerW)}` : formatEnergyWh(session.stopMeterWh);
      }
    },
    {
      key: "actions",
      headingClassName: "sessions-table__actions-heading",
      headerAriaLabel: "Actions",
      cellClassName: "session-table-cell session-table-cell--actions",
      stopPropagation: true,
      render: (session) => (
        <div className="action-row compact-action-row session-table-actions">
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={() => onOpenSessions(session.chargerId)} title="Open sessions" aria-label={`Open sessions for ${session.chargerId}`}>
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      )
    }
  ];

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
            <ExpandableDataTable
              columns={chargerColumns}
              expandedRowIds={expandedChargers}
              getRowDetailsLabel={(charger) => `charger ${getChargerContextId(charger)}`}
              getRowId={getChargerContextId}
              onToggleRow={(chargerId) => toggleExpandedCharger(chargerId)}
              renderExpandedRow={(charger) => <GlobalChargerDetails charger={charger} />}
              rows={orderedChargers}
              tableClassName="runtime-status-table"
            />
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
            <ExpandableDataTable
              columns={activeSessionColumns}
              expandedRowIds={expandedSessions}
              getRowDetailsLabel={(session) => `session ${session.transactionId}`}
              getRowId={(session) => session.id}
              onToggleRow={(sessionId) => toggleExpandedSession(sessionId)}
              renderExpandedRow={(session) => <GlobalActiveSessionDetails session={session} stats={chargingStats.find((entry) => entry.sessionId === session.id) ?? null} />}
              rows={activeSessions}
              tableClassName="active-sessions-table"
            />
          )}
        </section>
      </section>
    </section>
  );
}

function GlobalChargerDetails({ charger }: { charger: ChargerRegistryRow }) {
  const chargerId = getChargerContextId(charger);
  const warning = charger.connectionWarning?.message;

  return (
    <>
      {warning ? (
        <div className="session-audit-row overview-warning-row">
          <div className="session-audit-inline">{warning}</div>
        </div>
      ) : null}
      <div className="session-detail-row">
        <div className="session-detail-grid">
          <span className="session-detail-item">
            <span>Charger ID</span>
            <strong className="mono table-truncate" title={chargerId}>
              {chargerId}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Last boot</span>
            <strong>{formatDateTime(charger.lastBootAt ?? null)}</strong>
          </span>
          <span className="session-detail-item">
            <span>Vendor</span>
            <strong className="table-truncate" title={charger.chargePointVendor || "-"}>
              {charger.chargePointVendor || "-"}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Model</span>
            <strong className="table-truncate" title={charger.chargePointModel || "-"}>
              {charger.chargePointModel || "-"}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Firmware</span>
            <strong className="table-truncate" title={charger.firmwareVersion || "-"}>
              {charger.firmwareVersion || "-"}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Updated</span>
            <strong>{formatDateTime(charger.updatedAt ?? null)}</strong>
          </span>
        </div>
      </div>
    </>
  );
}

function GlobalActiveSessionDetails({ session, stats }: { session: ChargingSession; stats: ChargingStats | null }) {
  return (
    <div className="session-detail-row">
      <div className="session-detail-grid">
        <span className="session-detail-item">
          <span>Started</span>
          <strong>{formatDateTime(session.startedAt)}</strong>
        </span>
        <span className="session-detail-item">
          <span>ID tag</span>
          <strong className="mono table-truncate" title={session.idTag ?? "None"}>
            {session.idTag ?? "None"}
          </strong>
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
  );
}
