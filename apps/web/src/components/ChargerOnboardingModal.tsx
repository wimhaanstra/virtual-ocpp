import { useEffect } from "react";
import { CheckCircle2, Copy, Loader2, PlugZap, X } from "lucide-react";
import type { ChargerRegistryRow, DashboardConfig, ProxyTarget, Tag } from "../types";
import { getChargerContextId, getChargerDisplayLabel } from "../app-helpers";
import { Button } from "./ui/button";

type OnboardingTagMode = "skip" | "existing" | "create";

type OnboardingProxyDraft = {
  enabled: boolean;
  name: string;
  url: string;
  username: string;
  basicAuthPassword: string;
  stationId: string;
  mode: ProxyTarget["mode"];
  outagePolicy: ProxyTarget["outagePolicy"];
};

type ChargerOnboardingModalProps = {
  busy: boolean;
  dashboardConfig: DashboardConfig | null;
  detectedCharger: ChargerRegistryRow | null;
  knownChargerCount: number;
  label: string;
  proxyDraft: OnboardingProxyDraft;
  showSetupSteps?: boolean;
  startedAt: string;
  tagLabel: string;
  tagMode: OnboardingTagMode;
  tagUuid: string;
  tags: Tag[];
  selectedTagId: string;
  onClose: () => void;
  onCopyUrl: (url: string) => void;
  onFinish: () => void;
  onLabelChange: (label: string) => void;
  onProxyDraftChange: (patch: Partial<OnboardingProxyDraft>) => void;
  onRefresh: () => void;
  onSelectedTagChange: (tagId: string) => void;
  onTagDraftChange: (patch: { mode?: OnboardingTagMode; uuid?: string; label?: string }) => void;
};

export function ChargerOnboardingModal({
  busy,
  dashboardConfig,
  detectedCharger,
  knownChargerCount,
  label,
  proxyDraft,
  showSetupSteps = false,
  startedAt,
  tagLabel,
  tagMode,
  tagUuid,
  tags,
  selectedTagId,
  onClose,
  onCopyUrl,
  onFinish,
  onLabelChange,
  onProxyDraftChange,
  onRefresh,
  onSelectedTagChange,
  onTagDraftChange
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

          {showSetupSteps ? (
            <>
              <section className="wizard-step wizard-step-full">
                <div className="wizard-step__marker">4</div>
                <div className="onboarding-section-stack">
                  <div>
                    <h3>Charging tag</h3>
                    <p className="status-copy">Create or select the tag that should be allowed to charge on this charger.</p>
                  </div>
                  <div className="segmented-row" role="group" aria-label="Tag setup mode">
                    <Button type="button" className={tagMode === "skip" ? undefined : "button-secondary"} onClick={() => onTagDraftChange({ mode: "skip" })} disabled={busy}>
                      Skip
                    </Button>
                    <Button type="button" className={tagMode === "existing" ? undefined : "button-secondary"} onClick={() => onTagDraftChange({ mode: "existing" })} disabled={busy || tags.length === 0}>
                      Existing
                    </Button>
                    <Button type="button" className={tagMode === "create" ? undefined : "button-secondary"} onClick={() => onTagDraftChange({ mode: "create" })} disabled={busy}>
                      Create
                    </Button>
                  </div>
                  {tagMode === "existing" ? (
                    <label className="field">
                      <span>Existing tag</span>
                      <select value={selectedTagId} onChange={(event) => onSelectedTagChange(event.target.value)} disabled={busy || tags.length === 0}>
                        <option value="">Select tag</option>
                        {tags.map((tag) => (
                          <option value={tag.id} key={tag.id}>
                            {tag.label?.trim() ? `${tag.label} (${tag.uuid})` : tag.uuid}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {tagMode === "create" ? (
                    <div className="modal-form-grid">
                      <label className="field">
                        <span>Tag ID</span>
                        <input value={tagUuid} onChange={(event) => onTagDraftChange({ uuid: event.target.value })} placeholder="4227105" disabled={busy} />
                      </label>
                      <label className="field">
                        <span>Label</span>
                        <input value={tagLabel} onChange={(event) => onTagDraftChange({ label: event.target.value })} placeholder="Primary charging tag" disabled={busy} />
                      </label>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="wizard-step wizard-step-full">
                <div className="wizard-step__marker">5</div>
                <div className="onboarding-section-stack">
                  <div>
                    <h3>Proxy target</h3>
                    <p className="status-copy">Optionally connect this charger to its first upstream OCPP platform.</p>
                  </div>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={proxyDraft.enabled} onChange={(event) => onProxyDraftChange({ enabled: event.target.checked })} disabled={busy} />
                    <span>Create a proxy target during onboarding</span>
                  </label>
                  {proxyDraft.enabled ? (
                    <div className="modal-form-grid">
                      <label className="field">
                        <span>Name</span>
                        <input value={proxyDraft.name} onChange={(event) => onProxyDraftChange({ name: event.target.value })} placeholder="Tap Electric" disabled={busy} />
                      </label>
                      <label className="field">
                        <span>URL</span>
                        <input value={proxyDraft.url} onChange={(event) => onProxyDraftChange({ url: event.target.value })} placeholder="wss://example.com/ocpp" disabled={busy} />
                      </label>
                      <label className="field">
                        <span>Username</span>
                        <input value={proxyDraft.username} onChange={(event) => onProxyDraftChange({ username: event.target.value })} placeholder="Optional" disabled={busy} />
                      </label>
                      <label className="field">
                        <span>Password</span>
                        <input type="password" value={proxyDraft.basicAuthPassword} onChange={(event) => onProxyDraftChange({ basicAuthPassword: event.target.value })} placeholder="Optional" disabled={busy} />
                      </label>
                      <label className="field">
                        <span>Station ID</span>
                        <input value={proxyDraft.stationId} onChange={(event) => onProxyDraftChange({ stationId: event.target.value })} placeholder={activeChargerId || "Use charger id"} disabled={busy} />
                      </label>
                      <label className="field">
                        <span>Mode</span>
                        <select value={proxyDraft.mode} onChange={(event) => onProxyDraftChange({ mode: event.target.value as ProxyTarget["mode"] })} disabled={busy}>
                          <option value="monitor-only">Monitor only</option>
                          <option value="deny-capable">Deny capable</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Outage policy</span>
                        <select value={proxyDraft.outagePolicy} onChange={(event) => onProxyDraftChange({ outagePolicy: event.target.value as ProxyTarget["outagePolicy"] })} disabled={busy}>
                          <option value="fail-open">Fail open</option>
                          <option value="fail-closed">Fail closed</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
        </div>

        <div className="action-row modal-actions">
          <Button type="button" className="button-secondary" onClick={onRefresh} disabled={busy}>
            Refresh
          </Button>
          <Button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onFinish} disabled={busy || !detectedCharger}>
            {showSetupSteps ? "Complete setup" : "Save and switch"}
          </Button>
        </div>
      </section>
    </div>
  );
}
