"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/shared/format";
import { Loader2, Eye, EyeOff, Upload, ShieldCheck, Lock, ArrowUpRight } from "lucide-react";

const PROOF_POINTS = [
  { icon: Upload, text: "Import AKD or CDC statements as CSV, Excel or PDF" },
  { icon: ShieldCheck, text: "Never asks for brokerage credentials, never places orders" },
  { icon: Lock, text: "Your holdings stay private to your account" },
];

/** Static strip along the foot of the brand panel, in the product's tape voice. */
const TAPE = [
  { label: "KSE-100", value: "84,912", change: "+0.49%", tone: "up" as const },
  { label: "Volume", value: "412m", change: "−8%", tone: "down" as const },
  { label: "FIPI", value: "+1.24bn", change: "net buy", tone: "up" as const },
  { label: "Breadth", value: "61%", change: "advancing", tone: "flat" as const },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // /demo redirects here when the shared demo workspace cannot be opened.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "unavailable") {
      // The query string is readable only after mount, so this cannot be an
      // initial value without breaking the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("The read-only demo could not be opened. Please try the button below.");
    }
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setError(null);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoginLoading(false);
    }
  }

  async function startDemo() {
    setDemoLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/session", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Demo is unavailable");
      router.push(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo is unavailable");
      setDemoLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-surface-page lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* ── Brand panel ── */}
      <section className="relative flex flex-col overflow-hidden bg-ink-1 px-6 py-10 text-[var(--text-on-dark)] sm:px-10 lg:px-14 lg:py-12">
        <svg
          aria-hidden
          viewBox="0 0 600 300"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] w-full opacity-[0.13]"
        >
          <path
            d="M0 250 L60 236 L120 244 L180 208 L240 220 L300 168 L360 186 L420 132 L480 150 L540 96 L600 112 L600 300 L0 300 Z"
            fill="none"
            stroke="#fff"
            strokeWidth="1.5"
          />
        </svg>

        <div className="relative z-10 flex items-center gap-3">
          <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden className="block shrink-0">
            <rect x="10" y="10" width="44" height="44" fill="#fff" />
          </svg>
          <span className="font-display text-[22px] tracking-editorial">PortfolioOS PK</span>
        </div>

        <div className="relative z-10 mt-16 lg:mt-20">
          <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-eyebrow) text-[var(--text-on-dark-muted)]">
            PSX portfolio intelligence
          </p>
          <h1 className="mt-5 max-w-[13ch] font-display text-[3rem] font-normal leading-[1.02] tracking-editorial sm:text-[3.75rem]">
            <span className="block text-white/35">Your book,</span>
            <span className="block">read the way an analyst would read it.</span>
          </h1>
          <p className="mt-8 max-w-[38ch] text-sm leading-relaxed text-[var(--text-on-dark-muted)]">
            Holdings, dividends and performance against the KSE-100, built from your own broker statements. No
            credentials, no orders.
          </p>
        </div>

        <div className="relative z-10 mt-auto pt-14">
          <div className="grid gap-6 border-t border-[var(--rule-on-dark)] pt-7 sm:grid-cols-3">
            {PROOF_POINTS.map(({ icon: Icon, text }) => (
              <div key={text}>
                <Icon className="h-4 w-4 text-[var(--text-on-dark-muted)]" />
                <p className="mt-3 max-w-[24ch] text-xs leading-relaxed text-[var(--text-on-dark-muted)]">{text}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-baseline gap-x-7 gap-y-2 border-t border-[var(--rule-on-dark)] pt-5">
            {TAPE.map((t) => (
              <span key={t.label} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-white/35">{t.label}</span>
                <span className="figure text-(length:--text-2xs) font-semibold text-[var(--text-on-dark-muted)]">{t.value}</span>
                <span
                  className={cn(
                    "figure text-(length:--text-3xs) font-semibold",
                    t.tone === "up" ? "text-[var(--up-3)]" : t.tone === "down" ? "text-[var(--down-3)]" : "text-white/35"
                  )}
                >
                  {t.change}
                </span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sign-in panel ── */}
      <section className="flex items-center justify-center px-6 py-12 sm:px-10 lg:px-14">
        <div className="w-full max-w-[26rem]">
          <h2 className="font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Sign in</h2>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            If your account has been created, sign in below. New accounts are approved manually for now.
          </p>

          <form onSubmit={signIn} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-4">
                <Label htmlFor="password">Password</Label>
                <span className="text-xs text-text-muted">Forgot password</span>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="h-12 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-muted transition-colors hover:text-text-strong"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-(--radius-sm) bg-ink-1 text-sm font-semibold text-white transition-colors hover:bg-ink-2 disabled:opacity-50"
            >
              {loginLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--surface-raised)]" />
                </span>
              )}
              Sign in
            </button>
          </form>

          {error && (
            <p className="mt-4 rounded-md border border-[var(--down-3)]/40 bg-[var(--down-4)] px-3 py-2 text-xs text-down">{error}</p>
          )}

          <div className="my-8 flex items-center gap-4">
            <span className="h-px flex-1 bg-rule" />
            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">or</span>
            <span className="h-px flex-1 bg-rule" />
          </div>

          <button
            type="button"
            onClick={startDemo}
            disabled={demoLoading}
            className="flex w-full items-start justify-between gap-4 rounded-(--radius-md) border border-rule bg-surface-raised px-5 py-4 text-left transition-colors hover:bg-surface-sunken disabled:opacity-60"
          >
            <span>
              <span className="block text-sm font-semibold text-text-strong">Try the read-only demo</span>
              <span className="mt-1 block text-xs text-text-muted">
                Seeded PSX portfolio · read, search and explore, but not edit
              </span>
            </span>
            {demoLoading ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-text-muted" />
            ) : (
              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
            )}
          </button>
        </div>
      </section>
    </main>
  );
}
