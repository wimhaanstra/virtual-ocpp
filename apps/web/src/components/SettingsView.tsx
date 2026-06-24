import { RefreshCcw, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { CommunicationSettings, OnboardingSettings, OnboardingSettingsStatus, TimeFormatPreference } from "../types";
import { formatDateTime, getOnboardingState, getOnboardingStateLabel, getOnboardingStateTone } from "../app-helpers";
import { Button } from "./ui/button";

type SettingsViewProps = {
  busy: boolean;
  communicationSettings: CommunicationSettings | null;
  communicationSettingsStatus: OnboardingSettingsStatus;
  onboardingSettings: OnboardingSettings | null;
  onboardingSettingsStatus: OnboardingSettingsStatus;
  timeFormat: TimeFormatPreference;
  onCommunicationRetentionChange: (value: number) => void;
  onRefreshCommunicationSettings: () => void;
  onRefreshOnboarding: () => void;
  onRunOnboarding: () => void;
  onTimeFormatChange: (value: TimeFormatPreference) => void;
};

export function SettingsView({
  busy,
  communicationSettings,
  communicationSettingsStatus,
  onboardingSettings,
  onboardingSettingsStatus,
  timeFormat,
  onCommunicationRetentionChange,
  onRefreshCommunicationSettings,
  onRefreshOnboarding,
  onRunOnboarding,
  onTimeFormatChange
}: SettingsViewProps) {
  const [retentionDraft, setRetentionDraft] = useState("24");
  const onboardingState = getOnboardingState(onboardingSettings);
  const onboardingStateLabel = getOnboardingStateLabel(onboardingState);
  const onboardingStateTone = getOnboardingStateTone(onboardingState);
  const endpointLabel =
    onboardingSettingsStatus === "loading"
      ? "Loading"
      : onboardingSettingsStatus === "ready"
        ? "Connected"
        : onboardingSettingsStatus === "unavailable"
          ? "Unavailable"
          : onboardingSettingsStatus === "error"
            ? "Load failed"
            : "Idle";
  const communicationEndpointLabel =
    communicationSettingsStatus === "loading"
      ? "Loading"
      : communicationSettingsStatus === "ready"
        ? "Connected"
        : communicationSettingsStatus === "unavailable"
          ? "Unavailable"
          : communicationSettingsStatus === "error"
            ? "Load failed"
            : "Idle";
  const parsedRetention = Number(retentionDraft);
  const canSaveRetention = Number.isInteger(parsedRetention) && parsedRetention >= 1 && parsedRetention <= 8760 && parsedRetention !== communicationSettings?.retentionHours;

  useEffect(() => {
    if (communicationSettings) {
      setRetentionDraft(String(communicationSettings.retentionHours));
    }
  }, [communicationSettings]);

  return (
    <section className="settings-layout">
      <section className="panel settings-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Global preferences</p>
            <h2>Onboarding</h2>
            <p className="status-copy">Review setup state and rerun the onboarding flow when you want to test or repeat setup.</p>
          </div>
          <span className={`pill ${onboardingStateTone}`}>{onboardingStateLabel}</span>
        </div>

        <dl className="settings-status-grid">
          <div>
            <dt>State</dt>
            <dd>{onboardingStateLabel}</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd>{endpointLabel}</dd>
          </div>
          <div>
            <dt>Completed at</dt>
            <dd>{onboardingSettings?.completedAt ? formatDateTime(onboardingSettings.completedAt) : "-"}</dd>
          </div>
          <div>
            <dt>Skipped at</dt>
            <dd>{onboardingSettings?.skippedAt ? formatDateTime(onboardingSettings.skippedAt) : "-"}</dd>
          </div>
        </dl>
      </section>

      <section className="panel settings-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Communication</p>
            <h2>Journal retention</h2>
            <p className="status-copy">Choose how long redacted protocol communication rows are kept before automatic purge.</p>
          </div>
          <span className="pill pill-neutral">{communicationEndpointLabel}</span>
        </div>

        <dl className="settings-status-grid">
          <div>
            <dt>Current</dt>
            <dd>{communicationSettings?.retentionHours ?? 24} hours</dd>
          </div>
          <div>
            <dt>Default</dt>
            <dd>{communicationSettings?.defaultRetentionHours ?? 24} hours</dd>
          </div>
        </dl>

        <div className="settings-inline-form">
          <label className="field">
            <span>Retention hours</span>
            <input
              type="number"
              min={1}
              max={8760}
              step={1}
              value={retentionDraft}
              onChange={(event) => setRetentionDraft(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="action-row settings-action-row">
            <Button type="button" className="button-secondary" onClick={onRefreshCommunicationSettings} disabled={busy}>
              <RefreshCcw aria-hidden="true" />
              Refresh
            </Button>
            <Button type="button" onClick={() => onCommunicationRetentionChange(parsedRetention)} disabled={busy || !canSaveRetention}>
              <Save aria-hidden="true" />
              Save
            </Button>
          </div>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Display</p>
            <h2>Time format</h2>
            <p className="status-copy">Choose how timestamps are shown across dashboards, sessions, and communication rows.</p>
          </div>
        </div>

        <div className="segmented-control" role="radiogroup" aria-label="Time format">
          <button
            type="button"
            className={timeFormat === "24h" ? "active" : ""}
            role="radio"
            aria-checked={timeFormat === "24h"}
            onClick={() => onTimeFormatChange("24h")}
          >
            24 hour
          </button>
          <button
            type="button"
            className={timeFormat === "12h" ? "active" : ""}
            role="radio"
            aria-checked={timeFormat === "12h"}
            onClick={() => onTimeFormatChange("12h")}
          >
            12 hour
          </button>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Setup</p>
            <h2>Run onboarding</h2>
            <p className="status-copy">Open the guided charger setup flow without changing the stored onboarding status.</p>
          </div>
          <Sparkles aria-hidden="true" />
        </div>

        <p className="status-copy">
          Manual runs are useful for testing setup or adding another charger. The full first-run flow will use this same entry point.
        </p>

        <div className="action-row settings-action-row">
          <Button type="button" className="button-secondary" onClick={onRefreshOnboarding} disabled={busy}>
            <RefreshCcw aria-hidden="true" />
            Refresh status
          </Button>
          <Button type="button" onClick={onRunOnboarding} disabled={busy}>
            Run onboarding
          </Button>
        </div>
      </section>
    </section>
  );
}
