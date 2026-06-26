import { Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import type { Tag } from "../types";
import { formatDateTime } from "../app-helpers";
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
  return (
    <section className="panel table-panel">
      <div className="topbar-actions page-section-header">
        <div>
          <p className="eyebrow">Global identity</p>
          <h2>Configured tags</h2>
          <p className="status-copy">Tag access is managed on the charger-scoped Tag access page.</p>
        </div>
        <Button
          type="button"
          className="button-secondary icon-button"
          onClick={onCreateTag}
          disabled={busy}
          title="Add tag"
          aria-label="Add tag"
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      {tags.length === 0 ? (
        <p>No tags configured yet.</p>
      ) : (
        <div className="record-list registry-list tag-list">
          {tags.map((tag) => (
            <article className="record-card registry-card tag-card" key={tag.id}>
              <div className="record-card__summary">
                <div>
                  <div className="record-card__title">{tag.label || "Unlabeled"}</div>
                  <div className="record-card__subtitle mono">{tag.uuid}</div>
                </div>
                <span className={`pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>
                  {tag.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <dl className="detail-grid compact-detail-grid">
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(tag.createdAt)}</dd>
                </div>
              </dl>
              <div className="record-card__actions">
                <div className="action-row compact-action-row">
                  <Button
                    type="button"
                    className="button-secondary icon-button"
                    onClick={() => onEditTag(tag)}
                    disabled={busy}
                    title="Edit tag"
                    aria-label="Edit"
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    className="icon-button"
                    onClick={() => onToggleTag(tag)}
                    disabled={busy}
                    title={tag.enabled ? "Disable tag" : "Enable tag"}
                    aria-label={tag.enabled ? "Disable" : "Enable"}
                  >
                    {tag.enabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
                  </Button>
                  <Button
                    type="button"
                    className="button-ghost icon-button"
                    onClick={() => onDeleteTag(tag)}
                    disabled={busy}
                    title="Delete tag"
                    aria-label="Delete"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
