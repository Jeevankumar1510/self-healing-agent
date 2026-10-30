"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("Choose a password with at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.replace("/mfa");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your password.");
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark"><ShieldCheck size={24} /></div>
        <div className="eyebrow"><span className="eyebrow-line" /> ACCOUNT SECURITY</div>
        <h1>Choose your password</h1>
        <p>Set a private password for your individual account. You’ll then enroll an authenticator.</p>
        <form onSubmit={updatePassword} className="login-form">
          <label htmlFor="new-password">New password</label>
          <div className="login-input-wrap"><LockKeyhole size={17} /><input id="new-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          <label htmlFor="confirm-password">Confirm password</label>
          <div className="login-input-wrap"><LockKeyhole size={17} /><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
          {error ? <div className="diagnosis-error" role="alert">{error}</div> : null}
          <button type="submit" className="diagnose-button" disabled={loading || !password || !confirmPassword}>
            {loading ? <><RefreshCw size={15} className="spin" /> Updating…</> : "Save password"}
          </button>
        </form>
        <div className="login-privacy"><LockKeyhole size={14} /> Use a unique password you don’t share with anyone.</div>
      </section>
    </main>
  );
}
