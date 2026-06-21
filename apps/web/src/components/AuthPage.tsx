import type { FormEvent } from "react";
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
            <p className="eyebrow">Protected</p>
            <h2>Sign in</h2>
          </div>
          <p className="notice" role="status">
            {message}
          </p>
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
                type="password"
                autoComplete="current-password"
              />
            </label>
            <Button type="submit" disabled={busy || !username || !password}>
              <KeyRound aria-hidden="true" />
              Sign in
            </Button>
          </form>
        </section>
      </section>
    </main>
  );
}
