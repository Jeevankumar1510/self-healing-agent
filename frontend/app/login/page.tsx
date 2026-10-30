"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body: unknown = await response.json();
        const detail = body && typeof body === "object" && "detail" in body
          ? String(body.detail)
          : "Sign-in failed.";
        throw new Error(detail);
      }
      window.location.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark"><ShieldCheck size={24} /></div>
        <div className="eyebrow"><span className="eyebrow-line" /> SHARED PC DASHBOARD</div>
        <h1>Sign in</h1>
        <p>Enter the shared access password to view this computer’s health dashboard.</p>
        <form onSubmit={signIn} className="login-form">
          <label htmlFor="dashboard-password">Access password</label>
          <div className="login-input-wrap">
            <LockKeyhole size={17} />
            <input
              id="dashboard-password"
              type="password"
              autoComplete="current-password"
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoFocus
            />
          </div>
          {error ? <div className="diagnosis-error" role="alert">{error}</div> : null}
          <button type="submit" className="diagnose-button" disabled={loading || password.length === 0}>
            {loading ? <><RefreshCw size={15} className="spin" /> Signing in…</> : "Continue"}
          </button>
        </form>
        <div className="login-privacy"><LockKeyhole size={14} /> Access is restricted to people with the shared password.</div>
      </section>
    </main>
  );
}
