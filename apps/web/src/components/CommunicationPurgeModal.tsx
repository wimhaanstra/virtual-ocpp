import { Trash2, X } from "lucide-react";
import type { CommunicationJournalFilters } from "../types";
import { Button } from "./ui/button";

type CommunicationPurgeScope = "retention" | "filters";

type CommunicationPurgeModalProps = {
  busy: boolean;
  confirmation: string;
  filters: CommunicationJournalFilters;
  retentionHours: number | null;
  scope: CommunicationPurgeScope;
  selectedChargerLabel: string;
  onCancel: () => void;
  onConfirmationChange: (value: string) => void;
  onConfirm: () => void;
  onScopeChange: (scope: CommunicationPurgeScope) => void;
};

export function CommunicationPurgeModal({
  busy,
  confirmation,
  filters,
  retentionHours,
  scope,
  selectedChargerLabel,
  onCancel,
  onConfirmationChange,
  onConfirm,
  onScopeChange
}: CommunicationPurgeModalProps) {
  const explicitFilterCount = countExplicitFilters(filters);
  const canPurgeFilters = explicitFilterCount > 0 || Boolean(selectedChargerLabel);
  const canConfirm = scope === "retention" || (canPurgeFilters && confirmation.trim() === "PURGE");

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="communication-purge-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Communication</p>
            <h2 id="communication-purge-title">Purge journal rows</h2>
            <p className="status-copy">Automatic retention stays configured at {retentionHours ?? 24} hours.</p>
          </div>
          <Button type="button" className="button-ghost" onClick={onCancel} disabled={busy} aria-label="Close communication purge">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="modal-form-grid">
          <label className="field checkbox-field">
            <input
              type="radio"
              checked={scope === "retention"}
              onChange={() => onScopeChange("retention")}
              disabled={busy}
            />
            <span>Purge expired rows outside retention</span>
          </label>
          <label className="field checkbox-field">
            <input
              type="radio"
              checked={scope === "filters"}
              onChange={() => onScopeChange("filters")}
              disabled={busy || !canPurgeFilters}
            />
            <span>Purge rows matching current filters</span>
          </label>
        </div>

        {scope === "filters" ? (
          <div className="force-close-warning">
            <strong>Filtered purge requires confirmation</strong>
            <p>
              Current scope: {selectedChargerLabel || "all chargers"}, {explicitFilterCount} extra filter{explicitFilterCount === 1 ? "" : "s"}.
            </p>
            <label className="field">
              <span>Type PURGE</span>
              <input value={confirmation} onChange={(event) => onConfirmationChange(event.target.value)} disabled={busy || !canPurgeFilters} />
            </label>
          </div>
        ) : null}

        <div className="action-row modal-actions">
          <Button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" className="button-danger" onClick={onConfirm} disabled={busy || !canConfirm}>
            <Trash2 aria-hidden="true" />
            Purge
          </Button>
        </div>
      </section>
    </div>
  );
}

function countExplicitFilters(filters: CommunicationJournalFilters) {
  return Object.values(filters).filter((value) => value.trim().length > 0).length;
}
