"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ExperienceLevel, Objective, RiskProfile } from "@/lib/types";
import {
  CandlestickChart,
  Loader2,
  Check,
  Sprout,
  LineChart,
  Compass,
  Shield,
  Scale,
  Rocket,
  TrendingUp,
  HandCoins,
  PiggyBank,
  GraduationCap,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

type ChoiceCardProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
};

function ChoiceCard({ icon: Icon, title, description, selected, onClick }: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-emerald-500/70 bg-emerald-50/60 ring-1 ring-emerald-500/40"
          : "border-border bg-card hover:border-foreground/30 hover:bg-accent"
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
          selected ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground group-hover:text-foreground"
        )}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {selected && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

const EXPERIENCE: { value: ExperienceLevel; title: string; description: string; icon: ChoiceCardProps["icon"] }[] = [
  { value: "beginner", title: "New to investing", description: "Keep the analysis plain and focused on holdings, income and simple explanations.", icon: Sprout },
  { value: "intermediate", title: "Comfortable", description: "Use more market and company context alongside the portfolio basics.", icon: LineChart },
  { value: "advanced", title: "Experienced", description: "Use denser analysis and more technical market language when it is useful.", icon: Compass },
];

const RISK: { value: RiskProfile; title: string; description: string; icon: ChoiceCardProps["icon"] }[] = [
  { value: "conservative", title: "Conservative", description: "Protect capital first. Prefer steady, established companies.", icon: Shield },
  { value: "balanced", title: "Balanced", description: "A mix of stability and growth across sectors.", icon: Scale },
  { value: "aggressive", title: "Growth seeking", description: "Comfortable with bigger swings for higher long-term growth.", icon: Rocket },
];

const OBJECTIVE: { value: Objective; title: string; description: string; icon: ChoiceCardProps["icon"] }[] = [
  { value: "growth", title: "Long-term growth", description: "Build wealth over years by holding good businesses.", icon: TrendingUp },
  { value: "income", title: "Dividend income", description: "Focus on companies that pay regular dividends.", icon: HandCoins },
  { value: "preservation", title: "Preserve capital", description: "Keep what I have safe and grow it slowly.", icon: PiggyBank },
  { value: "learning", title: "Learn as I go", description: "I am here to understand my portfolio and improve.", icon: GraduationCap },
];

const TOTAL_STEPS = 4;

export function OnboardingWizard({
  initialName,
  initialExperience,
}: {
  initialName: string;
  initialExperience: ExperienceLevel;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialName);
  const [experience, setExperience] = useState<ExperienceLevel>(initialExperience);
  const [risk, setRisk] = useState<RiskProfile | null>(null);
  const [objective, setObjective] = useState<Objective | null>(null);

  const canAdvance = useMemo(() => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return !!experience;
    if (step === 2) return !!risk;
    if (step === 3) return !!objective;
    return false;
  }, [step, name, experience, risk, objective]);

  async function finish() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Your session expired. Please sign in again.");
      setSaving(false);
      return;
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: name.trim(),
        experience_level: experience,
        risk_profile: risk,
        objective,
        onboarded: true,
      })
      .eq("id", user.id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  function next() {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
    else void finish();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="w-full max-w-lg">
      {/* Progress */}
      <div className="mb-6 flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= step ? "bg-emerald-600" : "bg-border"
            )}
          />
        ))}
      </div>

      <div key={step} className="rise rise-1">
        {step === 0 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-2xl font-medium tracking-tight">Welcome. Let us set up your view.</h1>
              <p className="text-sm text-muted-foreground">
                A few quick questions so the platform can tune research language and portfolio context to you.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">What should we call you?</Label>
              <Input
                id="name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAdvance) next();
                }}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <Step
            title="How would you describe your investing experience?"
            subtitle="This decides how much the platform shows you to start. Beginners get a clean, focused view."
          >
            {EXPERIENCE.map((o) => (
              <ChoiceCard key={o.value} {...o} selected={experience === o.value} onClick={() => setExperience(o.value)} />
            ))}
          </Step>
        )}

        {step === 2 && (
          <Step
            title="What is your comfort with risk?"
            subtitle="We use this to set the tone of insights. There are no trading signals here, only long-term context."
          >
            {RISK.map((o) => (
              <ChoiceCard key={o.value} {...o} selected={risk === o.value} onClick={() => setRisk(o.value)} />
            ))}
          </Step>
        )}

        {step === 3 && (
          <Step title="What are you investing for?" subtitle="Your main objective for this portfolio.">
            {OBJECTIVE.map((o) => (
              <ChoiceCard key={o.value} {...o} selected={objective === o.value} onClick={() => setObjective(o.value)} />
            ))}
          </Step>
        )}

      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="mt-7 flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)} disabled={saving}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={next} disabled={!canAdvance || saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {step === TOTAL_STEPS - 1 ? "Finish" : "Continue"}
          {!saving && step < TOTAL_STEPS - 1 && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Not you, or want a different account?{" "}
        <button type="button" onClick={signOut} disabled={saving} className="font-medium text-foreground underline-offset-2 hover:underline">
          Sign out
        </button>
      </p>
    </div>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-2.5">{children}</div>
    </div>
  );
}

export function OnboardingBrand() {
  return (
    <div className="mb-8 flex items-center gap-2.5">
      <CandlestickChart className="h-6 w-6 text-emerald-600" />
      <span className="text-[15px] font-semibold tracking-tight">PortfolioOS PK</span>
    </div>
  );
}
