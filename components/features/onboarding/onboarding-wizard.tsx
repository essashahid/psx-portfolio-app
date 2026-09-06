"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/shared/format";
import type { ExperienceLevel, Objective } from "@/lib/shared/types";
import type { HoldingQuickAddRequest } from "@psx/shared/api/holdings";
import type { TransactionWriteRequest } from "@psx/shared/api/transactions";
import {
  Loader2,
  Check,
  Sprout,
  LineChart,
  Compass,
  TrendingUp,
  HandCoins,
  PiggyBank,
  GraduationCap,
  ArrowRight,
  ArrowLeft,
  Plus,
  X,
} from "lucide-react";
import { PlumbMark } from "@/components/shared/plumb-mark";

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
          : "border-rule bg-surface-raised hover:border-text-strong/30 hover:bg-surface-inset"
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
          selected ? "bg-emerald-600 text-white" : "bg-surface-sunken text-text-muted group-hover:text-text-strong"
        )}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {selected && <Check className="h-3.5 w-3.5 text-up" />}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{description}</span>
      </span>
    </button>
  );
}

const EXPERIENCE: { value: ExperienceLevel; title: string; description: string; icon: ChoiceCardProps["icon"] }[] = [
  { value: "beginner", title: "New to investing", description: "Keep the analysis plain and focused on holdings, income and simple explanations.", icon: Sprout },
  { value: "intermediate", title: "Comfortable", description: "Use more market and company context alongside the portfolio basics.", icon: LineChart },
  { value: "advanced", title: "Experienced", description: "Use denser analysis and more technical market language when it is useful.", icon: Compass },
];

const OBJECTIVE: { value: Objective; title: string; description: string; icon: ChoiceCardProps["icon"] }[] = [
  { value: "growth", title: "Long-term growth", description: "Build wealth over years by holding good businesses.", icon: TrendingUp },
  { value: "income", title: "Dividend income", description: "Focus on companies that pay regular dividends.", icon: HandCoins },
  { value: "preservation", title: "Preserve capital", description: "Keep what I have safe and grow it slowly.", icon: PiggyBank },
  { value: "learning", title: "Learn as I go", description: "I am here to understand my portfolio and improve.", icon: GraduationCap },
];

const TOTAL_STEPS = 4;
const LAST_STEP = TOTAL_STEPS - 1;

/** One "what you own" row. Strings while editing; parsed on finish. */
type OwnedRow = {
  key: number;
  ticker: string;
  name: string | null;
  quantity: string;
  avgCost: string;
  costUnknown: boolean;
};

type SearchHit = { ticker: string; companyName: string | null; sector: string | null };

const emptyRow = (key: number): OwnedRow => ({ key, ticker: "", name: null, quantity: "", avgCost: "", costUnknown: false });

/** A row with nothing typed in it is ignored rather than rejected. */
const rowIsBlank = (r: OwnedRow) => !r.ticker && !r.quantity && !r.avgCost;

function rowProblem(r: OwnedRow): string | null {
  if (rowIsBlank(r)) return null;
  if (!/^[A-Z0-9]{2,10}$/.test(r.ticker)) return "Pick a company from the search.";
  const qty = Number(r.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "Enter how many shares you hold.";
  if (!r.costUnknown) {
    const cost = Number(r.avgCost);
    if (!r.avgCost.trim() || !Number.isFinite(cost) || cost <= 0) return "Enter your average cost, or tick the box below.";
  }
  return null;
}

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
  const [objective, setObjective] = useState<Objective | null>(null);
  const [rows, setRows] = useState<OwnedRow[]>([emptyRow(1)]);
  const nextKey = useRef(2);

  const filledRows = useMemo(() => rows.filter((r) => !rowIsBlank(r)), [rows]);
  const rowsValid = useMemo(() => filledRows.every((r) => rowProblem(r) === null), [filledRows]);

  const canAdvance = useMemo(() => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return !!experience;
    if (step === 2) return !!objective;
    if (step === 3) return filledRows.length > 0 && rowsValid;
    return false;
  }, [step, name, experience, objective, filledRows, rowsValid]);

  async function saveProfile(): Promise<boolean> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Your session expired. Please sign in again.");
      return false;
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: name.trim(),
        experience_level: experience,
        objective,
        onboarded: true,
      })
      .eq("id", user.id);
    if (updateError) {
      setError(updateError.message);
      return false;
    }
    return true;
  }

  /**
   * Positions go in one at a time and through the ledger where a cost is
   * known: a BUY dated today via /api/transactions, which recomputes the whole
   * portfolio after each save. Unknown-cost rows go through quick-add, which
   * writes a manual holding marked "cost unknown". Sequential on purpose so
   * two recomputes never race each other.
   */
  async function savePositions(): Promise<boolean> {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    for (const r of filledRows) {
      const quantity = Number(r.quantity);
      let res: Response;
      if (r.costUnknown) {
        const body: HoldingQuickAddRequest = { ticker: r.ticker, quantity, avgCost: null };
        res = await fetch("/api/holdings/quick-add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        const body: TransactionWriteRequest = {
          ticker: r.ticker,
          trade_date: today,
          type: "BUY",
          quantity,
          price: Number(r.avgCost),
          notes: "Added during onboarding",
        };
        res = await fetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`${r.ticker}: ${data.error ?? "could not be saved"}`);
        return false;
      }
    }
    return true;
  }

  async function finish(withPositions: boolean) {
    setSaving(true);
    setError(null);
    const ok = (await saveProfile()) && (!withPositions || (await savePositions()));
    if (!ok) {
      setSaving(false);
      return;
    }
    track("onboarding_completed", { withPositions, experience });
    router.push("/dashboard");
    router.refresh();
  }

  function next() {
    if (step < LAST_STEP) setStep((s) => s + 1);
    else void finish(true);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function updateRow(key: number, patch: Partial<OwnedRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
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
              i <= step ? "bg-emerald-600" : "bg-rule"
            )}
          />
        ))}
      </div>

      <div key={step} className="rise rise-1">
        {step === 0 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-2xl font-medium tracking-tight">Welcome. Let us set up your view.</h1>
              <p className="text-sm text-text-muted">
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
          <Step title="What are you investing for?" subtitle="Your main objective for this portfolio.">
            {OBJECTIVE.map((o) => (
              <ChoiceCard key={o.value} {...o} selected={objective === o.value} onClick={() => setObjective(o.value)} />
            ))}
          </Step>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-2xl font-medium tracking-tight">Add what you own</h1>
              <p className="text-sm text-text-muted">
                Search each company by ticker or name and enter the number of shares. Your average cost lets the
                platform show your gain or loss; leave it out if you do not know it.
              </p>
            </div>
            <div className="grid gap-3">
              {rows.map((r) => (
                <OwnedRowEditor
                  key={r.key}
                  row={r}
                  problem={rowProblem(r)}
                  canRemove={rows.length > 1}
                  onChange={(patch) => updateRow(r.key, patch)}
                  onRemove={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((prev) => [...prev, emptyRow(nextKey.current++)])}
              disabled={saving}
            >
              <Plus className="h-4 w-4" /> Add another
            </Button>
          </div>
        )}
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-down">{error}</p>}

      <div className="mt-7 flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)} disabled={saving}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-4">
          {step === LAST_STEP && (
            <button
              type="button"
              onClick={() => void finish(false)}
              disabled={saving}
              className="text-xs font-medium text-text-muted underline-offset-2 hover:text-text-strong hover:underline"
            >
              I will add these later
            </button>
          )}
          <Button onClick={next} disabled={!canAdvance || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {step === LAST_STEP ? "Finish" : "Continue"}
            {!saving && step < LAST_STEP && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-text-muted">
        Not you, or want a different account?{" "}
        <button type="button" onClick={signOut} disabled={saving} className="font-medium text-text-strong underline-offset-2 hover:underline">
          Sign out
        </button>
      </p>
    </div>
  );
}

/**
 * One holding: a ticker search that fills from /api/stocks/search, shares,
 * and an average cost that can be declared unknown.
 */
function OwnedRowEditor({
  row,
  problem,
  canRemove,
  onChange,
  onRemove,
}: {
  row: OwnedRow;
  problem: string | null;
  canRemove: boolean;
  onChange: (patch: Partial<OwnedRow>) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState(row.ticker);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- debounced remote search synced from query. */
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (!open || q.length < 1 || q.toUpperCase() === row.ticker) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setHits((data.results ?? []).slice(0, 6));
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, open, row.ticker]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function pick(hit: SearchHit) {
    onChange({ ticker: hit.ticker, name: hit.companyName });
    setQuery(hit.ticker);
    setOpen(false);
  }

  return (
    <div className="rounded-xl border border-rule bg-surface-raised p-3.5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div ref={boxRef} className="relative space-y-1.5">
          <Label htmlFor={`ticker-${row.key}`}>Company</Label>
          <Input
            id={`ticker-${row.key}`}
            value={query}
            autoComplete="off"
            placeholder="Ticker or name"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              // Typing past a picked ticker clears the pick until a new one is chosen.
              if (row.ticker && e.target.value.toUpperCase() !== row.ticker) onChange({ ticker: "", name: null });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) {
                e.preventDefault();
                pick(hits[0]);
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          {row.name && <p className="truncate text-(length:--text-2xs) text-text-muted">{row.name}</p>}
          {open && (hits.length > 0 || searching) && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-rule bg-surface-raised py-1 shadow-(--shadow-dialog)">
              {searching && hits.length === 0 && (
                <li className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching
                </li>
              )}
              {hits.map((h) => (
                <li key={h.ticker}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(h)}
                    className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-surface-sunken"
                  >
                    <span className="font-semibold text-text-strong">{h.ticker}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{h.companyName ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`qty-${row.key}`}>Shares</Label>
          <Input
            id={`qty-${row.key}`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={row.quantity}
            placeholder="0"
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`cost-${row.key}`}>Average cost</Label>
          <Input
            id={`cost-${row.key}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={row.avgCost}
            placeholder="PKR per share"
            disabled={row.costUnknown}
            onChange={(e) => onChange({ avgCost: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={row.costUnknown}
            onChange={(e) => onChange({ costUnknown: e.target.checked, avgCost: e.target.checked ? "" : row.avgCost })}
            className="h-3.5 w-3.5 accent-emerald-600"
          />
          I do not know my average cost
        </label>
        {canRemove && (
          <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-strong" aria-label="Remove this row">
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
      {problem && <p className="mt-2 text-xs text-down">{problem}</p>}
    </div>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        <p className="text-sm text-text-muted">{subtitle}</p>
      </div>
      <div className="grid gap-2.5">{children}</div>
    </div>
  );
}

export function OnboardingBrand() {
  return (
    <div className="mb-8 flex items-center gap-2.5">
      <PlumbMark size={24} className="text-text-strong" />
      <span className="text-[15px] font-semibold tracking-tight">PortfolioOS PK</span>
    </div>
  );
}
