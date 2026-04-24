"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NurockLogo } from "@/components/ui/NurockLogo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Two-stage OTP login:
 *   Stage 1: user enters email → Supabase sends a 6-digit code
 *   Stage 2: user enters code → app verifies and creates a session
 *
 * `shouldCreateUser: false` means admins must pre-provision users in the
 * Supabase dashboard (Authentication → Users → Add user) before they can
 * sign in. Flip to `true` if you want open self-signup.
 */
export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage]     = useState<"email" | "code">("email");
  const [email, setEmail]     = useState("");
  const [code,  setCode]      = useState("");
  const [err,   setErr]       = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    setLoading(false);
    if (error) {
      setErr(error.message);
    } else {
      setStage("code");
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type:  "email",
    });

    setLoading(false);
    if (error) {
      setErr(error.message);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  async function resendCode() {
    setLoading(true);
    setErr(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (error) setErr(error.message);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="card p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <NurockLogo color="#164576" />
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold text-navy-800">NuRock</div>
            <div className="text-xs text-tan-700">Utilities AP</div>
          </div>
        </div>

        <h1 className="text-2xl font-display font-semibold text-navy-800 mb-2">
          Sign in
        </h1>

        {stage === "email" && (
          <>
            <p className="text-sm text-tan-700 mb-6">
              Enter your NuRock email to receive a 6-digit sign-in code.
            </p>
            <form onSubmit={sendCode} className="space-y-4">
              <div>
                <label className="label" htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@nurock.com"
                  className="input"
                  autoFocus
                />
              </div>
              {err && <div className="text-sm text-flag-red">{err}</div>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "Sending…" : "Send sign-in code"}
              </button>
            </form>
          </>
        )}

        {stage === "code" && (
          <>
            <p className="text-sm text-tan-700 mb-6">
              We sent a 6-digit code to <strong>{email}</strong>. Enter it below.
            </p>
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <label className="label" htmlFor="code">6-digit code</label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="input text-center text-2xl tracking-[0.5em] font-mono"
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>
              {err && <div className="text-sm text-flag-red">{err}</div>}
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="btn-primary w-full"
              >
                {loading ? "Verifying…" : "Sign in"}
              </button>
              <div className="flex items-center justify-between text-xs text-tan-700">
                <button
                  type="button"
                  onClick={() => { setStage("email"); setCode(""); setErr(null); }}
                  className="hover:underline"
                >
                  ← Use a different email
                </button>
                <button
                  type="button"
                  onClick={resendCode}
                  disabled={loading}
                  className="hover:underline disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
