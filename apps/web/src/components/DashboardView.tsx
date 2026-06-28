import { useState } from "react";
import { ArrowRight, Gauge, MessageSquareText } from "lucide-react";
import { ExpandableDataTable, type ExpandableDataTableColumn } from "./ExpandableDataTable";
import { Button } from "./ui/button";
import type {
  ActiveView,
  ChargingStats,
  CommunicationJournalFilters,
  ProxyHealthTarget,
  ProxyTarget
} from "../types";
import { formatDateTime, formatDecimalUnit, formatDuration, formatEnergyWh, formatPowerW, formatProxyHealthState, proxyHealthTone } from "../app-helpers";

type ProxyTargetHealthEntry = {
  target: ProxyTarget | undefined;
  health: ProxyHealthTarget;
  connectionUrl: string;
};

type DashboardViewProps = {
  chargingStats: ChargingStats[];
  chargingStatsStatus: "idle" | "loading" | "ready" | "error";
  proxyTargetHealth: ProxyTargetHealthEntry[];
  selectedChargerId: string;
  onNavigate: (view: ActiveView) => void;
  onOpenCommunication: (filters: Partial<CommunicationJournalFilters>) => void;
  onOpenSessions: () => void;
};

export function DashboardView({
  chargingStats,
  chargingStatsStatus,
  proxyTargetHealth,
  selectedChargerId,
  onNavigate,
  onOpenCommunication,
  onOpenSessions
}: DashboardViewProps) {
  const [expandedChargingSessionId, setExpandedChargingSessionId] = useState<string | null>(null);
  const expandedChargingSessionIds = new Set(expandedChargingSessionId ? [expandedChargingSessionId] : []);
  const primaryActiveSession = chargingStats[0] ?? null;
  const primarySessionAwaitingMeterValues = primaryActiveSession?.latestSampleAt === null;
  const chargingSessionColumns: Array<ExpandableDataTableColumn<ChargingStats>> = [
    {
      key: "transaction",
      header: "Transaction",
      render: (stats) => (
        <div className="session-table-primary">
          <strong>Transaction {stats.transactionId}</strong>
        </div>
      )
    },
    {
      key: "tag",
      header: "Tag",
      render: (stats) => (
        <span className="mono table-truncate" title={stats.idTag ?? "None"}>
          {stats.idTag ?? "None"}
        </span>
      )
    },
    {
      key: "connector",
      header: "Connector",
      render: (stats) => stats.connectorId
    },
    {
      key: "started",
      header: "Started",
      render: (stats) => (
        <div className="session-table-primary">
          <strong>{formatDuration(stats.elapsedSeconds)} ago</strong>
        </div>
      )
    },
    {
      key: "energy",
      header: "Energy",
      render: (stats) => formatEnergyWh(stats.energyUsedWh)
    },
    {
      key: "power",
      header: "Power",
      render: (stats) => formatPowerW(stats.latestPowerW)
    },
    {
      key: "meter-values",
      header: "MeterValues",
      render: (stats) => (
        <div className="session-table-primary">
          <strong>{stats.latestSampleAt === null ? "Pending" : formatDateTime(stats.latestSampleAt)}</strong>
          {stats.latestSampleAt === null ? <span>Awaiting sample</span> : null}
        </div>
      )
    },
    {
      key: "actions",
      headingClassName: "sessions-table__actions-heading",
      headerAriaLabel: "Actions",
      cellClassName: "session-table-cell session-table-cell--actions",
      stopPropagation: true,
      render: (stats) => (
        <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onOpenSessions} title="Open session" aria-label={`Open session ${stats.transactionId}`}>
          <ArrowRight aria-hidden="true" />
        </Button>
      )
    }
  ];

  return (
    <section className="home-stack charger-dashboard-stack">
      <section className="charger-live-panel">
        <section className="charging-stats-panel charging-stats-panel-standalone" aria-label="Live charging stats">
            <div className="dashboard-section-header">
              <div>
                <p className="eyebrow">Live charging</p>
                <h2>
                  {chargingStatsStatus === "error"
                    ? "Stats unavailable"
                    : chargingStats.length > 1
                      ? `${chargingStats.length} active sessions`
                      : primaryActiveSession
                        ? primarySessionAwaitingMeterValues
                          ? "Charging"
                          : "Active session"
                        : chargingStatsStatus === "loading"
                          ? "Loading stats"
                          : "No active session"}
                </h2>
              </div>
              <Gauge aria-hidden="true" />
            </div>
            {chargingStatsStatus === "error" ? (
              <p className="status-copy">Live meter stats could not be loaded. Recent sessions may still show active charging state.</p>
            ) : chargingStats.length > 0 ? (
              <ExpandableDataTable
                columns={chargingSessionColumns}
                expandedRowIds={expandedChargingSessionIds}
                getRowDetailsLabel={(stats) => `session ${stats.transactionId}`}
                getRowId={(stats) => stats.sessionId}
                onToggleRow={(sessionId) => setExpandedChargingSessionId(expandedChargingSessionId === sessionId ? null : sessionId)}
                renderExpandedRow={(stats) => <ChargingStatsDetails stats={stats} />}
                rows={chargingStats}
                tableClassName="charging-session-table"
                wrapClassName="charger-dashboard-table-wrap"
              />
            ) : (
              <p className="status-copy">Start a charging session to see live meter values from OCPP MeterValues.</p>
            )}
        </section>
      </section>

      <section className="charger-proxy-section">
        <div className="dashboard-section-header">
          <div>
            <p className="eyebrow">Proxy health</p>
            <h2>Upstream targets</h2>
          </div>
          <div className="dashboard-section-header__actions">
            <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={() => onNavigate("Proxy targets")} title="Proxy targets" aria-label="Proxy targets">
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        {!selectedChargerId ? (
          <p className="dashboard-empty-state">Select a charger context to view upstream proxy health.</p>
        ) : proxyTargetHealth.length === 0 ? (
          <p className="dashboard-empty-state">No proxy targets configured for this charger.</p>
        ) : (
          <div className="sessions-table-wrap charger-dashboard-table-wrap">
            <table className="sessions-table proxy-health-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>State</th>
                  <th>Detail</th>
                  <th>Upstream</th>
                  <th>Last success</th>
                  <th className="sessions-table__actions-heading" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {proxyTargetHealth.map(({ target, health, connectionUrl }) => (
                  <tr key={health.proxyTargetId}>
                    <td>
                      <div className="session-table-primary">
                        <strong>{health.name}</strong>
                        <span className="mono">{health.proxyTargetId}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${proxyHealthTone(health.state)}`} title={target ? undefined : "Target configuration is not loaded."}>
                        {formatProxyHealthState(health.state)}
                      </span>
                    </td>
                    <td>{buildProxyHealthDetail(health)}</td>
                    <td>
                      <span className="charger-dashboard-table-truncate mono" title={connectionUrl || health.upstreamIdentity || undefined}>
                        {connectionUrl || health.upstreamIdentity || "No upstream identity"}
                      </span>
                    </td>
                    <td>{formatDateTime(health.lastSuccessAt ?? health.lastConnectedAt ?? null)}</td>
                    <td className="session-table-cell session-table-cell--actions">
                      <Button
                        type="button"
                        className="button-secondary icon-button overview-icon-action"
                        onClick={() => onOpenCommunication({ proxyTargetId: health.proxyTargetId })}
                        title="Show proxy communication"
                        aria-label={`Show communication for ${health.name}`}
                      >
                        <MessageSquareText aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </section>

  );
}

function ChargingStatsDetails({ stats }: { stats: ChargingStats }) {
  return (
    <div className="session-detail-row">
      <div className="session-detail-grid">
        <span className="session-detail-item">
          <span>Start meter</span>
          <strong>{formatEnergyWh(stats.startMeterWh)}</strong>
        </span>
        <span className="session-detail-item">
          <span>Current</span>
          <strong>{formatDecimalUnit(stats.latestCurrentA ?? null, "A")}</strong>
        </span>
        <span className="session-detail-item">
          <span>Voltage</span>
          <strong>{formatDecimalUnit(stats.latestVoltageV ?? null, "V")}</strong>
        </span>
        <span className="session-detail-item">
          <span>Temperature</span>
          <strong>{formatDecimalUnit(stats.latestTemperatureC ?? null, "C")}</strong>
        </span>
        <span className="session-detail-item">
          <span>Phase current</span>
          <strong>{stats.latestCurrentPhasesA ? formatPhaseValues(stats.latestCurrentPhasesA, "A") : "-"}</strong>
        </span>
        <span className="session-detail-item">
          <span>Sample match</span>
          <strong>{formatSampleAssociation(stats.sampleAssociation)}</strong>
        </span>
      </div>
    </div>
  );
}

function buildProxyHealthDetail(health: ProxyHealthTarget) {
  if (!health.enabled) return "Disabled";

  const details = [health.connected ? "Connected" : formatProxyHealthState(health.state), health.detail];
  if (health.lastFailureAt) {
    details.push(`last failure ${formatDateTime(health.lastFailureAt)}`);
  } else if (health.lastSuccessAt) {
    details.push(`last success ${formatDateTime(health.lastSuccessAt)}`);
  }

  if (health.nextReconnectAt) {
    details.push(`retry ${formatDateTime(health.nextReconnectAt)}`);
  }

  if (health.reconnectFailureCount > 0) {
    details.push(`${health.reconnectFailureCount} failed ${health.reconnectFailureCount === 1 ? "attempt" : "attempts"}`);
  }

  if (health.lastErrorCode) {
    details.push(health.lastErrorCode);
  }

  return details.filter(Boolean).join(" · ");
}

function formatPhaseValues(values: Record<string, number>, unit: string) {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([phase, value]) => `${phase} ${formatDecimalUnit(value, unit)}`)
    .join(" / ");
}

function formatSampleAssociation(value: string) {
  if (value === "transaction-id") return "transaction matched";
  if (value === "connector-time-window") return "connector/time matched";
  return "unmatched";
}
