import { useState } from "react";
import { ShieldCheck, ShieldX } from "lucide-react";
import type { Tag } from "../types";
import { formatDateTime, getTagAccessForCharger, getTagUsageForCharger } from "../app-helpers";
import { ExpandableDataTable, type ExpandableDataTableColumn } from "./ExpandableDataTable";
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
  const expandedTagIds = new Set(expandedTagId ? [expandedTagId] : []);
  const columns: Array<ExpandableDataTableColumn<Tag>> = [
    {
      key: "tag",
      header: "Tag",
      render: (tag) => (
        <div className="session-table-primary">
          <strong className="table-truncate" title={tag.label || "Unlabeled"}>
            {tag.label || "Unlabeled"}
          </strong>
          <span className="mono table-truncate" title={tag.uuid}>
            {tag.uuid}
          </span>
        </div>
      )
    },
    {
      key: "last-used",
      header: "Last used",
      render: (tag) => formatDateTime(tag.lastUsedAt ?? null)
    },
    {
      key: "access",
      header: "Access",
      render: (tag) => {
        const allowed = getTagAccessForCharger(tag, selectedChargerId) === true;
        return <span className={`pill overview-status-pill ${allowed ? "pill-good" : "pill-warning"}`}>{allowed ? "Allowed" : "Blocked"}</span>;
      }
    },
    {
      key: "actions",
      headingClassName: "sessions-table__actions-heading",
      header: "Actions",
      cellClassName: "session-table-cell session-table-cell--actions",
      stopPropagation: true,
      render: (tag) => {
        const allowed = getTagAccessForCharger(tag, selectedChargerId) === true;
        return (
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
        );
      }
    }
  ];

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
        <ExpandableDataTable
          columns={columns}
          expandedRowIds={expandedTagIds}
          getRowDetailsLabel={(tag) => `tag ${tag.label || tag.uuid}`}
          getRowId={(tag) => tag.id}
          onToggleRow={(tagId) => setExpandedTagId(expandedTagId === tagId ? null : tagId)}
          renderExpandedRow={(tag) => <TagAccessDetails selectedChargerId={selectedChargerId} selectedChargerLabel={selectedChargerLabel} tag={tag} />}
          rows={tags}
        />
      )}
    </section>
  );
}

type TagAccessDetailsProps = {
  selectedChargerId: string;
  selectedChargerLabel: string;
  tag: Tag;
};

function TagAccessDetails({ selectedChargerId, selectedChargerLabel, tag }: TagAccessDetailsProps) {
  const selectedChargerUsage = getTagUsageForCharger(tag, selectedChargerId);

  return (
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
          <strong className="table-truncate" title={String(selectedChargerUsage?.lastUsedTransactionId ?? "-")}>
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
          <strong className="table-truncate" title={String(tag.lastUsedTransactionId ?? "-")}>
            {tag.lastUsedTransactionId ?? "-"}
          </strong>
        </span>
      </div>
    </div>
  );
}
