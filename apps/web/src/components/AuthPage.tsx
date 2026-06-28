import type { FormEvent, KeyboardEvent } from "react";
import { KeyRound, PlugZap } from "lucide-react";
import { Button } from "./ui/button";

type AuthPageProps = {
  username: string;
  password: string;
  message: string;
  busy: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AuthPage({ username, password, message, busy, onUsernameChange, onPasswordChange, onSubmit }: AuthPageProps) {
  function submitOnPasswordEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <main className="auth-page">
      <section className="panel auth-card" aria-labelledby="auth-title">
        <div className="auth-card-header">
          <div className="brand">
            <PlugZap aria-hidden="true" />
            <span>Virtual OCPP</span>
          </div>
          <p className="eyebrow">Protected admin</p>
          <h1 id="auth-title">Sign in</h1>
        </div>

        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              onKeyDown={submitOnPasswordEnter}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <Button type="submit" className="button-secondary compact-text-button overview-section-action auth-submit-button" disabled={busy || !username || !password}>
            <KeyRound aria-hidden="true" />
            Sign in
          </Button>
          <p className="notice auth-message" role="status">
            {message}
          </p>
        </form>
      </section>
    </main>
  );
}
