import { ArrowLeft, ArrowRight, Check, Copy, KeyRound, RefreshCcw, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "../app-helpers";
import type { ApiToken, ApiTokenScope, CreatedApiToken, OnboardingSettingsStatus } from "../types";
import { Button } from "./ui/button";

type TokenWizardStep = "name" | "scope" | "expiration" | "token";
type TokenExpiryOption = "30" | "60" | "90" | "infinite";

const tokenWizardSteps: Array<{ id: TokenWizardStep; label: string }> = [
  { id: "name", label: "Name" },
  { id: "scope", label: "Access" },
  { id: "expiration", label: "Expiry" },
  { id: "token", label: "Token" }
];

const tokenWizardCopy: Record<TokenWizardStep, { title: string; body: string }> = {
  name: {
    title: "Name this token",
    body: "Use a clear name that identifies the tool or person using this token."
  },
  scope: {
    title: "Choose access",
    body: "Read-only is enough for diagnostics. Read-write can change chargers, tags, proxy targets, and settings."
  },
  expiration: {
    title: "Set an expiry",
    body: "Short-lived tokens are easier to rotate. Leave expiry off only for trusted long-running integrations."
  },
  token: {
    title: "Copy the token",
    body: "This is the only time the secret is shown. Closing this wizard removes it from the interface."
  }
};

type AccessTokensViewProps = {
  apiTokens: ApiToken[];
  apiTokensStatus: OnboardingSettingsStatus;
  busy: boolean;
  onCopyToken: (value: string) => void;
  onCreateToken: (input: { name: string; scope: ApiTokenScope; expiresAt: string | null }) => Promise<CreatedApiToken | null>;
  onRefresh: () => void;
  onRevoke: (tokenId: string) => void;
  onRotate: (tokenId: string) => Promise<CreatedApiToken | null>;
  onBackToSettings: () => void;
};

export function AccessTokensView({
  apiTokens,
  apiTokensStatus,
  busy,
  onBackToSettings,
  onCopyToken,
  onCreateToken,
  onRefresh,
  onRevoke,
  onRotate
}: AccessTokensViewProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<TokenWizardStep>("name");
  const [tokenName, setTokenName] = useState("");
  const [tokenScope, setTokenScope] = useState<ApiTokenScope>("read_only");
  const [tokenExpiryOption, setTokenExpiryOption] = useState<TokenExpiryOption>("30");
  const [createdToken, setCreatedToken] = useState<CreatedApiToken | null>(null);
  const [rotatedToken, setRotatedToken] = useState<CreatedApiToken | null>(null);

  const statusLabel = formatEndpointStatus(apiTokensStatus);
  const tokenExpiryIso = getExpiryIso(tokenExpiryOption);

  const closeWizard = () => {
    setWizardOpen(false);
    setWizardStep("name");
    setTokenName("");
    setTokenScope("read_only");
    setTokenExpiryOption("30");
    setCreatedToken(null);
  };

  const createToken = async () => {
    const token = await onCreateToken({
      name: tokenName.trim(),
      scope: tokenScope,
      expiresAt: tokenExpiryIso
    });
    if (!token) return;

    setCreatedToken(token);
    setWizardStep("token");
  };

  const rotateToken = async (tokenId: string) => {
    const token = await onRotate(tokenId);
    if (token) setRotatedToken(token);
  };

  return (
    <section className="settings-layout access-token-page">
      <section className="settings-section">
        <div className="dashboard-section-header settings-section-header">
          <div>
            <p className="eyebrow">API access</p>
            <h2>Access tokens</h2>
          </div>
          <div className="dashboard-section-header__actions">
            <span className="pill overview-status-pill pill-neutral">{statusLabel}</span>
            <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={onBackToSettings} disabled={busy}>
              <ArrowLeft aria-hidden="true" />
              Settings
            </Button>
            <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onRefresh} disabled={busy} aria-label="Refresh tokens" title="Refresh tokens">
              <RefreshCcw aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="settings-action-row access-token-toolbar">
          <Button type="button" className="compact-text-button overview-section-action" onClick={() => setWizardOpen(true)} disabled={busy || wizardOpen}>
            <KeyRound aria-hidden="true" />
            Create token
          </Button>
        </div>

        {wizardOpen ? (
          <TokenWizard
            busy={busy}
            createdToken={createdToken}
            step={wizardStep}
            tokenExpiryOption={tokenExpiryOption}
            tokenName={tokenName}
            tokenScope={tokenScope}
            onClose={closeWizard}
            onCopy={onCopyToken}
            onCreate={() => void createToken()}
            onExpiryOptionChange={setTokenExpiryOption}
            onNameChange={setTokenName}
            onScopeChange={setTokenScope}
            onStepChange={setWizardStep}
          />
        ) : null}

        {rotatedToken ? (
          <article className="settings-card access-token-secret-panel">
            <div className="settings-card__header">
              <div>
                <h3>Rotated token</h3>
                <p>Copy this replacement token now. It will disappear when dismissed.</p>
              </div>
              <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={() => setRotatedToken(null)} disabled={busy} aria-label="Dismiss rotated token" title="Dismiss">
                <X aria-hidden="true" />
              </Button>
            </div>
            <TokenSecret value={rotatedToken.token} busy={busy} onCopy={onCopyToken} />
          </article>
        ) : null}

        <ApiTokenList tokens={apiTokens} busy={busy} onRevoke={onRevoke} onRotate={(tokenId) => void rotateToken(tokenId)} />
      </section>
    </section>
  );
}

function TokenWizard({
  busy,
  createdToken,
  onClose,
  onCopy,
  onCreate,
  onExpiryOptionChange,
  onNameChange,
  onScopeChange,
  onStepChange,
  step,
  tokenExpiryOption,
  tokenName,
  tokenScope
}: {
  busy: boolean;
  createdToken: CreatedApiToken | null;
  step: TokenWizardStep;
  tokenExpiryOption: TokenExpiryOption;
  tokenName: string;
  tokenScope: ApiTokenScope;
  onClose: () => void;
  onCopy: (value: string) => void;
  onCreate: () => void;
  onExpiryOptionChange: (value: TokenExpiryOption) => void;
  onNameChange: (value: string) => void;
  onScopeChange: (value: ApiTokenScope) => void;
  onStepChange: (value: TokenWizardStep) => void;
}) {
  const canContinueFromName = tokenName.trim().length > 0;
  const stepIndex = tokenWizardSteps.findIndex((entry) => entry.id === step) + 1;
  const stepCopy = tokenWizardCopy[step];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel modal-panel token-wizard" role="dialog" aria-modal="true" aria-labelledby="token-wizard-title">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">API access</p>
            <h2 id="token-wizard-title">Create token</h2>
            <p>Step {stepIndex} of 4</p>
          </div>
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onClose} disabled={busy} aria-label="Close token wizard" title="Close">
            <X aria-hidden="true" />
          </Button>
        </div>

        <ol className="token-wizard-steps" aria-label="Token creation progress">
          {tokenWizardSteps.map((entry, index) => {
            const itemStep = index + 1;
            const state = itemStep < stepIndex ? "complete" : itemStep === stepIndex ? "current" : "upcoming";

            return (
              <li className={`token-wizard-step token-wizard-step-${state}`} aria-current={state === "current" ? "step" : undefined} key={entry.id}>
                <span>{itemStep}</span>
                <strong>{entry.label}</strong>
              </li>
            );
          })}
        </ol>

        <div className="token-wizard-intro">
          <h3>{stepCopy.title}</h3>
          <p>{stepCopy.body}</p>
        </div>

        {step === "name" ? (
          <div className="token-wizard-screen">
            <label className="field settings-native-control">
              <span>Name</span>
              <input value={tokenName} onChange={(event) => onNameChange(event.target.value)} disabled={busy} autoFocus />
            </label>
            <div className="token-wizard-actions token-wizard-actions-forward">
              <Button type="button" className="compact-text-button overview-section-action" onClick={() => onStepChange("scope")} disabled={busy || !canContinueFromName}>
                Next
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === "scope" ? (
          <div className="token-wizard-screen">
            <div className="token-wizard-radio-group" role="radiogroup" aria-label="Token scope">
              <label className="token-wizard-radio">
                <input
                  type="radio"
                  name="token-scope"
                  value="read_only"
                  checked={tokenScope === "read_only"}
                  onChange={() => onScopeChange("read_only")}
                  disabled={busy}
                  aria-label="Read-only"
                />
                <span>
                  <strong>Read-only</strong>
                  <small>Inspect chargers, sessions, diagnostics, and communication logs.</small>
                </span>
              </label>
              <label className="token-wizard-radio">
                <input
                  type="radio"
                  name="token-scope"
                  value="read_write"
                  checked={tokenScope === "read_write"}
                  onChange={() => onScopeChange("read_write")}
                  disabled={busy}
                  aria-label="Read-write"
                />
                <span>
                  <strong>Read-write</strong>
                  <small>Create or update chargers, tags, proxy targets, and settings.</small>
                </span>
              </label>
            </div>
            <div className="token-wizard-actions">
              <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={() => onStepChange("name")} disabled={busy}>
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
              <Button type="button" className="compact-text-button overview-section-action" onClick={() => onStepChange("expiration")} disabled={busy}>
                Next
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === "expiration" ? (
          <div className="token-wizard-screen">
            <div className="token-wizard-radio-group" role="radiogroup" aria-label="Token expiry">
              <TokenExpiryRadio label="30 days" value="30" selected={tokenExpiryOption} disabled={busy} onChange={onExpiryOptionChange} />
              <TokenExpiryRadio label="60 days" value="60" selected={tokenExpiryOption} disabled={busy} onChange={onExpiryOptionChange} />
              <TokenExpiryRadio label="90 days" value="90" selected={tokenExpiryOption} disabled={busy} onChange={onExpiryOptionChange} />
              <TokenExpiryRadio label="Infinite" value="infinite" selected={tokenExpiryOption} disabled={busy} onChange={onExpiryOptionChange} />
            </div>
            <div className="token-wizard-actions">
              <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={() => onStepChange("scope")} disabled={busy}>
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
              <Button type="button" className="compact-text-button overview-section-action" onClick={onCreate} disabled={busy}>
                <Check aria-hidden="true" />
                Create token
              </Button>
            </div>
          </div>
        ) : null}

        {step === "token" && createdToken ? (
          <div className="token-wizard-screen">
            <TokenSecret value={createdToken.token} busy={busy} onCopy={onCopy} />
            <div className="token-wizard-actions token-wizard-actions-forward">
              <Button type="button" className="compact-text-button overview-section-action" onClick={onClose} disabled={busy}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function TokenSecret({ busy, onCopy, value }: { busy: boolean; onCopy: (value: string) => void; value: string }) {
  return (
    <div className="settings-token-secret">
      <label className="token-secret-input">
        <span>Token</span>
        <input value={value} readOnly />
        <Button type="button" className="button-secondary icon-button token-secret-copy-button" onClick={() => onCopy(value)} disabled={busy} aria-label="Copy token" title="Copy token">
          <Copy aria-hidden="true" />
        </Button>
      </label>
    </div>
  );
}

function TokenExpiryRadio({
  disabled,
  label,
  onChange,
  selected,
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: TokenExpiryOption) => void;
  selected: TokenExpiryOption;
  value: TokenExpiryOption;
}) {
  return (
    <label className="token-wizard-radio token-wizard-radio-compact">
      <input
        type="radio"
        name="token-expiry"
        value={value}
        checked={selected === value}
        onChange={() => onChange(value)}
        disabled={disabled}
        aria-label={label}
      />
      <span>
        <strong>{label}</strong>
      </span>
    </label>
  );
}

function ApiTokenList({
  busy,
  onRevoke,
  onRotate,
  tokens
}: {
  busy: boolean;
  onRevoke: (tokenId: string) => void;
  onRotate: (tokenId: string) => void;
  tokens: ApiToken[];
}) {
  if (tokens.length === 0) {
    return <p className="settings-empty-state">No API tokens created.</p>;
  }

  return (
    <div className="settings-token-list">
      {tokens.map((token) => (
        <article className="settings-token-row" key={token.id}>
          <div className="settings-token-row__main">
            <div>
              <h3>{token.name}</h3>
            </div>
          </div>
          <dl className="settings-status-grid">
            {[
              { label: "Status", value: formatTokenStatus(token.status) },
              { label: "Access", value: formatTokenScope(token.scope) },
              { label: "Created", value: formatDateTime(token.createdAt) },
              { label: "Updated", value: formatDateTime(token.updatedAt) },
              { label: "Expires", value: token.expiresAt ? formatDateTime(token.expiresAt) : "Never" },
              { label: "Last used", value: token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "-" }
            ].map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          <div className="settings-token-row__actions">
            <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={() => onRotate(token.id)} disabled={busy || token.status === "revoked"}>
              <RotateCcw aria-hidden="true" />
              Rotate
            </Button>
            <Button type="button" className="button-secondary compact-text-button overview-section-action" onClick={() => onRevoke(token.id)} disabled={busy || token.status === "revoked"}>
              <Trash2 aria-hidden="true" />
              Revoke
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

function formatEndpointStatus(status: OnboardingSettingsStatus) {
  if (status === "loading") return "Loading";
  if (status === "ready") return "Connected";
  if (status === "unavailable") return "Unavailable";
  if (status === "error") return "Load failed";
  return "Idle";
}

function formatTokenScope(scope: ApiTokenScope) {
  return scope === "read_only" ? "Read-only" : "Read-write";
}

function formatTokenStatus(status: ApiToken["status"]) {
  if (status === "active") return "Active";
  if (status === "expired") return "Expired";
  return "Revoked";
}

function getExpiryIso(option: TokenExpiryOption) {
  if (option === "infinite") return null;

  const days = Number(option);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt.toISOString();
}
