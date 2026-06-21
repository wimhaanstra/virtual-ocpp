import { AlertTriangle, X } from "lucide-react";
import type { ChargerRegistryRow } from "../types";
import { Button } from "./ui/button";

type ChargerDeleteModalProps = {
  busy: boolean;
  charger: ChargerRegistryRow | null;
  adminPassword: string;
  confirmation: string;
  onAdminPasswordChange: (password: string) => void;
  onCancel: () => void;
  onConfirmationChange: (value: string) => void;
  onSubmit: () => void;
};

export function ChargerDeleteModal({
  busy,
  charger,
  adminPassword,
  confirmation,
  onAdminPasswordChange,
  onCancel,
  onConfirmationChange,
  onSubmit
}: ChargerDeleteModalProps) {
  if (!charger) return null;

  const canDelete = confirmation.trim() === charger.id && adminPassword.length > 0;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="charger-delete-modal-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Destructive action</p>
            <h2 id="charger-delete-modal-title">Delete charger</h2>
            <p className="status-copy">
              This removes <span className="mono">{charger.id}</span>. Use this only for retired hardware.
            </p>
          </div>
          <Button type="button" className="button-ghost" onClick={onCancel} disabled={busy} aria-label="Close charger delete modal">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="destructive-warning">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Deletes charger-owned data</strong>
            <p>Confirm the exact charger id and enter the admin password before deleting.</p>
          </div>
        </div>

        <form
          className="modal-section-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canDelete) return;
            onSubmit();
          }}
        >
          <section className="modal-form-section">
            <div className="destructive-confirm-row">
              <span>Required charger id</span>
              <strong className="mono">{charger.id}</strong>
            </div>
            <div className="form-grid modal-form-grid">
              <label className="field">
                <span>Admin password</span>
                <input
                  aria-label="Admin password"
                  value={adminPassword}
                  onChange={(event) => onAdminPasswordChange(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <label className="field">
                <span>Type exact charger id</span>
                <input
                  aria-label="Type exact charger id"
                  value={confirmation}
                  onChange={(event) => onConfirmationChange(event.target.value)}
                  placeholder={charger.id}
                  autoComplete="off"
                />
              </label>
            </div>
          </section>

          <div className="action-row modal-actions">
            <Button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" className="button-danger" disabled={busy || !canDelete}>
              Delete charger
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
