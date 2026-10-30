"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type MfaStep = "loading" | "enroll" | "challenge";

export default function MfaPage() {
  const router = useRouter();
  const [step, setStep] = useState<MfaStep>("loading");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepareMfa() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          router.replace("/login");
          return;
        }
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const verified = factors.totp.find((factor) => factor.status === "verified");
        if (verified) {
          if (active) {
            setFactorId(verified.id);
            setStep("challenge");
          }
          return;
        }

        for (const factor of factors.totp) {
          if (factor.status !== "verified") {
            const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
            if (removeError) throw removeError;
          }
        }
        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: user.email ?? "Dashboard authenticator",
        });
        if (enrollError) throw enrollError;
        if (active) {
          setFactorId(enrolled.id);
          setQrCode(enrolled.totp.qr_code);
          setSecret(enrolled.totp.secret);
          setStep("enroll");
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Could not set up authenticator MFA.");
          setStep("enroll");
        }
      }
    }
    void prepareMfa();
    return () => { active = false; };
  }, [router]);

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.replace(/\s/g, ""),
      });
      if (verifyError) throw verifyError;
      router.replace("/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The authenticator code could not be verified.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark"><ShieldCheck size={24} /></div>
        <div className="eyebrow"><span className="eyebrow-line" /> REQUIRED SECURITY STEP</div>
        <h1>{step === "challenge" ? "Verify your sign-in" : "Set up an authenticator"}</h1>
        {step === "loading" ? <p>Checking your account’s authenticator setup…</p> : null}
        {step === "enroll" && !qrCode && !error ? <p>Preparing a new authenticator setup…</p> : null}
        {step === "enroll" && qrCode ? (
          <div className="mfa-setup">
            <p>Scan this QR code with an authenticator app, then enter its current six-digit code.</p>
            <Image className="mfa-qr" src={qrCode} alt="Authenticator enrollment QR code" width={184} height={184} unoptimized />
            <details><summary>Can’t scan the code?</summary><code className="mfa-secret">{secret}</code></details>
          </div>
        ) : null}
        {step === "challenge" ? <p>Enter the current six-digit code from your authenticator app.</p> : null}
        {step !== "loading" ? (
          <form onSubmit={verifyCode} className="login-form">
            <label htmlFor="authenticator-code">Authenticator code</label>
            <div className="login-input-wrap">
              <ShieldCheck size={17} />
              <input
                id="authenticator-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,8}"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </div>
            {error ? <div className="diagnosis-error" role="alert">{error}</div> : null}
            <button type="submit" className="diagnose-button" disabled={loading || code.replace(/\s/g, "").length !== 6 || !factorId}>
              {loading ? <><RefreshCw size={15} className="spin" /> Verifying…</> : "Verify and continue"}
            </button>
          </form>
        ) : null}
        <div className="login-privacy"><ShieldCheck size={14} /> The dashboard stays locked until MFA verification succeeds.</div>
      </section>
    </main>
  );
}
