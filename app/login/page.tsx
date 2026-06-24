"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DISCLAIMER } from "@/lib/utils";
import { CandlestickChart, Loader2, Eye, EyeOff, ShieldCheck, LineChart, Sparkles } from "lucide-react";

const VALUE_POINTS = [
  { icon: LineChart, text: "See your holdings, gains and dividends in one clean view" },
  { icon: Sparkles, text: "Ask a research copilot about your portfolio and PSX" },
  { icon: ShieldCheck, text: "Private to you. No brokerage logins, no orders, ever" },
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        if (data.session) {
          // New accounts go through onboarding before the app personalizes itself.
          router.push("/onboarding");
          router.refresh();
        } else {
          setInfo("Account created. Check your email for a confirmation link, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-x-hidden bg-background px-4 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {/* Soft top-down halo behind the composition */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 28%, rgba(220,220,215,0.6) 0%, transparent 70%)",
        }}
      />

      {/* Photoreal stones flanking the composition (Synex motif, hero only) */}
      <Image
        aria-hidden
        src="https://qclay.design/lovable/synex/stone-left.png"
        alt=""
        width={440}
        height={440}
        sizes="(min-width: 1024px) 440px, (min-width: 768px) 360px, 260px"
        className="pointer-events-none absolute bottom-0 left-0 z-0 hidden h-[260px] w-auto select-none object-contain object-bottom-left sm:block md:h-[360px] lg:h-[440px]"
      />
      <Image
        aria-hidden
        src="https://qclay.design/lovable/synex/stone-right.png"
        alt=""
        width={440}
        height={440}
        sizes="(min-width: 1024px) 440px, (min-width: 768px) 360px, 260px"
        className="pointer-events-none absolute bottom-0 right-0 z-0 hidden h-[260px] w-auto select-none object-contain object-bottom-right sm:block md:h-[360px] lg:h-[440px]"
      />

      {/* Hero content */}
      <div className="relative z-10 flex w-full max-w-xl flex-col items-center pt-[calc(2.5rem+env(safe-area-inset-top))] text-center sm:pt-20 md:pt-24">
        <div className="rise rise-1 mb-7 flex items-center gap-2.5">
          <CandlestickChart className="h-6 w-6 text-emerald-600" />
          <span className="text-[15px] font-semibold tracking-tight">PortfolioOS PK</span>
        </div>

        <p className="eyebrow rise rise-1 mb-3">PSX Portfolio Intelligence</p>

        <h1 className="tracking-editorial text-[2.25rem] font-medium leading-[1.05] sm:text-5xl md:text-6xl">
          <span className="rise rise-2 block text-ghost">A New Standard</span>
          <span className="rise rise-3 block text-foreground">in PSX Investing</span>
        </h1>

        <p className="rise rise-4 mt-5 max-w-md text-balance text-sm text-muted-foreground sm:text-base">
          Take full control of your assets with a unified platform for tracking,
          researching, and growing your Pakistan Stock Exchange portfolio in real time.
        </p>

        {/* Auth card — the centered "dashboard" of the composition */}
        <div className="rise rise-5 mt-8 w-full max-w-sm rounded-2xl border border-border bg-card/90 p-5 text-left shadow-[0_-8px_60px_rgba(0,0,0,0.06),0_40px_100px_-40px_rgba(0,0,0,0.25)] backdrop-blur-sm sm:mt-10 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === "signin"
              ? "Welcome back. Your portfolio data is private to your account."
              : "We never ask for brokerage logins. Just an email and password for this app."}
          </p>

          <form onSubmit={submit} className="mt-4 space-y-3">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            {info && <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">{info}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Sign up"}
            </Button>
          </form>
          <button
            className="mt-2 min-h-11 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </div>

        {/* What you get — restrained, three plain points */}
        <ul className="rise rise-5 mt-7 grid w-full max-w-sm gap-2.5 text-left">
          {VALUE_POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span className="leading-relaxed">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom dark fade grounds the composition */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-[5] h-44"
        style={{
          background:
            "linear-gradient(to top, rgba(5,5,12,0.7) 0%, rgba(5,5,12,0.35) 45%, transparent 100%)",
        }}
      />
      <p className="absolute bottom-3 left-0 right-0 z-10 mx-auto max-w-sm px-4 text-center text-[11px] text-white/70">
        {DISCLAIMER}
      </p>
    </main>
  );
}
