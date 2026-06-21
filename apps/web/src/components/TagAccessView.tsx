import { RefreshCcw, ShieldCheck, ShieldX } from "lucide-react";
import type { Tag } from "../types";
import { formatDateTime, getTagAccessForCharger } from "../app-helpers";
import { Button } from "./ui/button";

type TagAccessViewProps = {
  busy: boolean;
  selectedChargerId: string;
  selectedChargerLabel: string;
  tags: Tag[];
  onRefresh: () => void;
  onToggleAccess: (tag: Tag) => void;
};

export function TagAccessView({ busy, selectedChargerId, selectedChargerLabel, tags, onRefresh, onToggleAccess }: TagAccessViewProps) {
  if (!selectedChargerId) {
    return (
      <section className="panel table-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Authorization</p>
            <h2>Tag access</h2>
            <p className="status-copy">Select a charger context in the sidebar to grant or revoke access for its tags.</p>
          </div>
        </div>
        <p>No charger is selected.</p>
      </section>
    );
  }

  return (
    <section className="panel table-panel">
      <div className="topbar-actions page-section-header">
        <div>
          <p className="eyebrow">Authorization</p>
          <h2>Tag access</h2>
          <p className="status-copy">Grant or revoke existing global tags for {selectedChargerLabel}.</p>
        </div>
        <Button type="button" className="button-secondary icon-button" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
          <RefreshCcw aria-hidden="true" />
        </Button>
      </div>
      {tags.length === 0 ? (
        <p>No tags configured yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="mobile-card-table tag-access-table">
            <thead>
              <tr>
                <th>Tag UUID</th>
                <th>Label</th>
                <th>Global status</th>
                <th>Selected charger access</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const allowed = getTagAccessForCharger(tag, selectedChargerId);

                return (
                  <tr key={tag.id}>
                    <td className="mono" data-label="Tag UUID">{tag.uuid}</td>
                    <td data-label="Label">{tag.label || "Unlabeled"}</td>
                    <td data-label="Global status">
                      <span className={`pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>
                        {tag.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td data-label="Charger access">
                      <span className={`pill ${allowed ? "pill-good" : "pill-warning"}`}>
                        {allowed ? "Allowed" : "Blocked"}
                      </span>
                    </td>
                    <td data-label="Created">{formatDateTime(tag.createdAt)}</td>
                    <td data-label="Actions">
                      <Button
                        type="button"
                        className="button-secondary icon-button"
                        onClick={() => onToggleAccess(tag)}
                        disabled={busy}
                        title={allowed ? "Revoke access" : "Grant access"}
                        aria-label={allowed ? "Revoke access" : "Grant access"}
                      >
                        {allowed ? <ShieldX aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
