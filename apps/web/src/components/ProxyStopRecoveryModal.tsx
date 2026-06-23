import { Send, X } from "lucide-react";
import type { ChargingSession, ProxyStopRecoveryPreview, ProxyStopRecoverySuggestion, ProxyTarget } from "../types";
import { formatDateTime, getMeterSourceLabel, stringifyPayload } from "../app-helpers";
import { Button } from "./ui/button";

type ProxyStopRecoveryModalProps = {
  busy: boolean;
  externalTransactionId: string;
  loading: boolean;
  preview: ProxyStopRecoveryPreview | null;
  proxyTargetId: string;
  proxyTargets: ProxyTarget[];
  session: ChargingSession | null;
  suggestion: ProxyStopRecoverySuggestion | null;
  onCancel: () => void;
  onExternalTransactionIdChange: (value: string) => void;
  onPreview: () => void;
  onProxyTargetChange: (proxyTargetId: string) => void;
  onSubmit: () => void;
};

export function ProxyStopRecoveryModal({
  busy,
  externalTransactionId,
  loading,
  preview,
  proxyTargetId,
  proxyTargets,
  session,
  suggestion,
  onCancel,
  onExternalTransactionIdChange,
  onPreview,
  onProxyTargetChange,
  onSubmit
}: ProxyStopRecoveryModalProps) {
  if (!session) return null;

  const canPreview = proxyTargetId.trim().length > 0 && Number.isInteger(Number(externalTransactionId)) && Number(externalTransactionId) > 0;
  const selectedTarget = proxyTargets.find((target) => target.id === proxyTargetId) ?? null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel modal-panel-wide" role="dialog" aria-modal="true" aria-labelledby="proxy-stop-recovery-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Proxy recovery</p>
            <h2 id="proxy-stop-recovery-title">Recover proxy stop</h2>
            <p className="status-copy">
              Session {session.transactionId} on charger {session.chargerId}.
            </p>
          </div>
          <Button type="button" className="button-ghost" onClick={onCancel} disabled={busy} aria-label="Close proxy stop recovery">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="modal-form-grid">
          <label className="field">
            <span>Proxy target</span>
            <select value={proxyTargetId} onChange={(event) => onProxyTargetChange(event.target.value)} disabled={busy || proxyTargets.length === 0}>
              <option value="">Select proxy target</option>
              {proxyTargets.map((target) => (
                <option value={target.id} key={target.id}>
                  {target.name}{target.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Upstream transaction ID</span>
            <input inputMode="numeric" value={externalTransactionId} onChange={(event) => onExternalTransactionIdChange(event.target.value)} placeholder="10084" disabled={busy} />
            {suggestion?.predictedExternalTransactionId ? (
              <small>
                Predicted {suggestion.predictedExternalTransactionId} from last known upstream transaction{" "}
                {suggestion.lastKnownExternalTransactionId ?? "unknown"}.
              </small>
            ) : (
              <small>No prediction available for this proxy target yet.</small>
            )}
          </label>
        </div>

        <div className="force-close-warning">
          <strong>What this does</strong>
          <p>This sends one StopTransaction to the selected proxy target. It does not change the local session, which is already stopped.</p>
          {selectedTarget ? <p>Selected target: {selectedTarget.name}</p> : null}
        </div>

        {preview ? (
          <>
            <div className="force-close-summary">
              <div>
                <span>Meter source</span>
                <strong>{getMeterSourceLabel(preview.meterSource)}</strong>
              </div>
              <div>
                <span>Stop meter</span>
                <strong>{String(preview.payload.meterStop ?? "None")}</strong>
              </div>
              <div>
                <span>Timestamp</span>
                <strong>{typeof preview.payload.timestamp === "string" ? formatDateTime(preview.payload.timestamp) : "None"}</strong>
              </div>
            </div>

            {preview.warnings.length > 0 ? (
              <div className="force-close-warning">
                <strong>Review warnings</strong>
                {preview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="force-close-payloads">
              <div>
                <div className="force-close-payload-header">
                  <div>
                    <p className="eyebrow">Proxy target</p>
                    <h3 title={preview.proxyTarget.id}>{preview.proxyTarget.name}</h3>
                    <p className="status-copy">External transaction {preview.externalTransactionId}</p>
                  </div>
                  <span className={`pill ${preview.proxyTarget.enabled ? "pill-good" : "pill-warning"}`}>
                    {preview.proxyTarget.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <pre className="communication-payload">{stringifyPayload(preview.payload)}</pre>
              </div>
            </div>
          </>
        ) : null}

        <div className="action-row modal-actions">
          <Button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" className="button-secondary" onClick={onPreview} disabled={busy || loading || !canPreview}>
            Preview
          </Button>
          <Button type="button" onClick={onSubmit} disabled={busy || loading || !preview}>
            <Send aria-hidden="true" />
            Send stop
          </Button>
        </div>
      </section>
    </div>
  );
}
