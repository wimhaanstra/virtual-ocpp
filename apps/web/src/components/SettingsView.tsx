import { RefreshCcw, Sparkles } from "lucide-react";
import type { OnboardingSettings, OnboardingSettingsStatus, TimeFormatPreference } from "../types";
import { formatDateTime, getOnboardingState, getOnboardingStateLabel, getOnboardingStateTone } from "../app-helpers";
import { Button } from "./ui/button";

type SettingsViewProps = {
  busy: boolean;
  onboardingSettings: OnboardingSettings | null;
  onboardingSettingsStatus: OnboardingSettingsStatus;
  timeFormat: TimeFormatPreference;
  onRefreshOnboarding: () => void;
  onRunOnboarding: () => void;
  onTimeFormatChange: (value: TimeFormatPreference) => void;
};

export function SettingsView({
  busy,
  onboardingSettings,
  onboardingSettingsStatus,
  timeFormat,
  onRefreshOnboarding,
  onRunOnboarding,
  onTimeFormatChange
}: SettingsViewProps) {
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
