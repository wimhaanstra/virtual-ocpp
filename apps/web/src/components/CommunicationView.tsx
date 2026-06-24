import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Download, RefreshCcw, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { CommunicationJournalFilters, CommunicationJournalItem, ProxyTarget } from "../types";
import { buildCommunicationSummary, formatDateTime, formatTime, stringifyPayload } from "../app-helpers";
import { Button } from "./ui/button";

type CommunicationViewProps = {
  busy: boolean;
  communicationFilters: CommunicationJournalFilters;
  communicationJournal: CommunicationJournalItem[];
  hasMore: boolean;
  loadingMore: boolean;
  communicationRetentionHours: number | null;
  expandedCommunicationJournalId: string | null;
  proxyTargets: ProxyTarget[];
  selectedChargerId: string;
  selectedChargerLabel: string;
  onCommunicationFiltersChange: (filters: CommunicationJournalFilters) => void;
  onExport: () => void;
  onExpandedCommunicationJournalIdChange: (id: string | null) => void;
  onLoadMore: () => void;
  onPurge: () => void;
  onRefresh: () => void;
  onRenderEndpoint: (type: string, id: string) => ReactNode;
  onResetFilters: () => void;
};

export function CommunicationView({
  busy,
  communicationFilters,
  communicationJournal,
  hasMore,
  loadingMore,
  communicationRetentionHours,
  expandedCommunicationJournalId,
  proxyTargets,
  selectedChargerId,
  selectedChargerLabel,
  onCommunicationFiltersChange,
  onExport,
  onExpandedCommunicationJournalIdChange,
  onLoadMore,
  onPurge,
  onRefresh,
  onRenderEndpoint,
  onResetFilters
}: CommunicationViewProps) {
  const [draftFilters, setDraftFilters] = useState(communicationFilters);
  const [copiedPayloadId, setCopiedPayloadId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const validationError = useMemo(() => validateCommunicationFilters(draftFilters), [draftFilters]);
  const scopeChip = selectedChargerLabel ? `Scope: ${selectedChargerLabel}` : null;
  const activeFilterChips = buildActiveFilterChips(communicationFilters);
  const groupedJournal = groupCommunicationRowsByDate(communicationJournal);
  const hasAdvancedFilters = Boolean(
    draftFilters.from ||
      draftFilters.to ||
      draftFilters.sourceType ||
      draftFilters.sourceId ||
      draftFilters.targetType ||
      draftFilters.targetId ||
      draftFilters.chargerId ||
      draftFilters.proxyTargetId
  );

  useEffect(() => {
    setDraftFilters(communicationFilters);
  }, [communicationFilters]);

  useEffect(() => {
    if (validationError) return;
    const timeout = window.setTimeout(() => {
      if (!areCommunicationFiltersEqual(draftFilters, communicationFilters)) {
        onCommunicationFiltersChange(draftFilters);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [communicationFilters, draftFilters, onCommunicationFiltersChange, validationError]);

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

  function updateFilters(patch: Partial<CommunicationJournalFilters>) {
    setDraftFilters((current) => applyCommunicationFilterPatch(current, patch));
  }

  function updateFiltersNow(patch: Partial<CommunicationJournalFilters>) {
    const next = applyCommunicationFilterPatch(draftFilters, patch);
    setDraftFilters(next);
    if (!validateCommunicationFilters(next)) {
      onCommunicationFiltersChange(next);
    }
  }

  function formatProxyTargetLabel(proxyTargetId: string) {
    return proxyTargets.find((target) => target.id === proxyTargetId)?.name ?? proxyTargetId;
  }

  function removeFilterChip(key: keyof CommunicationJournalFilters) {
    if (key === "preset" || key === "from" || key === "to") {
      updateFiltersNow({ preset: "24h", from: "", to: "" });
      return;
    }
    updateFiltersNow({ [key]: "" });
  }

  async function copyPayload(item: CommunicationJournalItem) {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(stringifyPayload(item.payload));
    setCopiedPayloadId(item.id);
    window.setTimeout(() => {
      setCopiedPayloadId((current) => (current === item.id ? null : current));
    }, 1600);
  }

  return (
    <section className="communication-layout">
      <section className="panel communication-filters-panel">
        <div className="compact-filter-heading">
          <div>
            <p className="eyebrow">Journal</p>
            <h2>Filters</h2>
            <p className="status-copy">
              Showing the last 24 hours by default, newest first, 100 rows per page. Retention is {communicationRetentionHours ?? 24} hours.
            </p>
          </div>
          <SlidersHorizontal aria-hidden="true" />
        </div>
        <div className="communication-filter-summary">
          <div className="communication-filter-summary__header">
            <span className="eyebrow">Scope and filters</span>
            <span className="communication-filter-summary__count">{activeFilterChips.length} selected</span>
          </div>
          {scopeChip ? (
            <div className="filter-chip-row">
              <span className="filter-chip filter-chip-muted">{scopeChip}</span>
            </div>
          ) : null}
          <div className="filter-chip-row" aria-label="Active communication filters">
            {activeFilterChips.length > 0 ? (
              activeFilterChips.map((chip) => (
                <span className="filter-chip removable-filter-chip" key={chip.key}>
                  {chip.label}
                  <button
                    type="button"
                    onClick={() => removeFilterChip(chip.key)}
                    aria-label={`Remove ${chip.label} filter`}
                    title={`Remove ${chip.label} filter`}
                  >
                    <X aria-hidden="true" />
                  </button>
                </span>
              ))
            ) : (
              <span className="filter-chip filter-chip-muted">No extra filters</span>
            )}
          </div>
        </div>
        <div className="communication-filter-form">
          <div className="communication-filter-primary">
            <label className="field">
              <span>Time</span>
              <select value={draftFilters.preset} onChange={(event) => updateFiltersNow({ preset: event.target.value })}>
                <option value="15m">Last 15m</option>
                <option value="1h">Last hour</option>
                <option value="6h">Last 6h</option>
                <option value="24h">Last 24h</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="field">
              <span>OCPP method</span>
              <input
                value={draftFilters.ocppMethod}
                onChange={(event) => updateFilters({ ocppMethod: event.target.value })}
                placeholder="BootNotification"
              />
            </label>
            <label className="field">
              <span>Message type</span>
              <select
                value={draftFilters.messageType}
                onChange={(event) => updateFiltersNow({ messageType: event.target.value })}
              >
                <option value="">Any</option>
                <option value="call">Call</option>
                <option value="callResult">Call result</option>
                <option value="callError">Call error</option>
                <option value="connection">Connection</option>
                <option value="disconnect">Disconnect</option>
              </select>
            </label>
            <label className="field">
              <span>Transaction</span>
              <input
                value={draftFilters.transactionId}
                onChange={(event) => updateFilters({ transactionId: event.target.value })}
                inputMode="numeric"
                placeholder="1781932670376"
              />
            </label>
            <div className="action-row communication-filter-actions">
              <Button type="button" className="button-secondary compact-text-button" onClick={onResetFilters} disabled={busy}>
                Reset
              </Button>
            </div>
          </div>
          {validationError ? <p className="field-error">{validationError}</p> : null}

          <details className="advanced-filters" open={hasAdvancedFilters || undefined}>
            <summary>
              <span>Source, target, time</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className="communication-filters">
              <label className="field">
                <span>From</span>
                <input
                  value={draftFilters.from}
                  onChange={(event) => updateFilters({ from: event.target.value })}
                  type="datetime-local"
                  disabled={draftFilters.preset !== "custom"}
                />
              </label>
              <label className="field">
                <span>To</span>
                <input
                  value={draftFilters.to}
                  onChange={(event) => updateFilters({ to: event.target.value })}
                  type="datetime-local"
                  disabled={draftFilters.preset !== "custom"}
                />
              </label>
              <label className="field">
                <span>Source type</span>
                <select
                  value={draftFilters.sourceType}
                  onChange={(event) => updateFiltersNow({ sourceType: event.target.value })}
                >
                  <option value="">Any</option>
                  <option value="charger">Charger</option>
                  <option value="server">Server</option>
                  <option value="proxy">Proxy</option>
                </select>
              </label>
              <label className="field">
                <span>Source id</span>
                <input
                  value={draftFilters.sourceId}
                  onChange={(event) => updateFilters({ sourceId: event.target.value })}
                  placeholder="SMART-EVSE-1"
                />
              </label>
              <label className="field">
                <span>Target type</span>
                <select
                  value={draftFilters.targetType}
                  onChange={(event) => updateFiltersNow({ targetType: event.target.value })}
                >
                  <option value="">Any</option>
                  <option value="charger">Charger</option>
                  <option value="server">Server</option>
                  <option value="proxy">Proxy</option>
                </select>
              </label>
              <label className="field">
                <span>Target id</span>
                <input
                  value={draftFilters.targetId}
                  onChange={(event) => updateFilters({ targetId: event.target.value })}
                  placeholder="server"
                />
              </label>
              <label className="field">
                <span>Charger id</span>
                {selectedChargerId ? (
                  <input value={selectedChargerId} disabled />
                ) : (
                  <input
                    value={draftFilters.chargerId}
                    onChange={(event) => updateFilters({ chargerId: event.target.value })}
                    placeholder="SMART-EVSE-1"
                  />
                )}
              </label>
              <label className="field">
                <span>Proxy target id</span>
                <input
                  value={draftFilters.proxyTargetId}
                  onChange={(event) => updateFilters({ proxyTargetId: event.target.value })}
                  placeholder="proxy-1"
                />
              </label>
            </div>
          </details>
        </div>
      </section>

      <section className="panel table-panel communication-table-panel">
        <div className="topbar-actions">
          <div>
            <p className="eyebrow">Communication</p>
            <h2>Recent journal rows</h2>
            <p className="status-copy">{communicationJournal.length} row{communicationJournal.length === 1 ? "" : "s"} loaded.</p>
          </div>
          <div className="action-row compact-action-row">
            <Button type="button" className="button-secondary icon-button" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
              <RefreshCcw aria-hidden="true" />
            </Button>
            <Button type="button" className="button-secondary icon-button" onClick={onExport} disabled={busy} title="Export CSV" aria-label="Export CSV">
              <Download aria-hidden="true" />
            </Button>
            <Button type="button" className="button-ghost button-danger icon-button" onClick={onPurge} disabled={busy} title="Purge journal" aria-label="Purge">
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>
        {communicationJournal.length === 0 ? (
          <p>No communication rows match these filters.</p>
        ) : (
          <div className="table-wrap communication-table-wrap">
            <table className="communication-table">
              <thead>
                <tr>
                  <th aria-label="Expand"></th>
                  <th>Time</th>
                  <th>Direction</th>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Method</th>
                  <th>Message type</th>
                </tr>
              </thead>
              <tbody>
                {groupedJournal.map((group) => (
                  <Fragment key={group.dateKey}>
                    <tr className="session-date-row">
                      <td colSpan={7}>{group.label}</td>
                    </tr>
                    {group.items.map((item) => {
                      const isExpanded = expandedCommunicationJournalId === item.id;
                      const payloadText = stringifyPayload(item.payload);

                      return (
                        <Fragment key={item.id}>
                          <tr
                            className="communication-row"
                            tabIndex={0}
                            onClick={() => onExpandedCommunicationJournalIdChange(isExpanded ? null : item.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onExpandedCommunicationJournalIdChange(isExpanded ? null : item.id);
                              }
                            }}
                          >
                            <td data-label="Expand">
                              <Button
                                type="button"
                                className="button-secondary icon-button session-expand-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onExpandedCommunicationJournalIdChange(isExpanded ? null : item.id);
                                }}
                                aria-expanded={isExpanded}
                                aria-controls={`journal-payload-${item.id}`}
                                aria-label={isExpanded ? "Hide communication details" : "Show communication details"}
                                title={isExpanded ? "Hide communication details" : "Show communication details"}
                              >
                                {isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                              </Button>
                            </td>
                            <td data-label="Time">{formatTime(item.createdAt)}</td>
                            <td data-label="Direction">
                              <span className={`pill ${item.direction === "inbound" ? "pill-good" : "pill-neutral"}`}>{item.direction}</span>
                            </td>
                            <td data-label="Source">{renderEndpointBadge(item.sourceType, item.sourceId, onRenderEndpoint)}</td>
                            <td data-label="Target">{renderEndpointBadge(item.targetType, item.targetId, onRenderEndpoint)}</td>
                            <td className="mono" data-label="Method">{item.ocppMethod || "-"}</td>
                            <td data-label="Message type">{item.messageType}</td>
                          </tr>
                          {isExpanded ? (
                            <tr key={`${item.id}-payload`}>
                              <td id={`journal-payload-${item.id}`} className="communication-expanded" colSpan={7}>
                                <div className="communication-expanded__grid">
                                  <div>
                                    <div className="communication-payload-header">
                                      <p className="eyebrow">Payload</p>
                                      <Button
                                        type="button"
                                        className="button-secondary icon-button"
                                        onClick={() => void copyPayload(item)}
                                        title="Copy payload"
                                        aria-label="Copy payload"
                                      >
                                        {copiedPayloadId === item.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                      </Button>
                                    </div>
                                    <pre className="communication-payload">{payloadText}</pre>
                                  </div>
                                  <div className="communication-details">
                                    <p>
                                      <span className="eyebrow">Summary</span>
                                      <span>{buildCommunicationSummary(item)}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Time</span>
                                      <span>{formatDateTime(item.createdAt)}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Direction</span>
                                      <span>{item.direction}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Message type</span>
                                      <span>{item.messageType}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Method</span>
                                      <span className="mono">{item.ocppMethod || "-"}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Source</span>
                                      <span className="mono">{renderEndpointBadge(item.sourceType, item.sourceId, onRenderEndpoint)}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Target</span>
                                      <span className="mono">{renderEndpointBadge(item.targetType, item.targetId, onRenderEndpoint)}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Charger</span>
                                      <span className="mono">{item.chargerId || "-"}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Proxy target</span>
                                      <span className="mono">
                                        {item.proxyTargetId ? <span title={item.proxyTargetId}>{formatProxyTargetLabel(item.proxyTargetId)}</span> : "-"}
                                      </span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Transaction</span>
                                      <span className="mono">{item.transactionId ?? "-"}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Correlation</span>
                                      <span className="mono">{item.correlationId || "-"}</span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Error</span>
                                      <span className="mono">
                                        {item.errorCode ? item.errorCode : "-"}
                                        {item.errorDescription ? ` - ${item.errorDescription}` : ""}
                                      </span>
                                    </p>
                                    <p>
                                      <span className="eyebrow">Tag</span>
                                      <span className="mono">{item.idTag || "-"}</span>
                                    </p>
                                  </div>
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
        <div ref={loadMoreRef} className="communication-load-more">
          {hasMore ? (
            <Button type="button" className="button-secondary compact-text-button" onClick={onLoadMore} disabled={busy || loadingMore}>
              {loadingMore ? "Loading..." : "Load older rows"}
            </Button>
          ) : communicationJournal.length > 0 ? (
            <span className="status-copy">No older rows in this filter window.</span>
          ) : null}
        </div>
      </section>
    </section>

  );
}

function validateCommunicationFilters(filters: CommunicationJournalFilters) {
  const transactionId = filters.transactionId.trim();
  if (transactionId && !/^\d+$/.test(transactionId)) {
    return "Transaction must be a whole number.";
  }

  const from = parseLocalDateTime(filters.from);
  const to = parseLocalDateTime(filters.to);
  if (filters.from.trim() && !from) return "From date is invalid.";
  if (filters.to.trim() && !to) return "To date is invalid.";
  if (from && to && from.getTime() > to.getTime()) return "From must be before To.";
  return "";
}

function applyCommunicationFilterPatch(filters: CommunicationJournalFilters, patch: Partial<CommunicationJournalFilters>) {
  const next = { ...filters, ...patch };
  if (patch.preset && patch.preset !== "custom") {
    next.from = "";
    next.to = "";
  }
  if ((patch.from !== undefined || patch.to !== undefined) && next.preset !== "custom") {
    next.preset = "custom";
  }
  return next;
}

function parseLocalDateTime(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function areCommunicationFiltersEqual(left: CommunicationJournalFilters, right: CommunicationJournalFilters) {
  return (Object.keys(left) as Array<keyof CommunicationJournalFilters>).every((key) => left[key] === right[key]);
}

function groupCommunicationRowsByDate(items: CommunicationJournalItem[]) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  const groups = new Map<string, { dateKey: string; label: string; items: CommunicationJournalItem[] }>();

  for (const item of items) {
    const date = new Date(item.createdAt);
    const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const existing = groups.get(dateKey);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(dateKey, {
        dateKey,
        label: formatter.format(date),
        items: [item]
      });
    }
  }

  return Array.from(groups.values());
}

function renderEndpointBadge(type: string, id: string, renderEndpoint: (type: string, id: string) => ReactNode) {
  return (
    <span className="communication-endpoint">
      <span className={`pill communication-endpoint-type communication-endpoint-type-${type}`}>{type}</span>
      <span className="communication-endpoint-id">{renderEndpoint(type, id)}</span>
    </span>
  );
}

function buildActiveFilterChips(filters: CommunicationJournalFilters) {
  const chips: Array<{ key: keyof CommunicationJournalFilters; label: string }> = [];
  if (filters.preset.trim() && filters.preset !== "24h" && filters.preset !== "custom") {
    chips.push({ key: "preset", label: `Time: ${formatPreset(filters.preset)}` });
  }
  const labels: Array<[keyof CommunicationJournalFilters, string]> = [
    ["ocppMethod", "Method"],
    ["messageType", "Message type"],
    ["transactionId", "Transaction"],
    ["sourceType", "Source type"],
    ["sourceId", "Source"],
    ["targetType", "Target type"],
    ["targetId", "Target"],
    ["proxyTargetId", "Proxy target"],
    ["from", "From"],
    ["to", "To"]
  ];

  for (const [key, label] of labels) {
    const value = filters[key].trim();
    if (!value) continue;
    if (key === "from" || key === "to") {
      chips.push({ key, label: `${label}: ${value.replace("T", " ")}` });
      continue;
    }
    chips.push({ key, label: `${label}: ${value}` });
  }

  return chips;
}

function formatPreset(value: string) {
  if (value === "15m") return "Last 15m";
  if (value === "1h") return "Last hour";
  if (value === "6h") return "Last 6h";
  return value;
}
