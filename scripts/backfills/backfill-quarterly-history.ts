import { loadEnvLocal } from "../lib/load-env";

/**
 * Build a complete discrete-quarter EPS history for one company.
 *
 * The quarterly series the stock page draws comes from the PSX company page,
 * which publishes a rolling four columns and nothing older. OGDC's read as
 * Q3 FY2026, Q1 FY2026, Q3 FY2025, Q2 FY2025 — four quarters, one year-on-year
 * pair, three dashes. That is the whole of what that source will ever give.
 *
 * The filings hold the rest. Two things stand between them and a full series:
 *
 *   REACH   PSX serves at most 100 announcement rows per response, and the
 *           extractor only ever read page one. For a busy filer that is under
 *           two years. Paging (getCompanyFilingArchive) reaches back to 2014.
 *
 *   SHAPE   PSX interims are CUMULATIVE. A company files 3M, 6M and 9M, then a
 *           full year. It never files Q2, Q3 or Q4 as a standalone quarter, so
 *           those three of every four quarters do not exist in any document
 *           and have to be differenced out:
 *
 *             Q1 = 3M            Q2 = 6M − 3M
 *             Q3 = 9M − 6M       Q4 = FY − 9M
 *
 * So: page the archive, pick the one best PDF per reporting period, run each
 * through the existing validated extractor, then difference the cumulative
 * rows into discrete quarters. Every derived row carries the two source rows
 * it came from in _derived_from, and is written through the same conflict and
 * identity gate as everything else.
 *
 *   AI_DISABLED=false VISION_DISABLED=false \
 *     npx tsx scripts/backfills/backfill-quarterly-history.ts OGDC --years 5
 *
 *   --dry           plan only: list the filings and derivations, read nothing
 *   --derive-only   skip extraction, just difference what is already stored
 *   --force         re-extract filings already read once
 */

import {
  classifyTitle,
  filingDateMs as dateMs,
  inferFiscalYearEndMonth,
  isReportTitle,
  rankReportTitle as rankTitle,
  type FilingPeriod as Period,
  type FilingTarget as Target,
} from "@/lib/company/filing-periods";

type Candidate = Target & { title: string; url: string; date: string | null; rank: number };

/** Income-statement figures that accumulate through a fiscal year, so they subtract. */
const FLOW_KEYS = [
  "revenue", "cost_of_sales", "gross_profit", "operating_expenses", "operating_profit",
  "finance_cost", "profit_before_tax", "tax", "profit_after_tax", "eps",
] as const;

const num = (data: Record<string, unknown> | null, key: string): number | null => {
  const v = data?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const key = (t: Target) => `FY${t.fiscalYear}-${t.period}`;

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const ticker = (args.find((a) => !a.startsWith("--")) ?? "").toUpperCase();
  if (!ticker) {
    console.error("usage: backfill-quarterly-history.ts <TICKER> [--years 5] [--dry] [--derive-only] [--force]");
    process.exit(1);
  }
  const years = Number(args.find((a) => a.startsWith("--years"))?.split("=")[1] ?? args[args.indexOf("--years") + 1]) || 5;
  const dry = args.includes("--dry");
  const deriveOnly = args.includes("--derive-only");
  const force = args.includes("--force");

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { getCompanyFilingArchive } = await import("@/lib/company/filings");
  const { extractFinancials, saveManualStatements } = await import("@/lib/engine/financials");
  const db = createAdminClient();

  // ---------------------------------------------------------------------
  // Fiscal calendar. Every period label below depends on it, so a wrong
  // year-end silently mislabels the whole history rather than failing.
  // ---------------------------------------------------------------------
  const { data: meta } = await db
    .from("company_metadata")
    .select("fiscal_year_end_month")
    .eq("ticker", ticker)
    .maybeSingle();
  let fyEndMonth = meta?.fiscal_year_end_month as number | null;

  const archive = await getCompanyFilingArchive(ticker, {
    notBefore: new Date(new Date().getFullYear() - years - 1, 0, 1),
  });
  const reports = archive.filter((f) => f.url.toLowerCase().endsWith(".pdf") && isReportTitle(f.title));

  if (!fyEndMonth) {
    // Read it off the annual filings: their period-end month IS the year end.
    fyEndMonth = inferFiscalYearEndMonth(reports.map((f) => f.title));
    if (!fyEndMonth) {
      console.error(`${ticker}: fiscal year end unknown and not inferable from filing titles. Aborting rather than guessing.`);
      process.exit(1);
    }
    console.log(`${ticker}: fiscal year end inferred as month ${fyEndMonth} from annual filing titles.`);
  }

  console.log(`\n${ticker} — archive: ${archive.length} announcements, ${reports.length} report PDFs, fiscal year ends month ${fyEndMonth}\n`);

  // ---------------------------------------------------------------------
  // One best filing per reporting period.
  // ---------------------------------------------------------------------
  const byTarget = new Map<string, Candidate>();
  const unclassified: string[] = [];
  for (const f of reports) {
    const target = classifyTitle(f.title, fyEndMonth!);
    if (!target) { unclassified.push(`${f.date} | ${f.title}`); continue; }

    const cand: Candidate = { ...target, title: f.title, url: f.url, date: f.date, rank: rankTitle(f.title) };
    const held = byTarget.get(key(target));
    if (!held || cand.rank < held.rank || (cand.rank === held.rank && dateMs(cand.date) > dateMs(held.date))) {
      byTarget.set(key(target), cand);
    }
  }

  // Anchor the window on the newest fiscal year that has actually been filed,
  // not on today's date. A June year-end company is already in FY2027 by every
  // July, but files nothing for it until October — dating the window off the
  // calendar spends a year of the requested five on empty rows.
  const filedYears = [...byTarget.values()].map((c) => c.fiscalYear);
  const currentFy = filedYears.length ? Math.max(...filedYears) : new Date().getFullYear();
  const oldestFy = currentFy - years + 1;

  if (unclassified.length) {
    console.log(`Report PDFs whose period could not be read from the title (${unclassified.length}, skipped):`);
    for (const u of unclassified) console.log(`  ${u}`);
    console.log("");
  }

  // ---------------------------------------------------------------------
  // What is already stored, so we neither re-pay for a filing nor overwrite
  // a good row.
  // ---------------------------------------------------------------------
  const loadStored = async () => {
    const { data } = await db
      .from("company_financials")
      .select("fiscal_year, fiscal_period, period_type, statement_type, source_url, source_type, reporting_basis, review_status, reported_date, updated_at, data")
      .eq("ticker", ticker)
      .eq("statement_type", "income_statement")
      .eq("review_status", "published");
    return data ?? [];
  };
  let stored = await loadStored();
  const storedPeriods = new Set(stored.map((r) => `FY${r.fiscal_year}-${r.fiscal_period}`));

  const wanted: Candidate[] = [];
  for (let fy = oldestFy; fy <= currentFy; fy++) {
    for (const p of ["Q1", "H1", "9M", "FY"] as Period[]) {
      const cand = byTarget.get(key({ fiscalYear: fy, period: p }));
      const have = storedPeriods.has(`FY${fy}-${p}`);
      const status = !cand ? "NOT FILED YET / not on portal" : have && !force ? "already stored" : "EXTRACT";
      console.log(`  FY${fy} ${p.padEnd(2)}  ${status.padEnd(24)} ${cand ? cand.title.slice(0, 72) : ""}`);
      if (cand && (!have || force)) wanted.push(cand);
    }
  }
  console.log(`\n${wanted.length} filing(s) to extract.`);

  // ---------------------------------------------------------------------
  // Extract.
  // ---------------------------------------------------------------------
  if (!dry && !deriveOnly && wanted.length) {
    for (const [i, f] of wanted.entries()) {
      process.stdout.write(`\n[${i + 1}/${wanted.length}] FY${f.fiscalYear} ${f.period} — ${f.title.slice(0, 64)}\n`);
      const r = await extractFinancials(ticker, 1, force, [{ url: f.url, title: f.title, date: f.date }]);
      console.log(`    saved ${r.saved}, processed ${r.processed}`);
      for (const s of r.skipped) console.log(`    skipped: ${s}`);
      for (const e of r.errors) console.log(`    error:   ${e}`);
    }
    stored = await loadStored();
  }

  if (dry) {
    console.log("\n--dry: stopping before extraction and derivation.");
    return;
  }

  // ---------------------------------------------------------------------
  // Repair comparative bleed before deriving anything from these rows.
  //
  // Every interim filing prints the current period beside the same period a
  // year earlier. The extractor reads both columns, and on some filings it
  // assigns the two fiscal years the wrong way round — OGDC's September 2022
  // report yielded the Sep-2021 comparative labelled FY2023 Q1 and the real
  // Sep-2022 quarter labelled FY2022 Q1, an exact swap. Nothing errors: both
  // figures are real, both are plausible, and the wrong one is a year stale.
  //
  // It is caught without an LLM and without reading the PDF, because a
  // comparative that has been mislabelled is a VERBATIM COPY of a row some
  // other filing already reported for the year it was really about. Two
  // fiscal periods of genuine trading never agree to the rupee on both
  // revenue and profit. Where the correct column is also in the observation
  // ledger under the wrong year, the labels are simply swapped back; where it
  // is not, the row is quarantined rather than served.
  // ---------------------------------------------------------------------
  // Profit after tax, to the rupee, is the fingerprint. The bleed is not always
  // a whole-column copy: OGDC's December 2023 half-year yielded a Q2 carrying
  // that year's revenue beside the PRIOR year's profit and EPS, the model
  // having taken the two figures from different columns of the same table.
  // Matching on revenue as well would have missed it. Two quarters of real
  // trading do not post the same profit to the rupee.
  const fingerprint = (d: Record<string, unknown>): string | null => {
    const pat = num(d, "profit_after_tax");
    return pat === null ? null : String(pat);
  };

  const bled: { fy: number; period: string; url: string | null; fp: string }[] = [];
  for (const r of stored) {
    const fp = fingerprint((r.data ?? {}) as Record<string, unknown>);
    if (!fp) continue;
    const twin = stored.find(
      (o) =>
        o.fiscal_period === r.fiscal_period &&
        o.fiscal_year !== r.fiscal_year &&
        o.source_url !== r.source_url &&
        fingerprint((o.data ?? {}) as Record<string, unknown>) === fp
    );
    if (!twin) continue;
    // The filing that reported the period FIRST is reporting it as current;
    // the later one is repeating it as a comparative and has mislabelled it.
    if (dateMs((r.reported_date as string | null) ?? null) <= dateMs((twin.reported_date as string | null) ?? null)) continue;
    bled.push({ fy: r.fiscal_year as number, period: String(r.fiscal_period), url: r.source_url as string | null, fp });
  }

  if (bled.length) {
    console.log(`\nComparative bleed detected (${bled.length} row(s) duplicate another year to the rupee):`);
    for (const b of bled) {
      // The same filing's other reading of this period, under a year that no
      // other filing corroborates, is the column that was actually current.
      const { data: siblings } = await db
        .from("financial_statement_observations")
        .select("fiscal_year, fiscal_period, data")
        .eq("ticker", ticker)
        .eq("statement_type", "income_statement")
        .eq("fiscal_period", b.period)
        .eq("source_url", b.url);

      const replacement = (siblings ?? []).find((s) => {
        const fp = fingerprint((s.data ?? {}) as Record<string, unknown>);
        return fp !== null && fp !== b.fp;
      });

      if (replacement) {
        const d = (replacement.data ?? {}) as Record<string, unknown>;
        const figures: Record<string, number | null> = {};
        for (const k of FLOW_KEYS) {
          const v = num(d, k);
          if (v !== null) figures[k] = v;
        }
        await db
          .from("company_financials")
          .update({ review_status: "needs_review" })
          .eq("ticker", ticker)
          .eq("statement_type", "income_statement")
          .eq("fiscal_year", b.fy)
          .eq("fiscal_period", b.period)
          .eq("source_url", b.url);
        const res = await saveManualStatements(
          ticker,
          { url: b.url, date: null, sourceType: "psx-filing", extractor: "comparative-swap-repair" },
          [{ fiscal_year: b.fy, fiscal_period: b.period, statement_type: "income_statement", basis: "unconsolidated", data: figures, confidence: 0.9 }]
        );
        console.log(`  FY${b.fy} ${b.period}: relabelled from the same filing's other column, eps ${figures.eps}${res.errors.length ? ` (${res.errors.join("; ")})` : ""}`);
      } else {
        await db
          .from("company_financials")
          .update({ review_status: "needs_review" })
          .eq("ticker", ticker)
          .eq("statement_type", "income_statement")
          .eq("fiscal_year", b.fy)
          .eq("fiscal_period", b.period)
          .eq("source_url", b.url);
        console.log(`  FY${b.fy} ${b.period}: no clean column in the same filing — quarantined rather than served`);
      }
    }
    stored = await loadStored();
  }

  // ---------------------------------------------------------------------
  // Difference the cumulative rows into discrete quarters.
  // ---------------------------------------------------------------------

  // Cumulative rows, keyed by year+period+basis. Basis is part of the key, not
  // collapsed away: a company can hold an unconsolidated reading from its own
  // filing AND an unlabelled one from the portal for the same period, and
  // which of the two we subtract from decides whether the answer means
  // anything. Within one basis, the newest extraction wins — the same rule the
  // stock page applies to competing readings.
  type CumRow = { data: Record<string, unknown>; basis: string; url: string | null };
  const cumulative = new Map<string, CumRow[]>();
  for (const r of [...stored].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))) {
    const p = r.fiscal_period as string | null;
    if (!p || !["Q1", "H1", "9M", "FY"].includes(p)) continue;
    const basis = (r.reporting_basis as string | null) ?? "unlabelled";
    const list = cumulative.get(`${r.fiscal_year}-${p}`) ?? [];
    const row: CumRow = { data: (r.data ?? {}) as Record<string, unknown>, basis, url: r.source_url as string | null };
    const at = list.findIndex((x) => x.basis === basis);
    if (at >= 0) list[at] = row;
    else list.push(row);
    cumulative.set(`${r.fiscal_year}-${p}`, list);
  }

  /**
   * The two rows to subtract, preferring a matched pair.
   *
   * Subtracting a consolidated cumulative from an unconsolidated one describes
   * no entity at all, so a definite mismatch is refused outright. "unlabelled"
   * is not a competing claim, though — it is the portal declining to say — so
   * it pairs with anything, and the caller is told when that happened.
   */
  const pickPair = (cum: CumRow[], prior: CumRow[]): { cum: CumRow; prior: CumRow; mixed: boolean } | null => {
    for (const c of cum) {
      const p = prior.find((x) => x.basis === c.basis);
      if (p) return { cum: c, prior: p, mixed: false };
    }
    for (const c of cum) {
      const p = prior.find((x) => x.basis === "unlabelled" || c.basis === "unlabelled");
      if (p) return { cum: c, prior: p, mixed: true };
    }
    return null;
  };

  /**
   * Rows whose EPS and profit come from different columns of the same table.
   *
   * A filing's interim statement prints the cumulative period beside the
   * discrete quarter, and the extractor can take profit from one column and
   * EPS from the other. The row then looks entirely reasonable: both figures
   * are real, both appear in the document, and nothing about their
   * combination is obviously wrong. FCCL's H1 FY2026 carried profit of
   * 7,316,529 against EPS of 1.64, which is the quarter's EPS, not the half
   * year's.
   *
   * Profit divided by EPS is the company's share count, and that is close to
   * constant across periods. So a row whose implied share count is nowhere
   * near the company's own median is mixing columns, and subtracting it
   * produces a quarter that never happened. Bonus issues and splits do move
   * the real count, which is why this only excludes a row from arithmetic and
   * reports it, rather than trying to correct it.
   */
  const impliedShares = (d: Record<string, unknown>): number | null => {
    const pat = num(d, "profit_after_tax");
    const eps = num(d, "eps");
    if (pat === null || eps === null || Math.abs(eps) < 0.01) return null;
    return pat / eps;
  };
  const shareCounts = stored
    .map((r) => impliedShares((r.data ?? {}) as Record<string, unknown>))
    .filter((n): n is number => n !== null && n > 0)
    .sort((a, b) => a - b);
  const medianShares = shareCounts.length ? shareCounts[Math.floor(shareCounts.length / 2)] : null;
  const SHARE_TOLERANCE = 0.1;
  const columnMixed = (d: Record<string, unknown>): boolean => {
    if (medianShares === null) return false;
    const s = impliedShares(d);
    if (s === null || s <= 0) return false;
    return Math.abs(s / medianShares - 1) > SHARE_TOLERANCE;
  };

  // Keyed by basis as well as period. NML files a consolidated and an
  // unconsolidated set, and collapsing them meant the cross-check compared a
  // derived unconsolidated quarter against whichever consolidated row happened
  // to be read last, reporting a 55% discrepancy between two figures that were
  // both correct and simply describe different reporting entities.
  const publishedQuarters = new Map<string, Record<string, unknown>>();
  for (const r of stored) {
    if (r.period_type === "quarterly" && /^Q[1-4]$/.test(String(r.fiscal_period))) {
      const basis = (r.reporting_basis as string | null) ?? "unlabelled";
      publishedQuarters.set(`${r.fiscal_year}-${r.fiscal_period}-${basis}`, (r.data ?? {}) as Record<string, unknown>);
    }
  }

  /** The directly-reported quarter a derived one should be checked against: same basis, else an unlabelled reading. */
  const reportedQuarter = (fy: number, q: string, basis: string | null): Record<string, unknown> | null =>
    publishedQuarters.get(`${fy}-${q}-${basis ?? "unlabelled"}`) ??
    publishedQuarters.get(`${fy}-${q}-unlabelled`) ??
    null;

  // Q1 is already a standalone quarter; the other three are differences.
  const RECIPES: { quarter: string; cumulative: Period; prior: Period }[] = [
    { quarter: "Q2", cumulative: "H1", prior: "Q1" },
    { quarter: "Q3", cumulative: "9M", prior: "H1" },
    { quarter: "Q4", cumulative: "FY", prior: "9M" },
  ];

  type Derived = { fy: number; quarter: string; data: Record<string, number | null>; basis: string | null; from: string; mixed: boolean };
  const derived: Derived[] = [];
  const crossChecks: string[] = [];
  const gaps: string[] = [];

  for (let fy = oldestFy; fy <= currentFy; fy++) {
    for (const recipe of RECIPES) {
      const cumRows = cumulative.get(`${fy}-${recipe.cumulative}`);
      const priorRows = cumulative.get(`${fy}-${recipe.prior}`);
      if (!cumRows?.length || !priorRows?.length) {
        if (cumRows?.length || priorRows?.length) {
          gaps.push(`FY${fy} ${recipe.quarter}: needs ${recipe.cumulative} and ${recipe.prior}, have only ${cumRows?.length ? recipe.cumulative : recipe.prior}`);
        }
        continue;
      }
      const pair = pickPair(cumRows, priorRows);
      if (!pair) {
        gaps.push(`FY${fy} ${recipe.quarter}: ${recipe.cumulative} is ${cumRows.map((r) => r.basis).join("/")}, ${recipe.prior} is ${priorRows.map((r) => r.basis).join("/")} — refusing to subtract across bases`);
        continue;
      }
      const { cum, prior, mixed } = pair;

      if (columnMixed(cum.data) || columnMixed(prior.data)) {
        const which = columnMixed(cum.data) ? recipe.cumulative : recipe.prior;
        const bad = columnMixed(cum.data) ? cum.data : prior.data;
        gaps.push(
          `FY${fy} ${recipe.quarter}: ${which} FY${fy} implies ${(impliedShares(bad)! / 1000).toFixed(0)}m shares against a median of ${(medianShares! / 1000).toFixed(0)}m — its EPS and profit come from different columns, not subtracting it`
        );
        continue;
      }

      const data: Record<string, number | null> = {};
      let any = false;
      for (const k of FLOW_KEYS) {
        const a = num(cum.data, k);
        const b = num(prior.data, k);
        if (a === null || b === null) continue;
        data[k] = k === "eps" ? Number((a - b).toFixed(2)) : Math.round(a - b);
        any = true;
      }
      if (!any || data.eps === undefined) {
        gaps.push(`FY${fy} ${recipe.quarter}: ${recipe.cumulative} or ${recipe.prior} carries no comparable EPS`);
        continue;
      }

      const existing = reportedQuarter(fy, recipe.quarter, mixed ? null : cum.basis);
      if (existing) {
        // The PSX company page publishes some discrete quarters directly. Where
        // it does, it is an independent check on the arithmetic rather than
        // something to overwrite.
        const theirs = num(existing, "eps");
        const ours = data.eps;
        if (theirs !== null && ours !== null) {
          const off = Math.abs(theirs) > 0.01 ? Math.abs((ours - theirs) / theirs) * 100 : Math.abs(ours - theirs);
          // Flagged only when the gap is both proportionally and absolutely
          // material. EPS is published to two decimals, so a cement company
          // earning 0.62 a share against a stored 0.64 is one rounding step
          // apart and reads as a 3% discrepancy; chasing those buries the
          // handful of real ones. A quarter has to miss by a whole paisa-and-a
          // -half AND by more than 2% to be worth anyone's attention.
          const material = off > 2 && Math.abs(ours - theirs) >= 0.05;
          crossChecks.push(
            `FY${fy} ${recipe.quarter}: stored ${theirs.toFixed(2)} vs derived ${ours.toFixed(2)} (${off.toFixed(1)}% apart)${material ? "  <-- CHECK" : ""}`
          );
        }
        continue; // never overwrite a directly-reported quarter
      }

      derived.push({
        fy,
        quarter: recipe.quarter,
        data,
        basis: mixed ? null : cum.basis,
        from: `${recipe.cumulative} FY${fy} (${cum.basis}) minus ${recipe.prior} FY${fy} (${prior.basis})`,
        mixed,
      });
    }
  }

  if (gaps.length) {
    console.log(`\nQuarters that could not be derived (${gaps.length}):`);
    for (const g of gaps) console.log(`  ${g}`);
  }
  if (crossChecks.length) {
    console.log(`\nCross-check against quarters PSX reports directly (${crossChecks.length}):`);
    for (const c of crossChecks) console.log(`  ${c}`);
  }

  console.log(`\n${derived.length} quarter(s) to write:`);
  for (const d of derived) console.log(`  FY${d.fy} ${d.quarter}  eps ${d.data.eps}  (${d.from})${d.mixed ? "  [mixed basis]" : ""}`);

  for (const d of derived) {
    const res = await saveManualStatements(
      ticker,
      { url: null, date: null, sourceType: "derived-quarter", extractor: "cumulative-difference" },
      [{
        fiscal_year: d.fy,
        fiscal_period: d.quarter,
        statement_type: "income_statement",
        basis: d.basis,
        data: { ...d.data, _derived_from: d.from } as unknown as Record<string, number | null>,
        // Arithmetic on two published filings, not a reading. A pair whose
        // bases did not match is the same arithmetic on a weaker premise.
        confidence: d.mixed ? 0.8 : 0.95,
      }]
    );
    if (res.errors.length) console.log(`  FY${d.fy} ${d.quarter}: ${res.errors.join("; ")}`);
    else if (res.needsReview) console.log(`  FY${d.fy} ${d.quarter}: staged for review (disagrees with a published row)`);
  }

  console.log(`\nDone. Reload the stock page for ${ticker}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
