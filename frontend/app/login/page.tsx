"use client";

import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    const timer = window.setTimeout(() => {
      if (reason === "link") {
        setError("That invitation or recovery link is invalid or expired. Ask for a new email.");
      } else if (reason === "session") {
        setError("Your sign-in session could not be verified. Please sign in again.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;

      window.location.replace("/mfa");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
      setLoading(false);
    }
  }

  async function sendPasswordReset() {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your invited email address first.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
      });
      if (resetError) throw resetError;
      setNotice("If the account can be recovered, password-reset instructions will be sent to that email.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not request a password reset.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark"><ShieldCheck size={24} /></div>
        <div className="eyebrow"><span className="eyebrow-line" /> INVITED USERS · MFA REQUIRED</div>
        <h1>Sign in</h1>
        <p>Use your individual invited account. An authenticator code is required after password sign-in.</p>
        <form onSubmit={signIn} className="login-form">
          <label htmlFor="account-email">Email</label>
          <div className="login-input-wrap">
            <LockKeyhole size={17} />
            <input id="account-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <label htmlFor="account-password">Password</label>
          <div className="login-input-wrap">
            <LockKeyhole size={17} />
            <input id="account-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error ? <div className="diagnosis-error" role="alert">{error}</div> : null}
          {notice ? <p className="login-notice" role="status">{notice}</p> : null}
          <button type="submit" className="diagnose-button" disabled={loading || !email || !password}>
            {loading ? <><RefreshCw size={15} className="spin" /> Signing in…</> : "Continue"}
          </button>
        </form>
        <button className="login-reset" onClick={() => void sendPasswordReset()} disabled={loading}>Forgot your password?</button>
        <div className="login-privacy"><LockKeyhole size={14} /> Each person has their own account; MFA is required.</div>
      </section>
    </main>
  );
}
