import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw, SlidersHorizontal } from "lucide-react";
import type { ActiveSessionAuditResponse, ChargingSession, ChargingStats, SessionSearchFilters, Tag } from "../types";
import { FilterField, FilterGrid, FilterPanel, FilterSelect } from "./FilterControls";
import { Button } from "./ui/button";
import { SessionListItem } from "./SessionListItem";

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
