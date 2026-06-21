import { PowerOff, X } from "lucide-react";
import type { ForceClosePreview } from "../types";
import { formatDateTime, stringifyPayload } from "../app-helpers";
import { Button } from "./ui/button";

type ForceClosePreviewModalProps = {
  busy: boolean;
  forceCloseLoading: boolean;
  forceClosePreview: ForceClosePreview | null;
  onCancel: () => void;
  onExecute: () => void;
};

export function ForceClosePreviewModal({ busy, forceCloseLoading, forceClosePreview, onCancel, onExecute }: ForceClosePreviewModalProps) {
  if (!forceClosePreview) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel modal-panel-wide" role="dialog" aria-modal="true" aria-labelledby="force-close-modal-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Force close</p>
            <h2 id="force-close-modal-title">Review StopTransaction</h2>
            <p className="status-copy">
              Session {forceClosePreview.session.transactionId} on charger {forceClosePreview.session.chargerId}.
            </p>
          </div>
          <Button type="button" className="button-ghost" onClick={onCancel} disabled={busy} aria-label="Close force close preview">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="force-close-summary">
          <div>
            <span>Meter source</span>
            <strong>{forceClosePreview.meterSource}</strong>
          </div>
          <div>
            <span>Stop meter</span>
            <strong>{forceClosePreview.localStopTransaction.meterStop ?? "None"}</strong>
          </div>
          <div>
            <span>Timestamp</span>
            <strong>{forceClosePreview.localStopTransaction.timestamp ? formatDateTime(forceClosePreview.localStopTransaction.timestamp) : "None"}</strong>
          </div>
        </div>

        {forceClosePreview.latestMeterSample ? (
          <p className="status-copy">
            Latest meter sample: {forceClosePreview.latestMeterSample.meterWh} Wh at {formatDateTime(forceClosePreview.latestMeterSample.sampledAt)}.
          </p>
        ) : null}

        {forceClosePreview.warnings.length > 0 ? (
          <div className="force-close-warning">
            {forceClosePreview.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        <div className="force-close-payloads">
          <div>
            <p className="eyebrow">Local record</p>
            <pre className="communication-payload">{stringifyPayload(forceClosePreview.localStopTransaction)}</pre>
          </div>
          {forceClosePreview.proxyPayloads.map((entry) => (
            <div key={`${entry.proxyTargetId}-${entry.externalTransactionId}`}>
              <div className="force-close-payload-header">
                <div>
                  <p className="eyebrow">Proxy target</p>
                  <h3 title={entry.proxyTargetId}>{entry.proxyTargetName}</h3>
                </div>
                <span className={`pill ${entry.proxyTargetEnabled ? "pill-good" : "pill-warning"}`}>
                  {entry.proxyTargetEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <pre className="communication-payload">{stringifyPayload(entry.payload)}</pre>
            </div>
          ))}
        </div>

        <div className="action-row modal-actions">
          <Button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onExecute} disabled={busy || forceCloseLoading}>
            <PowerOff aria-hidden="true" />
            Force close
          </Button>
        </div>
      </section>
    </div>

  );
}
