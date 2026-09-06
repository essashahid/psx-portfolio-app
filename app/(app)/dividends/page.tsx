import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDividends } from "@/lib/dividends/summary";
import { getTaxSettings } from "@/lib/dividends/tax";
import { normalizeEvent, type DividendEvent } from "@/lib/dividends/engine";
import { DividendManager } from "@/components/features/dividends/dividend-form";
import { DividendIncomeWorkspace } from "@/components/features/dividends/dividend-income-workspace";
import { DividendTrajectory, DividendYieldTable, TaxYearStatement } from "@/components/features/dividends/dividend-analytics";
import { Band } from "@/components/ui/band";
import { MoreDetail } from "@/components/shared/more-detail";

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dividends, taxSettings, eventsRes, profileRes] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDividends(supabase, user.id),
    getTaxSettings(supabase, user.id),
    supabase.from("dividend_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("profiles").select("demo_mode").eq("id", user.id).maybeSingle(),
  ]);
  const isDemo = Boolean(profileRes.data?.demo_mode);

  const asOf = new Date().toISOString().slice(0, 10);
  const events: DividendEvent[] = (eventsRes.data ?? []).map((row) => normalizeEvent(row as Record<string, unknown>));
  const taxRate = taxSettings.dividend_tax_rate !== null ? `${(taxSettings.dividend_tax_rate * 100).toFixed(0)}%` : "Not configured";


  return (
    <div className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)" style={{ background: "color-mix(in oklab, var(--saffron-4) 40%, var(--surface-page))" }}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-saffron" />
            <h1 className="font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Dividend income</h1>
            {!isDemo && <p className="mt-2 text-(length:--text-2xs) text-text-faint">{taxSettings.taxpayer_status === "filer" ? "ATL filer" : taxSettings.taxpayer_status} · estimated rate {taxRate} · {taxSettings.configured ? `tax year ${taxSettings.tax_year}` : "profile needs confirmation"}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isDemo && <DividendManager dividends={dividends} holdings={summary.holdings} triggerOnly />}
          </div>
        </div>

        {!taxSettings.configured && !isDemo && <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Tax profile is not saved. Amounts use the current default assumptions.</p>}

        <div className="mt-6">
          <DividendIncomeWorkspace dividends={dividends} events={events} holdings={summary.holdings} asOf={asOf} readOnly={isDemo} />
        </div>
      </Band>

      <Band tone="paper" rule="none" className="dot-grid px-3 sm:px-4 md:px-(--gutter-page)">
        {/*
          What was received and the ledger lead, in the band above. The
          statement stays in view because it is the one thing a filer needs
          from this page; the trajectory follows it, and the per-holding
          yield table sits behind a fold.
        */}
        <section className="mt-2">
          <p className="eyebrow">Statement</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Tax-year statement</h2>
          <div className="mt-5">
            <TaxYearStatement dividends={dividends} defaultYear={taxSettings.tax_year ?? null} />
          </div>
        </section>

        <section className="mt-10 border-t border-rule pt-7">
          <p className="eyebrow">Income trajectory</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">By calendar year</h2>
          <div className="mt-5">
            <DividendTrajectory dividends={dividends} events={events} />
          </div>
        </section>

        <MoreDetail className="mt-10">
          <p className="eyebrow">Yield by holding</p>
          <h3 className="mt-1.5 font-display text-(length:--text-h2) font-normal tracking-editorial text-text-strong">Trailing twelve months</h3>
          <div className="mt-5">
            <DividendYieldTable dividends={dividends} holdings={summary.holdings} asOf={asOf} />
          </div>
        </MoreDetail>
      </Band>
    </div>
  );
}
