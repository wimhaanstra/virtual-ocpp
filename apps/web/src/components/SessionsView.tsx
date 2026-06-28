import { useEffect, useMemo, useRef, useState } from "react";
import { Power, PowerOff, RefreshCcw, Send, SlidersHorizontal } from "lucide-react";
import type { ActiveSessionAuditResponse, ChargingSession, ChargingStats, SessionSearchFilters, Tag } from "../types";
import {
  findAuditForSession,
  formatDateTime,
  formatEnergyWh,
  formatPowerW,
  formatTime,
  getMeterSourceLabel
} from "../app-helpers";
import { ExpandableDataTable, type ExpandableDataTableColumn } from "./ExpandableDataTable";
import { FilterField, FilterGrid, FilterPanel, FilterSelect } from "./FilterControls";
import { Button } from "./ui/button";

type SessionsViewProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  chargingSessions: ChargingSession[];
  chargingStats: ChargingStats[];
  hasMore: boolean;
  loadingMore: boolean;
  sessionFilters: SessionSearchFilters;
  tags: Tag[];
  onFiltersChange: (filters: SessionSearchFilters) => void;
  onForceClose: (session: ChargingSession) => void;
  onLoadMore: () => void;
  onProxyStopRecovery: (session: ChargingSession) => void;
  onRefresh: () => void;
  onResetFilters: () => void;
  onRemoteStop: (session: ChargingSession) => void;
};

export function SessionsView({
  activeSessionAudit,
  busy,
  chargingSessions,
  chargingStats,
  hasMore,
  loadingMore,
  sessionFilters,
  tags,
  onFiltersChange,
  onForceClose,
  onLoadMore,
  onProxyStopRecovery,
  onRefresh,
  onResetFilters,
  onRemoteStop
}: SessionsViewProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState(sessionFilters);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const validationError = useMemo(() => validateSessionFilters(draftFilters), [draftFilters]);
  const activeFilterChips = buildActiveSessionFilterChips(sessionFilters);
  const groupedSessions = groupSessionsByDate(chargingSessions);
  const tagOptions = useMemo(() => buildTagFilterOptions(tags, draftFilters.idTag), [draftFilters.idTag, tags]);
  const expandedSessionIds = new Set(expandedSessionId ? [expandedSessionId] : []);
  const sessionColumns: Array<ExpandableDataTableColumn<ChargingSession>> = [
    {
      key: "started",
      header: "Started",
      render: (session) => (
        <div className="session-table-primary">
          <strong>{formatTime(session.startedAt)}</strong>
          <span>Transaction {session.transactionId}</span>
        </div>
      )
    },
    {
      key: "ended",
      header: "Ended",
      render: (session) => <strong>{session.stoppedAt ? formatTime(session.stoppedAt) : "Active"}</strong>
    },
    {
      key: "energy",
      header: "Energy used",
      render: (session) => {
        const liveStats = getLiveStatsForSession(session, chargingStats);
        const meterSource = getSessionMeterSource(session, liveStats);
        return (
          <strong title={getMeterSourceLabel(meterSource)}>
            {formatEnergyWh(getSessionEnergyUsedWh(session, liveStats))}
          </strong>
        );
      }
    },
    {
      key: "live",
      header: "Live",
      render: (session) => {
        const liveStats = getLiveStatsForSession(session, chargingStats);
        return (
          <strong className="session-live-value">
            {session.active && liveStats ? `${formatPowerW(liveStats.latestPowerW)} · ${formatEnergyWh(liveStats.energyUsedWh)}` : "-"}
          </strong>
        );
      }
    },
    {
      key: "status",
      header: "Status",
      render: (session) => {
        const audit = findAuditForSession(activeSessionAudit, session);
        return (
          <div className="status-stack session-table-status">
            <span className={`pill overview-status-pill ${session.active ? "pill-good" : "pill-neutral"}`}>{session.status}</span>
            {audit && audit.warnings.length > 0 ? <span className="pill pill-warning">Missing stop?</span> : null}
          </div>
        );
      }
    },
    {
      key: "actions",
      headingClassName: "sessions-table__actions-heading",
      header: "Actions",
      cellClassName: "session-table-cell session-table-cell--actions",
      stopPropagation: true,
      render: (session) => (
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
      )
    }
  ];

  useEffect(() => {
    setDraftFilters(sessionFilters);
  }, [sessionFilters]);

  useEffect(() => {
    if (validationError) return;
    const timeout = window.setTimeout(() => {
      if (!areSessionFiltersEqual(draftFilters, sessionFilters)) {
        onFiltersChange(draftFilters);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [draftFilters, onFiltersChange, sessionFilters, validationError]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadMore();
      }
    }, { rootMargin: "320px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  function updateFilters(patch: Partial<SessionSearchFilters>, immediate = false) {
    const next = { ...draftFilters, ...patch };
    setDraftFilters(next);
    if (immediate && !validateSessionFilters(next)) {
      onFiltersChange(next);
    }
  }

  function removeFilterChip(key: keyof SessionSearchFilters) {
    updateFilters({ [key]: "" }, true);
  }

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

      <FilterPanel
        activeCount={activeFilterChips.length}
        ariaLabel="Active session filters"
        busy={busy}
        chips={activeFilterChips}
        emptyChipLabel="No filters"
        meta={
          <>
            <SlidersHorizontal aria-hidden="true" />
          </>
        }
        validationError={validationError}
        onRemove={(key) => removeFilterChip(key)}
        onReset={onResetFilters}
      >
        <FilterGrid columns="sessions">
          <FilterField label="Status">
            <FilterSelect
              ariaLabel="Status"
              value={draftFilters.status}
              options={[
                { value: "", label: "Any" },
                { value: "active", label: "Active" },
                { value: "stopped", label: "Stopped" }
              ]}
              onChange={(value) => updateFilters({ status: value }, true)}
            />
          </FilterField>
          <FilterField label="From">
            <input value={draftFilters.from} onChange={(event) => updateFilters({ from: event.target.value })} type="datetime-local" />
          </FilterField>
          <FilterField label="To">
            <input value={draftFilters.to} onChange={(event) => updateFilters({ to: event.target.value })} type="datetime-local" />
          </FilterField>
          <FilterField label="Tag">
            <FilterSelect ariaLabel="Tag" value={draftFilters.idTag} options={tagOptions} onChange={(value) => updateFilters({ idTag: value }, true)} />
          </FilterField>
          <FilterField label="Transaction">
            <input value={draftFilters.transactionId} onChange={(event) => updateFilters({ transactionId: event.target.value })} inputMode="numeric" placeholder="10084" />
          </FilterField>
          <FilterField label="Connector">
            <input value={draftFilters.connectorId} onChange={(event) => updateFilters({ connectorId: event.target.value })} inputMode="numeric" placeholder="1" />
          </FilterField>
          <FilterField label="Min energy Wh">
            <input value={draftFilters.minEnergyWh} onChange={(event) => updateFilters({ minEnergyWh: event.target.value })} inputMode="numeric" placeholder="1000" />
          </FilterField>
        </FilterGrid>
      </FilterPanel>

      {chargingSessions.length === 0 ? (
        <p className="dashboard-empty-state">No charging sessions recorded yet.</p>
      ) : (
        <div className="sessions-date-stack">
          {groupedSessions.map((group) => (
            <section className="sessions-date-group" key={group.dateKey} aria-label={group.label}>
              <div className="sessions-date-group__header">
                <p className="eyebrow">{group.label}</p>
              </div>
              <ExpandableDataTable
                columns={sessionColumns}
                expandedRowIds={expandedSessionIds}
                getRowDetailsLabel={(session) => `session ${session.transactionId}`}
                getRowId={(session) => session.id}
                onToggleRow={(sessionId) => setExpandedSessionId(expandedSessionId === sessionId ? null : sessionId)}
                renderExpandedRow={(session) => (
                  <SessionDetails
                    activeSessionAudit={activeSessionAudit}
                    liveStats={getLiveStatsForSession(session, chargingStats)}
                    session={session}
                  />
                )}
                rows={group.sessions}
              />
            </section>
          ))}
        </div>
      )}
      <div ref={loadMoreRef} className="communication-load-more">
        {hasMore ? (
          <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={onLoadMore} disabled={busy || loadingMore}>
            {loadingMore ? "Loading..." : "Load older sessions"}
          </Button>
        ) : chargingSessions.length > 0 ? (
          <span className="status-copy">No older sessions in this filter window.</span>
        ) : null}
      </div>
    </section>
  );
}

type SessionDetailsProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  liveStats: ChargingStats | null;
  session: ChargingSession;
};

function SessionDetails({ activeSessionAudit, liveStats, session }: SessionDetailsProps) {
  const audit = findAuditForSession(activeSessionAudit, session);
  const meterSource = getSessionMeterSource(session, liveStats);

  return (
    <>
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
            <strong className="mono table-truncate" title={session.chargerId}>
              {session.chargerId}
            </strong>
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
            <strong className="mono table-truncate" title={session.idTag || "None"}>
              {session.idTag || "None"}
            </strong>
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
    </>
  );
}

function getLiveStatsForSession(session: ChargingSession, chargingStats: ChargingStats[]) {
  return chargingStats.find((entry) => entry.sessionId === session.id || entry.transactionId === session.transactionId) ?? null;
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

function validateSessionFilters(filters: SessionSearchFilters) {
  if (filters.transactionId.trim() && !/^\d+$/.test(filters.transactionId.trim())) return "Transaction must be a whole number.";
  if (filters.connectorId.trim() && !/^\d+$/.test(filters.connectorId.trim())) return "Connector must be a whole number.";
  if (filters.minEnergyWh.trim() && !/^\d+$/.test(filters.minEnergyWh.trim())) return "Minimum energy must be a whole number.";
  const from = parseLocalDateTime(filters.from);
  const to = parseLocalDateTime(filters.to);
  if (filters.from.trim() && !from) return "From date is invalid.";
  if (filters.to.trim() && !to) return "To date is invalid.";
  if (from && to && from.getTime() > to.getTime()) return "From must be before To.";
  return "";
}

function parseLocalDateTime(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function areSessionFiltersEqual(left: SessionSearchFilters, right: SessionSearchFilters) {
  return (Object.keys(left) as Array<keyof SessionSearchFilters>).every((key) => left[key] === right[key]);
}

function buildActiveSessionFilterChips(filters: SessionSearchFilters) {
  const chips: Array<{ key: keyof SessionSearchFilters; label: string }> = [];
  const labels: Array<[keyof SessionSearchFilters, string]> = [
    ["status", "Status"],
    ["from", "From"],
    ["to", "To"],
    ["idTag", "Tag"],
    ["transactionId", "Transaction"],
    ["connectorId", "Connector"],
    ["minEnergyWh", "Min energy"]
  ];

  for (const [key, label] of labels) {
    const value = filters[key].trim();
    if (!value) continue;
    chips.push({ key, label: `${label}: ${key === "from" || key === "to" ? value.replace("T", " ") : value}` });
  }

  return chips;
}

function buildTagFilterOptions(tags: Tag[], currentValue: string) {
  const options = [
    { value: "", label: "Any" },
    ...tags.map((tag) => ({
      value: tag.uuid,
      label: tag.label || tag.uuid,
      description: tag.label ? tag.uuid : undefined
    }))
  ];

  if (currentValue && !options.some((option) => option.value === currentValue)) {
    options.push({ value: currentValue, label: currentValue, description: "Current filter" });
  }

  return options;
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
