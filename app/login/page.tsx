"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DISCLAIMER } from "@/lib/utils";
import { CandlestickChart, Loader2, Eye, EyeOff, ShieldCheck, LineChart, Sparkles, Mail } from "lucide-react";

const VALUE_POINTS = [
  { icon: LineChart, text: "Read a complete PSX portfolio dashboard with seeded holdings, dividends and market data" },
  { icon: Sparkles, text: "Browse curated Research Copilot answers without spending AI credits" },
  { icon: ShieldCheck, text: "Approved accounts only while the product is onboarded slowly" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [waitlist, setWaitlist] = useState({ full_name: "", email: "", phone: "", note: "" });

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setError(null);
    setInfo(null);
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
    setInfo(null);
    try {
      const res = await fetch("/api/demo/session", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Demo is unavailable");
      router.push(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo is unavailable");
    } finally {
      setDemoLoading(false);
    }
  }

  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setWaitlistLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...waitlist, source: "login" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not join waitlist");
      setInfo(data.message ?? "You are on the waitlist.");
      setWaitlist({ full_name: "", email: "", phone: "", note: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join waitlist");
    } finally {
      setWaitlistLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-x-hidden bg-background px-4 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% 28%, rgba(220,220,215,0.6) 0%, transparent 70%)" }}
      />

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

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center pt-[calc(2.5rem+env(safe-area-inset-top))] text-center sm:pt-20 md:pt-24">
        <div className="rise rise-1 mb-7 flex items-center gap-2.5">
          <CandlestickChart className="h-6 w-6 text-emerald-600" />
          <span className="text-[15px] font-semibold tracking-tight">PortfolioOS PK</span>
        </div>

        <p className="eyebrow rise rise-1 mb-3">PSX Portfolio Intelligence</p>

        <h1 className="tracking-editorial text-[2.25rem] font-medium leading-[1.05] sm:text-5xl md:text-6xl">
          <span className="rise rise-2 block text-ghost">A Read-Only Demo</span>
          <span className="rise rise-3 block text-foreground">Before Private Onboarding</span>
        </h1>

        <p className="rise rise-4 mt-5 max-w-2xl text-balance text-sm text-muted-foreground sm:text-base">
          Explore the allowed launch tabs with seeded PSX portfolio data. New accounts are approved manually from the waitlist.
        </p>

        <div className="rise rise-5 mt-8 grid w-full gap-4 text-left lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_70px_-45px_rgba(0,0,0,0.28)] backdrop-blur-sm sm:p-6">
            <h2 className="text-base font-semibold tracking-tight">Approved account sign-in</h2>
            <p className="mt-1 text-xs text-muted-foreground">Public signup is closed for now. If your account has been created, sign in here.</p>

            <form onSubmit={signIn} className="mt-4 space-y-3">
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
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loginLoading}>
                {loginLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign in
              </Button>
            </form>

            <div className="mt-4 border-t border-border pt-4">
              <Button type="button" variant="outline" className="w-full" onClick={startDemo} disabled={demoLoading}>
                {demoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Try read-only demo
              </Button>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Demo data can be read, searched and explored, but not edited.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card/90 p-5 shadow-[0_18px_70px_-45px_rgba(0,0,0,0.28)] backdrop-blur-sm sm:p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><Mail className="h-4 w-4 text-emerald-600" /> Join the waitlist</h2>
            <p className="mt-1 text-xs text-muted-foreground">Share your details and I will reach out personally before creating your account.</p>
            <form onSubmit={joinWaitlist} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wait-name">Name</Label>
                  <Input id="wait-name" required value={waitlist.full_name} onChange={(e) => setWaitlist({ ...waitlist, full_name: e.target.value })} placeholder="Your name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wait-email">Email</Label>
                  <Input id="wait-email" type="email" value={waitlist.email} onChange={(e) => setWaitlist({ ...waitlist, email: e.target.value })} placeholder="you@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wait-phone">Phone</Label>
                  <Input id="wait-phone" value={waitlist.phone} onChange={(e) => setWaitlist({ ...waitlist, phone: e.target.value })} placeholder="+92..." />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wait-note">What are you hoping to track?</Label>
                <Textarea id="wait-note" rows={3} value={waitlist.note} onChange={(e) => setWaitlist({ ...waitlist, note: e.target.value })} placeholder="Optional: portfolio size, broker, features you care about" />
              </div>
              <Button type="submit" className="w-full" disabled={waitlistLoading}>
                {waitlistLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Join waitlist
              </Button>
            </form>
          </section>
        </div>

        {(error || info) && (
          <p className={`rise rise-5 mt-4 w-full max-w-xl rounded-md px-3 py-2 text-center text-xs ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {error ?? info}
          </p>
        )}

        <ul className="rise rise-5 mt-7 grid w-full max-w-2xl gap-2.5 text-left sm:grid-cols-3">
          {VALUE_POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span className="leading-relaxed">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-[5] h-44"
        style={{ background: "linear-gradient(to top, rgba(5,5,12,0.7) 0%, rgba(5,5,12,0.35) 45%, transparent 100%)" }}
      />
      <p className="absolute bottom-3 left-0 right-0 z-10 mx-auto max-w-sm px-4 text-center text-[11px] text-white/70">
        {DISCLAIMER}
      </p>
    </main>
  );
}
