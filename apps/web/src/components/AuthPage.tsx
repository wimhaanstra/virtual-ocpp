import type { FormEvent } from "react";
import { KeyRound, PlugZap } from "lucide-react";
import { Button } from "./ui/button";

type AuthPageProps = {
  username: string;
  password: string;
  inviteCode: string;
  inviteTenantName: string;
  mode: "login" | "register" | "invite";
  message: string;
  busy: boolean;
  onModeChange: (mode: "login" | "register" | "invite") => void;
  onInviteCodeChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AuthPage({
  username,
  password,
  inviteCode,
  inviteTenantName,
  mode,
  message,
  busy,
  onModeChange,
  onInviteCodeChange,
  onUsernameChange,
  onPasswordChange,
  onSubmit
}: AuthPageProps) {
  const isRegistering = mode === "register";
  const isInvite = mode === "invite";
  return (
    <main className="auth-page">
      <section className="auth-layout">
        <section className="panel hero-panel">
          <div className="brand">
            <PlugZap aria-hidden="true" />
            <span>Virtual OCPP</span>
          </div>
          <h1>Admin access</h1>
          <p className="hero-copy">Manage OCPP proxy targets for the local Smart EVSE bridge.</p>
        </section>

        <section className="panel auth-card">
          <div>
            <p className="eyebrow">{isInvite ? "Invite" : isRegistering ? "New account" : "Protected"}</p>
            <h2>{isInvite ? "Join account" : isRegistering ? "Register" : "Sign in"}</h2>
          </div>
          <p className="notice" role="status">
            {message}
          </p>
          <form className="form-grid" onSubmit={onSubmit}>
            {isInvite ? (
              <>
                <label className="field">
                  <span>Account</span>
                  <input value={inviteTenantName || "Loading invite..."} readOnly aria-readonly="true" />
                </label>
                <label className="field">
                  <span>Invite code</span>
                  <input value={inviteCode} onChange={(event) => onInviteCodeChange(event.target.value)} autoComplete="one-time-code" />
                </label>
              </>
            ) : null}
            <label className="field">
              <span>Username</span>
              <input value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                autoComplete={isRegistering || isInvite ? "new-password" : "current-password"}
              />
            </label>
            <Button type="submit" disabled={busy || !username || !password || (isInvite && !inviteCode)}>
              <KeyRound aria-hidden="true" />
              {isInvite ? "Join account" : isRegistering ? "Create account" : "Sign in"}
            </Button>
          </form>
          <div className="auth-mode-actions">
            {isInvite ? null : (
              <Button type="button" className="button-ghost" onClick={() => onModeChange(isRegistering ? "login" : "register")} disabled={busy}>
                {isRegistering ? "Use existing account" : "Register account"}
              </Button>
            )}
            {isInvite ? (
              <Button type="button" className="button-ghost" onClick={() => onModeChange("login")} disabled={busy}>
                Sign in instead
              </Button>
            ) : (
              <Button type="button" className="button-ghost" onClick={() => onModeChange("invite")} disabled={busy}>
                Use invite code
              </Button>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
