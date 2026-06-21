import { Power, X } from "lucide-react";
import type { ChargingSession } from "../types";
import { formatDateTime } from "../app-helpers";
import { Button } from "./ui/button";

type RemoteStopConfirmModalProps = {
  busy: boolean;
  session: ChargingSession | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RemoteStopConfirmModal({ busy, session, onCancel, onConfirm }: RemoteStopConfirmModalProps) {
  if (!session) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="remote-stop-modal-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Remote stop</p>
            <h2 id="remote-stop-modal-title">Confirm RemoteStopTransaction</h2>
            <p className="status-copy">
              Transaction {session.transactionId} on charger {session.chargerId}.
            </p>
          </div>
          <Button type="button" className="button-ghost" onClick={onCancel} disabled={busy} aria-label="Close remote stop confirmation">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="force-close-summary">
          <div>
            <span>Connector</span>
            <strong>{session.connectorId}</strong>
          </div>
          <div>
            <span>Tag</span>
            <strong>{session.idTag || "None"}</strong>
          </div>
          <div>
            <span>Started</span>
            <strong>{formatDateTime(session.startedAt)}</strong>
          </div>
        </div>

        <div className="force-close-warning">
          <strong>Before sending</strong>
          <p>This sends RemoteStopTransaction to the charger. The local session and proxy sessions stay active until the charger reports StopTransaction.</p>
          <p>If the charger does not stop cleanly, use force close after reviewing the StopTransaction payload preview.</p>
        </div>

        <div className="action-row modal-actions">
          <Button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy}>
            <Power aria-hidden="true" />
            Send remote stop
          </Button>
        </div>
      </section>
    </div>
  );
}
