import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck, ShieldX } from "lucide-react";
import type { Tag } from "../types";
import { formatDateTime, getTagAccessForCharger, getTagUsageForCharger } from "../app-helpers";
import { Button } from "./ui/button";

type TagAccessViewProps = {
  busy: boolean;
  selectedChargerId: string;
  selectedChargerLabel: string;
  tags: Tag[];
  onToggleAccess: (tag: Tag) => void;
};

export function TagAccessView({ busy, selectedChargerId, selectedChargerLabel, tags, onToggleAccess }: TagAccessViewProps) {
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);
  const allowedCount = selectedChargerId ? tags.filter((tag) => getTagAccessForCharger(tag, selectedChargerId) === true).length : 0;

  if (!selectedChargerId) {
    return (
      <section className="tag-access-page">
        <div className="dashboard-section-header">
          <div>
            <p className="eyebrow">Authorization</p>
            <h2>Tag access</h2>
          </div>
        </div>
        <p className="dashboard-empty-state">No charger is selected.</p>
      </section>
    );
  }

  return (
    <section className="tag-access-page">
      <div className="dashboard-section-header">
        <div>
          <p className="eyebrow">Authorization</p>
          <h2>Tag access</h2>
        </div>
        <span className="tag-access-count-pill">
          {allowedCount}/{tags.length} allowed
        </span>
      </div>
      {tags.length === 0 ? (
        <p className="dashboard-empty-state">No tags configured yet.</p>
      ) : (
        <div className="sessions-table-wrap">
          <table className="sessions-table">
            <thead>
              <tr>
                <th aria-label="Expand tag access details" />
                <th>Tag</th>
                <th>Last used</th>
                <th>Access</th>
                <th className="sessions-table__actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const expanded = expandedTagId === tag.id;
                return (
                  <TagAccessTableRow
                    key={tag.id}
                    allowed={getTagAccessForCharger(tag, selectedChargerId) === true}
                    busy={busy}
                    expanded={expanded}
                    onToggleAccess={onToggleAccess}
                    onToggleExpanded={() => setExpandedTagId(expanded ? null : tag.id)}
                    selectedChargerId={selectedChargerId}
                    selectedChargerLabel={selectedChargerLabel}
                    tag={tag}
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

type TagAccessTableRowProps = {
  allowed: boolean;
  busy: boolean;
  expanded: boolean;
  selectedChargerId: string;
  selectedChargerLabel: string;
  tag: Tag;
  onToggleAccess: (tag: Tag) => void;
  onToggleExpanded: () => void;
};

function TagAccessTableRow({
  allowed,
  busy,
  expanded,
  selectedChargerId,
  selectedChargerLabel,
  tag,
  onToggleAccess,
  onToggleExpanded
}: TagAccessTableRowProps) {
  const selectedChargerUsage = getTagUsageForCharger(tag, selectedChargerId);

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
            title={expanded ? "Hide tag access details" : "Show tag access details"}
            aria-label={`${expanded ? "Hide" : "Show"} details for tag ${tag.label || tag.uuid}`}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </td>
        <td>
          <div className="session-table-primary">
            <strong className="table-truncate" title={tag.label || "Unlabeled"}>
              {tag.label || "Unlabeled"}
            </strong>
            <span className="mono table-truncate" title={tag.uuid}>
              {tag.uuid}
            </span>
          </div>
        </td>
        <td>{formatDateTime(tag.lastUsedAt ?? null)}</td>
        <td>
          <span className={`pill overview-status-pill ${allowed ? "pill-good" : "pill-warning"}`}>{allowed ? "Allowed" : "Blocked"}</span>
        </td>
        <td className="session-table-cell session-table-cell--actions" onClick={(event) => event.stopPropagation()}>
          <div className="dashboard-item__actions session-table-actions">
            <Button
              type="button"
              className="button-secondary icon-button overview-icon-action"
              onClick={() => onToggleAccess(tag)}
              disabled={busy}
              title={allowed ? "Revoke access" : "Grant access"}
              aria-label={allowed ? "Revoke access" : "Grant access"}
            >
              {allowed ? <ShieldX aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            </Button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="session-detail-table-row">
          <td colSpan={5}>
            <div className="session-detail-row">
              <div className="session-detail-grid">
                <span className="session-detail-item">
                  <span>Tag state</span>
                  <strong>
                    <span className={`pill overview-status-pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>{tag.enabled ? "Enabled" : "Disabled"}</span>
                  </strong>
                </span>
                <span className="session-detail-item">
                <span>Charger</span>
                  <strong className="table-truncate" title={selectedChargerLabel}>
                    {selectedChargerLabel}
                  </strong>
              </span>
                <span className="session-detail-item">
                <span>UUID</span>
                  <strong className="mono table-truncate" title={tag.uuid}>
                    {tag.uuid}
                  </strong>
              </span>
                <span className="session-detail-item">
                <span>Created</span>
                <strong>{formatDateTime(tag.createdAt)}</strong>
              </span>
                <span className="session-detail-item">
                <span>Last used here</span>
                <strong>{formatDateTime(selectedChargerUsage?.lastUsedAt ?? null)}</strong>
              </span>
                <span className="session-detail-item">
                <span>Last transaction here</span>
                  <strong className="table-truncate" title={selectedChargerUsage?.lastUsedTransactionId ?? "-"}>
                    {selectedChargerUsage?.lastUsedTransactionId ?? "-"}
                  </strong>
              </span>
                <span className="session-detail-item">
                <span>Last used globally</span>
                <strong>{formatDateTime(tag.lastUsedAt ?? null)}</strong>
              </span>
                <span className="session-detail-item">
                <span>Last charger globally</span>
                  <strong className="mono table-truncate" title={tag.lastUsedChargerId ?? "-"}>
                    {tag.lastUsedChargerId ?? "-"}
                  </strong>
              </span>
                <span className="session-detail-item">
                <span>Last transaction globally</span>
                  <strong className="table-truncate" title={tag.lastUsedTransactionId ?? "-"}>
                    {tag.lastUsedTransactionId ?? "-"}
                  </strong>
              </span>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
