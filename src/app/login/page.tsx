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
 * `shouldCreateUser: true` means anyone with a valid email can sign in.
 * On first signup, a Postgres trigger (see migration 0027) auto-creates
 * a user_profiles row with role='viewer' — the pending-approval state.
 * Middleware then redirects viewer users to /pending-approval until an
 * admin elevates their role to 'admin' or 'tester' in /admin/users.
 *
 * If you ever need to lock signup down (e.g. for production), set
 * `shouldCreateUser: false` here and provision users manually via the
 * Supabase dashboard.
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
      options: { shouldCreateUser: true },
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
    <div className="min-h-screen flex items-center justify-center bg-nurock-bg px-4">
      <div className="card p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <NurockLogo variant="onLight" size={40} />
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold text-nurock-black">NuRock</div>
            <div className="text-xs text-nurock-slate-light">Utilities AP</div>
          </div>
        </div>

        <h1 className="text-2xl font-display font-semibold text-nurock-black mb-2">
          Sign in
        </h1>

        {stage === "email" && (
          <>
            <p className="text-sm text-nurock-slate-light mb-6">
              Enter your email to receive a 6-digit sign-in code. New accounts
              will need to be approved by an admin before access is granted.
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
            <p className="text-sm text-nurock-slate-light mb-6">
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
              <div className="flex items-center justify-between text-xs text-nurock-slate-light">
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
