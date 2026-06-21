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
        <Button type="button" onClick={onCreateTag} disabled={busy}>
          <Plus aria-hidden="true" />
          Add tag
        </Button>
      </div>
      {tags.length === 0 ? (
        <p>No tags configured yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tag UUID</th>
                <th>Label</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id}>
                  <td className="mono">{tag.uuid}</td>
                  <td>{tag.label || "Unlabeled"}</td>
                  <td>
                    <span className={`pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>
                      {tag.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>{formatDateTime(tag.createdAt)}</td>
                  <td>
                    <div className="action-row">
                      <Button type="button" className="button-secondary" onClick={() => onEditTag(tag)} disabled={busy}>
                        <Pencil aria-hidden="true" />
                        <span className="button-label">Edit</span>
                      </Button>
                      <Button type="button" onClick={() => onToggleTag(tag)} disabled={busy}>
                        {tag.enabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
                        <span className="button-label">{tag.enabled ? "Disable" : "Enable"}</span>
                      </Button>
                      <Button type="button" className="button-ghost" onClick={() => onDeleteTag(tag)} disabled={busy}>
                        <Trash2 aria-hidden="true" />
                        <span className="button-label">Delete</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
