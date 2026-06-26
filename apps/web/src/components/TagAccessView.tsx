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
            <p className="status-copy">Select a charger context to grant or revoke access for its tags.</p>
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
        <div className="record-list registry-list tag-access-list">
          {tags.map((tag) => {
            const allowed = getTagAccessForCharger(tag, selectedChargerId);

            return (
              <article className="record-card registry-card tag-access-card" key={tag.id}>
                <div className="record-card__summary">
                  <div>
                    <div className="record-card__title">{tag.label || "Unlabeled"}</div>
                    <div className="record-card__subtitle mono">{tag.uuid}</div>
                  </div>
                  <div className="pill-stack">
                    <span className={`pill ${tag.enabled ? "pill-good" : "pill-warning"}`}>
                      {tag.enabled ? "Enabled" : "Disabled"}
                    </span>
                    <span className={`pill ${allowed ? "pill-good" : "pill-warning"}`}>
                      {allowed ? "Allowed" : "Blocked"}
                    </span>
                  </div>
                </div>
                <dl className="detail-grid compact-detail-grid">
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDateTime(tag.createdAt)}</dd>
                  </div>
                </dl>
                <div className="record-card__actions">
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
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
