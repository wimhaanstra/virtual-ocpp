import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { formatTagMappingCount } from "../app-helpers";
import type { ProxyTarget } from "../types";
import { Button } from "./ui/button";

type ProxyTargetsViewProps = {
  busy: boolean;
  enabledCount: number;
  enabledLimit: number;
  enabledLimitReached: boolean;
  proxyTargets: ProxyTarget[];
  selectedChargerId: string;
  onAdd: () => void;
  onDelete: (target: ProxyTarget) => void;
  onEdit: (target: ProxyTarget) => void;
  onToggle: (target: ProxyTarget) => void;
};

export function ProxyTargetsView({
  busy,
  enabledCount,
  enabledLimit,
  enabledLimitReached,
  proxyTargets,
  selectedChargerId,
  onAdd,
  onDelete,
  onEdit,
  onToggle
}: ProxyTargetsViewProps) {
  const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);

  return (
    <section className="proxy-targets-page">
      <div className="dashboard-section-header">
        <div>
          <p className="eyebrow">Routing</p>
          <h2>Configured targets</h2>
        </div>
        <div className="dashboard-section-header__actions">
          <span className="proxy-targets-limit-pill">
            {enabledCount}/{enabledLimit} enabled
          </span>
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onAdd} disabled={busy || !selectedChargerId} title="Add target" aria-label="Add target">
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      {proxyTargets.length === 0 ? (
        <p className="dashboard-empty-state">No proxy targets configured yet.</p>
      ) : (
        <div className="proxy-targets-table-wrap">
          <table className="proxy-targets-table">
            <thead>
              <tr>
                <th aria-label="Expand proxy target details" />
                <th>Name</th>
                <th>Station ID</th>
                <th>Mode</th>
                <th>Outage</th>
                <th>Recovery</th>
                <th>Status</th>
                <th className="proxy-targets-table__actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {proxyTargets.map((target) => {
                const expanded = expandedTargetId === target.id;

                return (
                  <ProxyTargetTableRow
                    key={target.id}
                    busy={busy}
                    enabledLimitReached={enabledLimitReached}
                    expanded={expanded}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onToggle={onToggle}
                    onToggleExpanded={() => setExpandedTargetId(expanded ? null : target.id)}
                    target={target}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type ProxyTargetTableRowProps = {
  busy: boolean;
  enabledLimitReached: boolean;
  expanded: boolean;
  target: ProxyTarget;
  onDelete: (target: ProxyTarget) => void;
  onEdit: (target: ProxyTarget) => void;
  onToggle: (target: ProxyTarget) => void;
  onToggleExpanded: () => void;
};

function ProxyTargetTableRow({
  busy,
  enabledLimitReached,
  expanded,
  target,
  onDelete,
  onEdit,
  onToggle,
  onToggleExpanded
}: ProxyTargetTableRowProps) {
  return (
    <>
      <tr
        className="proxy-target-table-row"
        tabIndex={0}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
      >
        <td className="proxy-targets-table-cell proxy-targets-table-cell--expand">
          <Button
            type="button"
            className="button-secondary icon-button overview-icon-action"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded();
            }}
            title={expanded ? "Hide proxy target details" : "Show proxy target details"}
            aria-label={`${expanded ? "Hide" : "Show"} details for proxy target ${target.name}`}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </td>
        <td>
          <strong>{target.name}</strong>
        </td>
        <td className="mono">{target.stationId || "Default"}</td>
        <td>{target.mode === "deny-capable" ? "Deny capable" : "Monitor only"}</td>
        <td>{target.outagePolicy === "fail-closed" ? "Fail closed" : "Fail open"}</td>
        <td>{target.allowRecoverySubmissions ? "Allowed" : "Off"}</td>
        <td>
          <span className={`pill overview-status-pill ${target.enabled ? "pill-good" : "pill-warning"}`}>{target.enabled ? "Enabled" : "Disabled"}</span>
        </td>
        <td className="proxy-targets-table-cell proxy-targets-table-cell--actions" onClick={(event) => event.stopPropagation()}>
          <div className="dashboard-item__actions proxy-targets-table-actions">
            <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={() => onEdit(target)} disabled={busy} title="Edit proxy target" aria-label="Edit">
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              className="button-secondary icon-button overview-icon-action"
              onClick={() => onToggle(target)}
              disabled={busy || (!target.enabled && enabledLimitReached)}
              title={target.enabled ? "Disable proxy target" : "Enable proxy target"}
              aria-label={target.enabled ? "Disable proxy target" : "Enable proxy target"}
            >
              {target.enabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
            </Button>
            <Button type="button" className="button-danger icon-button overview-icon-action" onClick={() => onDelete(target)} disabled={busy} title="Delete proxy target" aria-label="Delete">
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="proxy-target-detail-table-row">
          <td colSpan={8}>
            <div className="proxy-target-detail-grid">
              <span className="proxy-target-detail-item proxy-target-detail-item--wide">
                <span>WebSocket URL</span>
                <strong className="mono">{target.url}</strong>
              </span>
              <span className="proxy-target-detail-item">
                <span>Credentials</span>
                <strong>{target.hasUsername || target.hasBasicAuthPassword ? "Configured" : "None"}</strong>
              </span>
              <span className="proxy-target-detail-item">
                <span>Username</span>
                <strong>{target.hasUsername ? "Configured" : "None"}</strong>
              </span>
              <span className="proxy-target-detail-item">
                <span>Password</span>
                <strong>{target.hasBasicAuthPassword ? "Configured" : "None"}</strong>
              </span>
              <span className="proxy-target-detail-item">
                <span>Tag mappings</span>
                <strong>{formatTagMappingCount(target.tagMappings?.length ?? 0)}</strong>
              </span>
              <span className="proxy-target-detail-item proxy-target-detail-item--wide">
                <span>Mappings</span>
                <strong>{formatMappings(target.tagMappings)}</strong>
              </span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function formatMappings(mappings: ProxyTarget["tagMappings"]) {
  if (!mappings || mappings.length === 0) return "None";
  return mappings.map((mapping) => `${mapping.localIdTag} -> ${mapping.outboundIdTag}`).join(", ");
}
