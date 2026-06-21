import { X } from "lucide-react";
import type { ChargerRegistryRow } from "../types";
import { Button } from "./ui/button";

type ChargerLabelModalProps = {
  busy: boolean;
  charger: ChargerRegistryRow | null;
  label: string;
  onCancel: () => void;
  onLabelChange: (label: string) => void;
  onSubmit: () => void;
};

export function ChargerLabelModal({ busy, charger, label, onCancel, onLabelChange, onSubmit }: ChargerLabelModalProps) {
  if (!charger) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="charger-label-modal-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Registry</p>
            <h2 id="charger-label-modal-title">Edit charger label</h2>
            <p className="status-copy">
              Renaming <span className="mono">{charger.id}</span>.
            </p>
          </div>
          <Button type="button" className="button-ghost" onClick={onCancel} disabled={busy} aria-label="Close charger label modal">
            <X aria-hidden="true" />
          </Button>
        </div>

        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}>
          <label className="field">
            <span>Label</span>
            <input
              aria-label="Label"
              value={label}
              onChange={(event) => onLabelChange(event.target.value)}
              placeholder="Garage charger"
              autoComplete="off"
            />
            <small>Leave it blank to clear the label and keep the charger id as the fallback display value.</small>
          </label>

          <div className="action-row modal-actions">
            <Button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save label
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
