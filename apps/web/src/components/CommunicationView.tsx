import { Fragment, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Eye, EyeOff, RefreshCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import type { CommunicationJournalFilters, CommunicationJournalItem, ProxyTarget } from "../types";
import { buildCommunicationSummary, formatDateTime, stringifyPayload } from "../app-helpers";
import { Button } from "./ui/button";

type CommunicationViewProps = {
  busy: boolean;
  communicationFilters: CommunicationJournalFilters;
  communicationJournal: CommunicationJournalItem[];
  communicationRetentionHours: number | null;
  expandedCommunicationJournalId: string | null;
  proxyTargets: ProxyTarget[];
  selectedChargerId: string;
  selectedChargerLabel: string;
  onApplyFilters: (event: FormEvent<HTMLFormElement>) => void;
  onCommunicationFiltersChange: (filters: CommunicationJournalFilters) => void;
  onExpandedCommunicationJournalIdChange: (id: string | null) => void;
  onPurge: () => void;
  onRefresh: () => void;
  onRenderEndpoint: (type: string, id: string) => ReactNode;
  onResetFilters: () => void;
};

export function CommunicationView({
  busy,
  communicationFilters,
  communicationJournal,
  communicationRetentionHours,
  expandedCommunicationJournalId,
  proxyTargets,
  selectedChargerId,
  selectedChargerLabel,
  onApplyFilters,
  onCommunicationFiltersChange,
  onExpandedCommunicationJournalIdChange,
  onPurge,
  onRefresh,
  onRenderEndpoint,
  onResetFilters
}: CommunicationViewProps) {
  function updateFilters(patch: Partial<CommunicationJournalFilters>) {
    onCommunicationFiltersChange({ ...communicationFilters, ...patch });
  }

  function formatProxyTargetLabel(proxyTargetId: string) {
    return proxyTargets.find((target) => target.id === proxyTargetId)?.name ?? proxyTargetId;
  }

  return (
    <section className="communication-layout">
      <section className="panel communication-filters-panel">
        <div className="compact-filter-heading">
          <div>
            <p className="eyebrow">Journal</p>
            <h2>Filters</h2>
            <p className="status-copy">
              Showing the last 24 hours by default, newest first, limit 200. Retention is {communicationRetentionHours ?? 24} hours. Scoped to {selectedChargerLabel}.
            </p>
          </div>
          <SlidersHorizontal aria-hidden="true" />
        </div>
        <form className="communication-filter-form" onSubmit={onApplyFilters}>
          <div className="communication-filter-primary">
            <label className="field">
              <span>OCPP method</span>
              <input
                value={communicationFilters.ocppMethod}
                onChange={(event) => updateFilters({ ocppMethod: event.target.value })}
                placeholder="BootNotification"
              />
            </label>
            <label className="field">
              <span>Message type</span>
              <select
                value={communicationFilters.messageType}
                onChange={(event) => updateFilters({ messageType: event.target.value })}
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
              <span>From</span>
              <input
                value={communicationFilters.from}
                onChange={(event) => updateFilters({ from: event.target.value })}
                type="datetime-local"
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                value={communicationFilters.to}
                onChange={(event) => updateFilters({ to: event.target.value })}
                type="datetime-local"
              />
            </label>
            <div className="action-row communication-filter-actions">
              <Button type="submit" disabled={busy}>
                Apply filters
              </Button>
              <Button type="button" className="button-secondary" onClick={onResetFilters} disabled={busy}>
                Reset
              </Button>
            </div>
          </div>

          <details className="advanced-filters">
            <summary>
              <span>Advanced filters</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className="communication-filters">
              <label className="field">
                <span>Source type</span>
                <select
                  value={communicationFilters.sourceType}
                  onChange={(event) => updateFilters({ sourceType: event.target.value })}
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
                  value={communicationFilters.sourceId}
                  onChange={(event) => updateFilters({ sourceId: event.target.value })}
                  placeholder="SMART-EVSE-1"
                />
              </label>
              <label className="field">
                <span>Target type</span>
                <select
                  value={communicationFilters.targetType}
                  onChange={(event) => updateFilters({ targetType: event.target.value })}
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
                  value={communicationFilters.targetId}
                  onChange={(event) => updateFilters({ targetId: event.target.value })}
                  placeholder="server"
                />
              </label>
              <label className="field">
                <span>Charger id</span>
                {selectedChargerId ? (
                  <input value={communicationFilters.chargerId} disabled />
                ) : (
                  <input
                    value={communicationFilters.chargerId}
                    onChange={(event) => updateFilters({ chargerId: event.target.value })}
                    placeholder="SMART-EVSE-1"
                  />
                )}
              </label>
              <label className="field">
                <span>Proxy target id</span>
                <input
                  value={communicationFilters.proxyTargetId}
                  onChange={(event) => updateFilters({ proxyTargetId: event.target.value })}
                  placeholder="proxy-1"
                />
              </label>
              <label className="field">
                <span>Transaction</span>
                <input
                  value={communicationFilters.transactionId}
                  onChange={(event) => updateFilters({ transactionId: event.target.value })}
                  inputMode="numeric"
                  placeholder="1781932670376"
                />
              </label>
            </div>
          </details>
        </form>
      </section>

      <section className="panel table-panel communication-table-panel">
        <div className="topbar-actions">
          <div>
            <p className="eyebrow">Communication</p>
            <h2>Recent journal rows</h2>
          </div>
          <div className="action-row compact-action-row">
            <Button type="button" className="button-secondary icon-button" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
              <RefreshCcw aria-hidden="true" />
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
                  <th>Time</th>
                  <th>Direction</th>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Method</th>
                  <th>Message type</th>
                  <th>Charger</th>
                  <th>Proxy target</th>
                  <th>Transaction</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {communicationJournal.map((item) => {
                  const isExpanded = expandedCommunicationJournalId === item.id;

                  return (
                    <Fragment key={item.id}>
                      <tr key={item.id}>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>
                          <span className={`pill ${item.direction === "inbound" ? "pill-good" : "pill-neutral"}`}>{item.direction}</span>
                        </td>
                        <td className="mono">{onRenderEndpoint(item.sourceType, item.sourceId)}</td>
                        <td className="mono">{onRenderEndpoint(item.targetType, item.targetId)}</td>
                        <td className="mono">{item.ocppMethod || "-"}</td>
                        <td>{item.messageType}</td>
                        <td className="mono">{item.chargerId || "-"}</td>
                        <td className="mono">
                          {item.proxyTargetId ? <span title={item.proxyTargetId}>{formatProxyTargetLabel(item.proxyTargetId)}</span> : "-"}
                        </td>
                        <td>{item.transactionId ?? "-"}</td>
                        <td>
                          <div className="communication-summary">
                            <Button
                              type="button"
                              className="button-secondary icon-button communication-toggle"
                              onClick={() =>
                                onExpandedCommunicationJournalIdChange(isExpanded ? null : item.id)
                              }
                              aria-expanded={isExpanded}
                              aria-controls={`journal-payload-${item.id}`}
                              aria-label={isExpanded ? "Hide payload" : "Show payload"}
                              title={isExpanded ? "Hide payload" : "Show payload"}
                            >
                              {isExpanded ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                            </Button>
                            <p>{buildCommunicationSummary(item)}</p>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr key={`${item.id}-payload`}>
                          <td id={`journal-payload-${item.id}`} className="communication-expanded" colSpan={10}>
                            <div className="communication-expanded__grid">
                              <div>
                                <p className="eyebrow">Payload</p>
                                <pre className="communication-payload">{stringifyPayload(item.payload)}</pre>
                              </div>
                              <div className="communication-details">
                                <p>
                                  <span className="eyebrow">Direction</span>
                                  <span>{item.direction}</span>
                                </p>
                                <p>
                                  <span className="eyebrow">Source</span>
                                  <span className="mono">{onRenderEndpoint(item.sourceType, item.sourceId)}</span>
                                </p>
                                <p>
                                  <span className="eyebrow">Target</span>
                                  <span className="mono">{onRenderEndpoint(item.targetType, item.targetId)}</span>
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
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>

  );
}
