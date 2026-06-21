import { useEffect } from "react";
import { CheckCircle2, Copy, Loader2, PlugZap, X } from "lucide-react";
import type { ChargerRegistryRow, DashboardConfig } from "../types";
import { getChargerContextId, getChargerDisplayLabel } from "../app-helpers";
import { Button } from "./ui/button";

type ChargerOnboardingModalProps = {
  busy: boolean;
  dashboardConfig: DashboardConfig | null;
  detectedCharger: ChargerRegistryRow | null;
  knownChargerCount: number;
  label: string;
  startedAt: string;
  onClose: () => void;
  onCopyUrl: (url: string) => void;
  onFinish: () => void;
  onLabelChange: (label: string) => void;
  onRefresh: () => void;
};

export function ChargerOnboardingModal({
  busy,
  dashboardConfig,
  detectedCharger,
  knownChargerCount,
  label,
  startedAt,
  onClose,
  onCopyUrl,
  onFinish,
  onLabelChange,
  onRefresh
}: ChargerOnboardingModalProps) {
  const activeChargerId = detectedCharger ? getChargerContextId(detectedCharger) : "";
  const connectionUrl = dashboardConfig?.ocppWebSocketUrl ?? "Loading connection URL...";
  const suggestedId = `charger-${new Date(startedAt).getTime().toString(36)}`;
  const exampleUrl = connectionUrl.includes(":chargerId") ? connectionUrl.replace(":chargerId", suggestedId) : connectionUrl;

  useEffect(() => {
    if (!startedAt) return;

    const refresh = () => {
      onRefresh();
    };

    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
    // Intentionally keyed only on the wizard session start; onRefresh is stable enough for this flow.
  }, [startedAt]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel modal-panel-wide charger-wizard" role="dialog" aria-modal="true" aria-labelledby="charger-wizard-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Charger onboarding</p>
            <h2 id="charger-wizard-title">Add charger</h2>
          </div>
          <Button type="button" className="button-ghost" onClick={onClose} disabled={busy} aria-label="Close charger wizard">
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="charger-wizard-grid">
          <section className="wizard-step">
            <div className="wizard-step__marker">1</div>
            <div>
              <h3>Configure the charger</h3>
              <p className="mono connection-url wizard-template-url">{connectionUrl}</p>
              <dl className="wizard-meta">
                <div>
                  <dt>Example</dt>
                  <dd className="copy-row">
                    <span className="mono">{exampleUrl}</span>
                    <Button type="button" className="button-secondary icon-button" onClick={() => onCopyUrl(exampleUrl)} disabled={busy || !dashboardConfig} aria-label="Copy example charger URL" title="Copy example charger URL">
                      <Copy aria-hidden="true" />
                    </Button>
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="wizard-step">
            <div className="wizard-step__marker">2</div>
            <div>
              <h3>Protocol and auth</h3>
              <dl className="wizard-meta">
                <div>
                  <dt>Protocol</dt>
                  <dd className="mono">{dashboardConfig?.ocppProtocol ?? "ocpp1.6"}</dd>
                </div>
                <div>
                  <dt>Basic Auth</dt>
                  <dd>{dashboardConfig?.ocppBasicAuthRequired ? dashboardConfig.ocppBasicAuthUsername ?? "charger id" : "Not required"}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="wizard-step wizard-step-full">
            <div className="wizard-step__marker">{detectedCharger ? <CheckCircle2 aria-hidden="true" /> : <Loader2 aria-hidden="true" className="spin-icon" />}</div>
            <div>
              <h3>{detectedCharger ? "Charger detected" : "Waiting for a new charger"}</h3>
              {detectedCharger ? (
                <div className="detected-charger-box">
                  <PlugZap aria-hidden="true" />
                  <div>
                    <p className="mono">{activeChargerId}</p>
                    <p className="status-copy">
                      {getChargerDisplayLabel(detectedCharger)}
                      {detectedCharger.active ? " is connected." : " was registered."}
                    </p>
                  </div>
                </div>
              ) : (
                <dl className="wizard-meta">
                  <div>
                    <dt>Known at start</dt>
                    <dd>{knownChargerCount}</dd>
                  </div>
                  <div>
                    <dt>Detection</dt>
                    <dd>Waiting for the next registry row</dd>
                  </div>
                </dl>
              )}
            </div>
          </section>

          <label className="field wizard-step-full">
            <span>Display label</span>
            <input value={label} onChange={(event) => onLabelChange(event.target.value)} placeholder={detectedCharger ? activeChargerId : "Garage charger"} disabled={!detectedCharger || busy} />
          </label>
        </div>

        <div className="action-row modal-actions">
          <Button type="button" className="button-secondary" onClick={onRefresh} disabled={busy}>
            Refresh
          </Button>
          <Button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onFinish} disabled={busy || !detectedCharger}>
            Save and switch
          </Button>
        </div>
      </section>
    </div>
  );
}
