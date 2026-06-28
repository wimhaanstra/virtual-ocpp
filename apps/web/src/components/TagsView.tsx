import { useState } from "react";
import { Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { formatDateTime } from "../app-helpers";
import type { Tag } from "../types";
import { ExpandableDataTable, type ExpandableDataTableColumn } from "./ExpandableDataTable";
import { Button } from "./ui/button";

type TagsViewProps = {
  busy: boolean;
  tags: Tag[];
  onCreateTag: () => void;
  onDeleteTag: (tag: Tag) => void;
  onEditTag: (tag: Tag) => void;
  onToggleTag: (tag: Tag) => void;
};

export function TagsView({ busy, tags, onCreateTag, onDeleteTag, onEditTag, onToggleTag }: TagsViewProps) {
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);
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
      key: "last-charger",
      header: "Last charger",
      render: (tag) => (
        <span className="mono table-truncate" title={tag.lastUsedChargerId ?? "-"}>
          {tag.lastUsedChargerId ?? "-"}
        </span>
      )
    },
    {
      key: "state",
      header: "State",
      render: (tag) => <span className={`pill overview-status-pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>{tag.enabled ? "Enabled" : "Disabled"}</span>
    },
    {
      key: "actions",
      headingClassName: "sessions-table__actions-heading",
      header: "Actions",
      cellClassName: "session-table-cell session-table-cell--actions",
      stopPropagation: true,
      render: (tag) => (
        <div className="dashboard-item__actions session-table-actions">
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={() => onEditTag(tag)} disabled={busy} title="Edit tag" aria-label="Edit">
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            type="button"
            className="button-secondary icon-button overview-icon-action"
            onClick={() => onToggleTag(tag)}
            disabled={busy}
            title={tag.enabled ? "Disable tag" : "Enable tag"}
            aria-label={tag.enabled ? "Disable" : "Enable"}
          >
            {tag.enabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
          </Button>
          <Button type="button" className="button-danger icon-button overview-icon-action" onClick={() => onDeleteTag(tag)} disabled={busy} title="Delete tag" aria-label="Delete">
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      )
    }
  ];

  return (
    <section className="tags-page">
      <div className="dashboard-section-header">
        <div>
          <p className="eyebrow">Global identity</p>
          <h2>Configured tags</h2>
        </div>
        <div className="dashboard-section-header__actions">
          <span className="tags-count-pill">{tags.length} tags</span>
          <Button type="button" className="icon-button overview-icon-action" onClick={onCreateTag} disabled={busy} title="Add tag" aria-label="Add tag">
            <Plus aria-hidden="true" />
          </Button>
        </div>
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
          renderExpandedRow={(tag) => <TagDetails tag={tag} />}
          rows={tags}
        />
      )}
    </section>
  );
}

function TagDetails({ tag }: { tag: Tag }) {
  const chargerAccessCount = getChargerAccessCount(tag);
  const chargerUsageCount = tag.chargerUsage?.length ?? 0;

  return (
    <div className="session-detail-row">
      <div className="session-detail-grid">
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
          <span>Allowed chargers</span>
          <strong>{chargerAccessCount}</strong>
        </span>
        <span className="session-detail-item">
          <span>Used chargers</span>
          <strong>{chargerUsageCount}</strong>
        </span>
        <span className="session-detail-item">
          <span>Last used</span>
          <strong>{formatDateTime(tag.lastUsedAt ?? null)}</strong>
        </span>
        <span className="session-detail-item">
          <span>Last charger</span>
          <strong className="mono table-truncate" title={tag.lastUsedChargerId ?? "-"}>
            {tag.lastUsedChargerId ?? "-"}
          </strong>
        </span>
        <span className="session-detail-item">
          <span>Last transaction</span>
          <strong className="table-truncate" title={String(tag.lastUsedTransactionId ?? "-")}>
            {tag.lastUsedTransactionId ?? "-"}
          </strong>
        </span>
        <span className="session-detail-item">
          <span>Charging state</span>
          <strong>{tag.enabled ? "Enabled" : "Disabled"}</strong>
        </span>
      </div>
    </div>
  );
}

function getChargerAccessCount(tag: Tag) {
  if (Array.isArray(tag.allowedChargerIds)) return tag.allowedChargerIds.length;
  if (Array.isArray(tag.chargerAccess)) return tag.chargerAccess.filter((entry) => entry.enabled).length;
  if (tag.chargerAccess && typeof tag.chargerAccess === "object") return Object.values(tag.chargerAccess).filter(Boolean).length;
  return 0;
}
