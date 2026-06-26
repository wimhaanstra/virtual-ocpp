import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { formatDateTime } from "../app-helpers";
import type { Tag } from "../types";
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
        <div className="tags-table-wrap">
          <table className="tags-table">
            <thead>
              <tr>
                <th aria-label="Expand tag details" />
                <th>Tag</th>
                <th>Last used</th>
                <th>Last charger</th>
                <th>State</th>
                <th className="tags-table__actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const expanded = expandedTagId === tag.id;
                return (
                  <TagTableRow
                    busy={busy}
                    expanded={expanded}
                    key={tag.id}
                    onDeleteTag={onDeleteTag}
                    onEditTag={onEditTag}
                    onToggleExpanded={() => setExpandedTagId(expanded ? null : tag.id)}
                    onToggleTag={onToggleTag}
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

type TagTableRowProps = {
  busy: boolean;
  expanded: boolean;
  tag: Tag;
  onDeleteTag: (tag: Tag) => void;
  onEditTag: (tag: Tag) => void;
  onToggleExpanded: () => void;
  onToggleTag: (tag: Tag) => void;
};

function TagTableRow({ busy, expanded, onDeleteTag, onEditTag, onToggleExpanded, onToggleTag, tag }: TagTableRowProps) {
  const chargerAccessCount = getChargerAccessCount(tag);
  const chargerUsageCount = tag.chargerUsage?.length ?? 0;

  return (
    <>
      <tr
        className="tags-table-row"
        tabIndex={0}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
      >
        <td className="tags-table-cell tags-table-cell--expand">
          <Button
            type="button"
            className="button-secondary icon-button overview-icon-action"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded();
            }}
            title={expanded ? "Hide tag details" : "Show tag details"}
            aria-label={`${expanded ? "Hide" : "Show"} details for tag ${tag.label || tag.uuid}`}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </td>
        <td>
          <div className="tags-table-primary">
            <strong>{tag.label || "Unlabeled"}</strong>
            <span className="mono">{tag.uuid}</span>
          </div>
        </td>
        <td>{formatDateTime(tag.lastUsedAt ?? null)}</td>
        <td className="mono">{tag.lastUsedChargerId ?? "-"}</td>
        <td>
          <span className={`pill overview-status-pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>{tag.enabled ? "Enabled" : "Disabled"}</span>
        </td>
        <td className="tags-table-cell tags-table-cell--actions" onClick={(event) => event.stopPropagation()}>
          <div className="dashboard-item__actions tags-table-actions">
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
        </td>
      </tr>
      {expanded ? (
        <tr className="tags-detail-table-row">
          <td colSpan={6}>
            <div className="tags-detail-grid">
              <span className="tags-detail-item">
                <span>UUID</span>
                <strong className="mono">{tag.uuid}</strong>
              </span>
              <span className="tags-detail-item">
                <span>Created</span>
                <strong>{formatDateTime(tag.createdAt)}</strong>
              </span>
              <span className="tags-detail-item">
                <span>Allowed chargers</span>
                <strong>{chargerAccessCount}</strong>
              </span>
              <span className="tags-detail-item">
                <span>Used chargers</span>
                <strong>{chargerUsageCount}</strong>
              </span>
              <span className="tags-detail-item">
                <span>Last used</span>
                <strong>{formatDateTime(tag.lastUsedAt ?? null)}</strong>
              </span>
              <span className="tags-detail-item">
                <span>Last charger</span>
                <strong className="mono">{tag.lastUsedChargerId ?? "-"}</strong>
              </span>
              <span className="tags-detail-item">
                <span>Last transaction</span>
                <strong>{tag.lastUsedTransactionId ?? "-"}</strong>
              </span>
              <span className="tags-detail-item">
                <span>Charging state</span>
                <strong>{tag.enabled ? "Enabled" : "Disabled"}</strong>
              </span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function getChargerAccessCount(tag: Tag) {
  if (Array.isArray(tag.allowedChargerIds)) return tag.allowedChargerIds.length;
  if (Array.isArray(tag.chargerAccess)) return tag.chargerAccess.filter((entry) => entry.enabled).length;
  if (tag.chargerAccess && typeof tag.chargerAccess === "object") return Object.values(tag.chargerAccess).filter(Boolean).length;
  return 0;
}
