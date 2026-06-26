import WaInput from "@awesome.me/webawesome/dist/react/input/index.js";
import WaNumberInput from "@awesome.me/webawesome/dist/react/number-input/index.js";
import WaRadio from "@awesome.me/webawesome/dist/react/radio/index.js";
import WaRadioGroup from "@awesome.me/webawesome/dist/react/radio-group/index.js";
import { Building2, Copy, KeyRound, RefreshCcw, Save, Sparkles, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDateTime, getOnboardingState, getOnboardingStateLabel, getOnboardingStateTone } from "../app-helpers";
import type { AccountInvite, AccountMember, AccountMembership, ActiveView, CommunicationSettings, OnboardingSettings, OnboardingSettingsStatus, TimeFormatPreference } from "../types";
import { Button } from "./ui/button";

type SettingsViewProps = {
  accountInvites: AccountInvite[];
  accountMembers: AccountMember[];
  accountMemberships: AccountMembership[];
  activeTenantId: string;
  apiTokenCount: number;
  apiTokensStatus: OnboardingSettingsStatus;
  busy: boolean;
  currentUserId: string;
  communicationSettings: CommunicationSettings | null;
  communicationSettingsStatus: OnboardingSettingsStatus;
  onboardingSettings: OnboardingSettings | null;
  onboardingSettingsStatus: OnboardingSettingsStatus;
  timeFormat: TimeFormatPreference;
  onCommunicationRetentionChange: (value: number) => void;
  onNavigate: (view: ActiveView) => void;
  onPurgeExpiredCommunication: () => void;
  onRefreshCommunicationSettings: () => void;
  onRefreshOnboarding: () => void;
  onCreateInvite: (role: AccountMembership["role"]) => Promise<GeneratedInvite | null>;
  onCopyInvite: (value: string) => void;
  onRedeemInvite: (code: string) => void;
  onRemoveAccountMember: (memberId: string) => void;
  onRenameAccount: (name: string) => void;
  onRevokeAccountInvite: (inviteId: string) => void;
  onRunOnboarding: () => void;
  onSelectAccount: (tenantId: string) => void;
  onUpdateAccountMemberRole: (memberId: string, role: AccountMembership["role"]) => void;
  onTimeFormatChange: (value: TimeFormatPreference) => void;
};

type GeneratedInvite = {
  code: string;
  inviteUrl: string;
  role: AccountMembership["role"];
  expiresAt: string;
};

export function SettingsView({
  accountInvites,
  accountMembers,
  accountMemberships,
  activeTenantId,
  apiTokenCount,
  apiTokensStatus,
  busy,
  currentUserId,
  communicationSettings,
  communicationSettingsStatus,
  onboardingSettings,
  onboardingSettingsStatus,
  timeFormat,
  onCommunicationRetentionChange,
  onNavigate,
  onPurgeExpiredCommunication,
  onRefreshCommunicationSettings,
  onRefreshOnboarding,
  onCreateInvite,
  onCopyInvite,
  onRedeemInvite,
  onRemoveAccountMember,
  onRenameAccount,
  onRevokeAccountInvite,
  onRunOnboarding,
  onSelectAccount,
  onUpdateAccountMemberRole,
  onTimeFormatChange
}: SettingsViewProps) {
  const [retentionDraft, setRetentionDraft] = useState("24");
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [inviteRole, setInviteRole] = useState<AccountMembership["role"]>("viewer");
  const [generatedInvite, setGeneratedInvite] = useState<GeneratedInvite | null>(null);
  const [accountNameDraft, setAccountNameDraft] = useState("");
  const activeAccount = accountMemberships.find((membership) => membership.tenantId === activeTenantId) ?? null;
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
  const canSaveRetention =
    Number.isInteger(parsedRetention) && parsedRetention >= 1 && parsedRetention <= 8760 && parsedRetention !== communicationSettings?.retentionHours;
  const storage = communicationSettings?.storage ?? null;
  const lastPurge = communicationSettings?.lastPurge ?? null;
  const canPurgeExpired = purgeConfirmation.trim() === "PURGE";
  const tokenStatusLabel =
    apiTokensStatus === "loading"
      ? "Loading"
      : apiTokensStatus === "ready"
        ? "Connected"
        : apiTokensStatus === "unavailable"
          ? "Unavailable"
          : apiTokensStatus === "error"
            ? "Load failed"
            : "Idle";

  useEffect(() => {
    if (communicationSettings) {
      setRetentionDraft(String(communicationSettings.retentionHours));
    }
  }, [communicationSettings]);

  useEffect(() => {
    setAccountNameDraft(activeAccount?.tenantName ?? "");
  }, [activeAccount?.tenantName]);

  const onboardingDetails = [
    { label: "State", value: onboardingStateLabel },
    { label: "Endpoint", value: endpointLabel },
    { label: "Completed", value: onboardingSettings?.completedAt ? formatDateTime(onboardingSettings.completedAt) : "-" },
    { label: "Skipped", value: onboardingSettings?.skippedAt ? formatDateTime(onboardingSettings.skippedAt) : "-" }
  ];
  const retentionDetails = [
    { label: "Current", value: `${communicationSettings?.retentionHours ?? 24} hours` },
    { label: "Default", value: `${communicationSettings?.defaultRetentionHours ?? 24} hours` },
    { label: "Rows", value: storage?.rowCount ?? 0 },
    { label: "Oldest", value: storage?.oldestCreatedAt ? formatDateTime(storage.oldestCreatedAt) : "-" },
    { label: "Newest", value: storage?.newestCreatedAt ? formatDateTime(storage.newestCreatedAt) : "-" },
    { label: "Last purge", value: lastPurge ? formatDateTime(lastPurge.purgedAt) : "-" },
    { label: "Deleted", value: lastPurge ? lastPurge.deletedCount : "-" },
    { label: "Scope", value: lastPurge ? formatPurgeScope(lastPurge.scope) : "-" },
    { label: "Retention", value: lastPurge ? `${lastPurge.retentionHours} hours` : "-" }
  ];

  return (
    <section className="settings-layout settings-page">
      <section className="settings-section settings-section-general">
        <div className="dashboard-section-header settings-section-header">
          <div>
            <p className="eyebrow">Global preferences</p>
            <h2>General</h2>
          </div>
          <div className="dashboard-section-header__actions">
            <span className={`pill overview-status-pill ${onboardingStateTone}`}>{onboardingStateLabel}</span>
            <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={onRunOnboarding} disabled={busy}>
              <Sparkles aria-hidden="true" />
              Run onboarding
            </Button>
          </div>
        </div>

        <div className="settings-card-grid">
          <article className="settings-card">
            <div className="settings-card__header">
              <div>
                <h3>Time format</h3>
                <p>Used across dashboards, sessions, and communication rows.</p>
              </div>
            </div>
            <TimeFormatControl value={timeFormat} onChange={onTimeFormatChange} />
          </article>

          <article className="settings-card">
            <div className="settings-card__header">
              <div>
                <h3>Accounts</h3>
                <p>Switch between accounts or join one with an invite code.</p>
              </div>
              <Building2 aria-hidden="true" className="settings-card__icon" />
            </div>
            <div className="settings-account-list">
              {accountMemberships.length === 0 ? (
                <p className="settings-empty-note">No accounts are linked to this user.</p>
              ) : (
                accountMemberships.map((membership) => {
                  const isActive = membership.tenantId === activeTenantId;
                  return (
                    <div className="settings-account-row" key={membership.tenantId}>
                      <div>
                        <strong>{membership.tenantName}</strong>
                        <span>
                          {formatRole(membership.role)}
                          {isActive ? " · active" : ""}
                        </span>
                      </div>
                      <Button
                        type="button"
                        className="button-secondary compact-text-button overview-section-action"
                        onClick={() => onSelectAccount(membership.tenantId)}
                        disabled={busy || isActive}
                      >
                        Switch
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="settings-inline-form">
              <SettingsTextInput label="Active account name" value={accountNameDraft} disabled={busy || !activeAccount} onChange={setAccountNameDraft} />
              <div className="settings-action-row">
                <Button
                  type="button"
                  className="compact-text-button overview-section-action"
                  onClick={() => onRenameAccount(accountNameDraft)}
                  disabled={busy || !activeAccount || !accountNameDraft.trim() || accountNameDraft.trim() === activeAccount.tenantName}
                >
                  <Save aria-hidden="true" />
                  Rename
                </Button>
              </div>
            </div>
            <div className="settings-inline-form">
              <SettingsTextInput label="Invite code" value={joinInviteCode} disabled={busy} onChange={setJoinInviteCode} />
              <div className="settings-action-row">
                <Button
                  type="button"
                  className="compact-text-button overview-section-action"
                  onClick={() => {
                    onRedeemInvite(joinInviteCode);
                    setJoinInviteCode("");
                  }}
                  disabled={busy || !joinInviteCode.trim()}
                >
                  <KeyRound aria-hidden="true" />
                  Join account
                </Button>
              </div>
            </div>
            <div className="settings-invite-create">
              <SettingsSelectInput
                label="Invite role"
                value={inviteRole}
                disabled={busy}
                options={[
                  { value: "viewer", label: "Viewer" },
                  { value: "admin", label: "Admin" },
                  { value: "owner", label: "Owner" }
                ]}
                onChange={(value) => setInviteRole(value as AccountMembership["role"])}
              />
              <Button
                type="button"
                className="compact-text-button overview-section-action"
                onClick={async () => {
                  const invite = await onCreateInvite(inviteRole);
                  if (invite) setGeneratedInvite(invite);
                }}
                disabled={busy || !activeAccount}
              >
                <UserPlus aria-hidden="true" />
                Create invite
              </Button>
            </div>
            {generatedInvite ? (
              <div className="settings-generated-invite">
                <div>
                  <span>Invite link</span>
                  <strong>{generatedInvite.inviteUrl}</strong>
                </div>
                <div className="settings-action-row">
                  <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={() => onCopyInvite(generatedInvite.inviteUrl)} disabled={busy}>
                    <Copy aria-hidden="true" />
                    Copy link
                  </Button>
                  <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={() => onCopyInvite(generatedInvite.code)} disabled={busy}>
                    <KeyRound aria-hidden="true" />
                    Copy code
                  </Button>
                </div>
                <small>
                  {formatRole(generatedInvite.role)} invite expires {formatDateTime(generatedInvite.expiresAt)}.
                </small>
              </div>
            ) : null}
            <div className="settings-access-management">
              <div>
                <h4>Members</h4>
                <div className="settings-account-list">
                  {accountMembers.length === 0 ? (
                    <p className="settings-empty-note">No members found.</p>
                  ) : (
                    accountMembers.map((member) => {
                      const isCurrentUser = member.userId === currentUserId;
                      return (
                        <div className="settings-account-row settings-account-row--management" key={member.id}>
                          <div>
                            <strong>{member.username}</strong>
                            <span>
                              Joined {formatDateTime(member.createdAt)}
                              {isCurrentUser ? " · you" : ""}
                            </span>
                          </div>
                          <SettingsSelectInput
                            label={`Role for ${member.username}`}
                            value={member.role}
                            disabled={busy || isCurrentUser}
                            compact
                            options={[
                              { value: "viewer", label: "Viewer" },
                              { value: "admin", label: "Admin" },
                              { value: "owner", label: "Owner" }
                            ]}
                            onChange={(value) => onUpdateAccountMemberRole(member.id, value as AccountMembership["role"])}
                          />
                          <Button
                            type="button"
                            className="button-secondary icon-button overview-icon-action"
                            onClick={() => onRemoveAccountMember(member.id)}
                            disabled={busy || isCurrentUser}
                            aria-label={`Remove ${member.username}`}
                            title={isCurrentUser ? "You cannot remove your own membership" : `Remove ${member.username}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              <div>
                <h4>Pending invites</h4>
                <div className="settings-account-list">
                  {accountInvites.length === 0 ? (
                    <p className="settings-empty-note">No pending invites.</p>
                  ) : (
                    accountInvites.map((invite) => (
                      <div className="settings-account-row" key={invite.id}>
                        <div>
                          <strong>{formatRole(invite.role)}</strong>
                          <span>Expires {formatDateTime(invite.expiresAt)}</span>
                        </div>
                        <Button
                          type="button"
                          className="button-secondary compact-text-button overview-section-action"
                          onClick={() => onRevokeAccountInvite(invite.id)}
                          disabled={busy}
                          aria-label={`Revoke ${formatRole(invite.role)} invite`}
                          title={`Revoke ${formatRole(invite.role)} invite`}
                        >
                          <Trash2 aria-hidden="true" />
                          Revoke
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card__header">
              <div>
                <h3>Onboarding</h3>
                <p>Current setup state and wizard entry point.</p>
              </div>
              <Button
                type="button"
                className="button-secondary icon-button overview-icon-action"
                onClick={onRefreshOnboarding}
                disabled={busy}
                aria-label="Refresh status"
                title="Refresh status"
              >
                <RefreshCcw aria-hidden="true" />
              </Button>
            </div>
            <SettingsDetailList items={onboardingDetails} />
          </article>
        </div>
      </section>

      <section className="settings-section settings-section-tokens">
        <div className="dashboard-section-header settings-section-header">
          <div>
            <p className="eyebrow">API access</p>
            <h2>Tokens</h2>
          </div>
          <div className="dashboard-section-header__actions">
            <span className="pill overview-status-pill pill-neutral">{tokenStatusLabel}</span>
          </div>
        </div>

        <div className="settings-card-grid">
          <article className="settings-card">
            <div className="settings-card__header">
              <div>
                <h3>Token management</h3>
                <p>Create, rotate, and revoke API tokens on a dedicated page.</p>
              </div>
              <KeyRound aria-hidden="true" className="settings-card__icon" />
            </div>
            <SettingsDetailList items={[{ label: "Tokens", value: apiTokenCount }, { label: "Endpoint", value: tokenStatusLabel }]} />
            <div className="settings-action-row">
              <Button type="button" className="compact-text-button overview-section-action" onClick={() => onNavigate("Access tokens")} disabled={busy}>
                <KeyRound aria-hidden="true" />
                Manage tokens
              </Button>
            </div>
          </article>
        </div>
      </section>

      <section className="settings-section settings-section-communication">
        <div className="dashboard-section-header settings-section-header">
          <div>
            <p className="eyebrow">Communication</p>
            <h2>Journal retention</h2>
          </div>
          <div className="dashboard-section-header__actions">
            <span className="pill overview-status-pill pill-neutral">{communicationEndpointLabel}</span>
            <Button
              type="button"
              className="button-secondary icon-button overview-icon-action"
              onClick={onRefreshCommunicationSettings}
              disabled={busy}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCcw aria-hidden="true" />
            </Button>
          </div>
        </div>

        <SettingsPropertyTable items={retentionDetails} />

        <div className="settings-inline-form">
          <SettingsNumberInput label="Retention hours" value={retentionDraft} min={1} max={8760} step={1} disabled={busy} onChange={setRetentionDraft} />
          <div className="settings-action-row">
            <Button
              type="button"
              className="compact-text-button overview-section-action"
              onClick={() => onCommunicationRetentionChange(parsedRetention)}
              disabled={busy || !canSaveRetention}
            >
              <Save aria-hidden="true" />
              Save
            </Button>
          </div>
        </div>

        <div className="settings-danger-zone">
          <div>
            <strong>Purge expired rows</strong>
            <p>Deletes communication rows older than the current retention window.</p>
          </div>
          <SettingsTextInput label="Type PURGE to confirm" value={purgeConfirmation} disabled={busy} onChange={setPurgeConfirmation} />
          <Button
            type="button"
            className="button-danger compact-text-button overview-section-action"
            onClick={() => {
              onPurgeExpiredCommunication();
              setPurgeConfirmation("");
            }}
            disabled={busy || !canPurgeExpired}
          >
            <Trash2 aria-hidden="true" />
            Purge expired
          </Button>
        </div>
      </section>
    </section>
  );
}

function SettingsDetailList({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <dl className="settings-status-grid">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SettingsPropertyTable({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <dl className="settings-property-table">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SettingsNumberInput({
  disabled,
  label,
  max,
  min,
  onChange,
  step,
  value
}: {
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  step: number;
  value: string;
}) {
  if (import.meta.env.MODE === "test") {
    return (
      <label className="field settings-native-control">
        <span>{label}</span>
        <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      </label>
    );
  }

  return (
    <WaNumberInput
      className="settings-wa-control"
      disabled={disabled}
      label={label}
      max={max}
      min={min}
      step={step}
      value={value}
      onInput={(event) => onChange((event.currentTarget as HTMLElement & { value: string }).value)}
    />
  );
}

function SettingsTextInput({
  disabled,
  label,
  onChange,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  if (import.meta.env.MODE === "test") {
    return (
      <label className="field settings-native-control">
        <span>{label}</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      </label>
    );
  }

  return (
    <WaInput className="settings-wa-control" disabled={disabled} label={label} value={value} onInput={(event) => onChange((event.currentTarget as HTMLElement & { value: string }).value)} />
  );
}

function SettingsSelectInput({
  compact = false,
  disabled,
  label,
  onChange,
  options,
  value
}: {
  compact?: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className={`field settings-native-control${compact ? " settings-native-control--compact" : ""}`}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimeFormatControl({ onChange, value }: { onChange: (value: TimeFormatPreference) => void; value: TimeFormatPreference }) {
  if (import.meta.env.MODE === "test") {
    return (
      <div className="segmented-control settings-time-control" role="radiogroup" aria-label="Time format">
        <button type="button" className={value === "24h" ? "active" : ""} role="radio" aria-checked={value === "24h"} onClick={() => onChange("24h")}>
          24 hour
        </button>
        <button type="button" className={value === "12h" ? "active" : ""} role="radio" aria-checked={value === "12h"} onClick={() => onChange("12h")}>
          12 hour
        </button>
      </div>
    );
  }

  return (
    <WaRadioGroup
      className="settings-time-group"
      label="Time format"
      value={value}
      onInput={(event) => onChange((event.currentTarget as HTMLElement & { value: TimeFormatPreference }).value)}
    >
      <WaRadio value="24h">24 hour</WaRadio>
      <WaRadio value="12h">12 hour</WaRadio>
    </WaRadioGroup>
  );
}

function formatPurgeScope(scope: NonNullable<CommunicationSettings["lastPurge"]>["scope"]) {
  return scope === "retention" ? "Expired rows" : "Filtered rows";
}

function formatRole(role: AccountMembership["role"]) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
