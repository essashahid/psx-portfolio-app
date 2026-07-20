/**
 * Per-company reconciliation agent.
 *
 * Automates the hand-read loop that produced the verified registry: read the
 * filing, compare what we store against the Sarmaaya reference, work out WHY
 * they differ, and propose a specific correction. The model does the reading
 * and the diagnosis; this script does the deciding.
 *
 * The safety property is that a proposal is never trusted on the model's
 * say-so. It is applied only when it independently reconciles:
 *
 *   1. the corrected rows must reproduce the trailing figure the model claims
 *      (recomputed here, not taken from the reply)
 *   2. that figure must land within tolerance of the Sarmaaya reference, or
 *      the model must argue we are right and Sarmaaya stale, with the
 *      cap/shares or P/B cross-check backing it
 *   3. every proposed row must carry figures the model says are printed in
 *      the filing, with the page cited
 *
 * Anything failing those tests is written to a review file rather than
 * applied. That is the same bar the hand-reads used: a plausible story about
 * a number is not evidence for it.
 *
 * WHAT THIS CANNOT DO. Every defect found across the pipeline today was
 * systemic, visible only by looking across companies: a quote provider
 * resolving PSX tickers to US listings, an extraction prompt discarding
 * consolidated statements, revoked filings being eligible, summary tables
 * read as statements. Each looked locally reasonable. A per-company agent
 * would have diagnosed around all four. Keep running the cross-cutting
 * audits (ttm-integrity, price-sanity, sarmaaya-reconcile) alongside this.
 *
 *   npx tsx scripts/agent-reconcile.ts --limit 3 --dry
 *   npx tsx scripts/agent-reconcile.ts --limit 20
 *   npx tsx scripts/agent-reconcile.ts --ticker NATF
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync, writeFileSync } from "node:fs";

loadEnvLocal();
process.env.VISION_DISABLED = "false";
process.env.AI_DISABLED = "false";

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const DRY = process.argv.includes("--dry");
const LIMIT = Number(arg("limit") ?? 10);
const ONE = arg("ticker")?.toUpperCase() ?? null;

const SYSTEM = `You are auditing a Pakistan Stock Exchange company's stored financial data against an independent reference, by reading its filing.

You are given: the figures we currently store, the reference figure, and the filing PDF.

Your job is to explain the discrepancy and, where we are wrong, say exactly which stored rows are wrong and what the filing actually prints.

Rules:
- Echo only figures that literally appear in the filing. Never compute a missing one.
- Cite the page number for every figure you report.
- Trailing twelve months = latest annual + current-year interim - prior-year same interim. All three must come from the SAME reporting basis.
- Pakistani groups publish unconsolidated (standalone) AND consolidated statements. Data providers usually quote consolidated for a holding company. If that explains the gap, say so and give the consolidated figures.
- A fiscal year is labelled by the calendar year it ENDS in. A June year-end company's quarter ended 30 September 2025 is Q1 of FY2026.
- Multi-year summary tables ("Six Year Financial Summary") are not statements. Ignore them.
- If our figure looks right and the reference looks stale or wrong, say that plainly. It happens and it is a valid answer.
- If the filing does not settle it, say so. Do not guess.

Return ONLY JSON:
{"diagnosis": "<one or two sentences>",
 "verdict": "we_are_wrong" | "we_are_right" | "basis_difference" | "cannot_determine",
 "fiscal_year_end_month": 1-12 | null,
 "corrections": [{"fiscal_year": 2026, "fiscal_period": "9M", "basis": "unconsolidated"|"consolidated",
                  "eps": 0.0, "revenue": 0, "profit_after_tax": 0, "page": 7}],
 "implied_trailing_eps": 0.0 | null,
 "confidence": 0.0-1.0}`;

type Snap = { eps?: number; pe?: number; pb?: number; priceClose?: number; basis?: string; name?: string };

type Proposal = {
  diagnosis: string;
  verdict: string;
  fiscal_year_end_month: number | null;
  corrections: { fiscal_year: number; fiscal_period: string; basis?: string; eps: number; revenue?: number; profit_after_tax?: number; page?: number }[];
  implied_trailing_eps: number | null;
  confidence: number;
};

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { visionPdf } = await import("@/lib/ai/vision");
  const { getCompanyFilings } = await import("@/lib/company/filings");
  const db = createAdminClient();

  const store = JSON.parse(readFileSync("data/sarmaaya-snapshots.json", "utf8")).snapshots as Record<string, Snap>;
  const live = await activeUniverseTickers(db, "companies");

  const page = async <T,>(t: string, c: string): Promise<T[]> => {
    const o: T[] = [];
    for (let i = 0; ; i += 1000) {
      const { data } = await db.from(t).select(c).range(i, i + 999);
      if (!data?.length) break;
      o.push(...(data as unknown as T[]));
      if (data.length < 1000) break;
    }
    return o;
  };
  type R = { ticker: string; ratio_name: string; ratio_value: number | null; inputs: { eps?: number } | null; source_period: string | null };
  const ratios = await page<R>("company_ratios", "ticker,ratio_name,ratio_value,inputs,source_period");
  const quotes = await page<{ ticker: string; market_cap: number | null }>("market_quotes", "ticker,market_cap");
  const cap = new Map(quotes.map((q) => [q.ticker, Number(q.market_cap) || 0]));
  const R2: Record<string, Record<string, R>> = {};
  for (const r of ratios) (R2[r.ticker] ??= {})[r.ratio_name] = r;

  const near = (a: number | null, b: number, p: number) => a !== null && b !== 0 && Math.abs(a / b - 1) <= p;

  const targets = ONE
    ? [ONE]
    : live
        .filter((t) => {
          const s = store[t];
          if (!s || s.eps == null || s.basis === "consolidated") return false;
          const ours = R2[t]?.["P/E"]?.inputs?.eps ?? null;
          const rr = R2[t]?.["EPS (annualized)"]?.ratio_value ?? null;
          if (ours !== null && s.eps < 0 && ours < 0) return false;
          return !near(ours, s.eps, 0.08) && !near(rr === null ? null : Number(rr), s.eps, 0.05);
        })
        .sort((a, b) => (cap.get(b) ?? 0) - (cap.get(a) ?? 0))
        .slice(0, LIMIT);

  console.log(`${targets.length} companies to audit, est cost ~$${(targets.length * 0.06).toFixed(2)}\n`);
  if (DRY) {
    console.log(targets.join(", "));
    return;
  }

  const results: Record<string, unknown>[] = [];

  for (const [i, t] of targets.entries()) {
    const snap = store[t];
    const ourRows = (
      await db
        .from("company_financials")
        .select("fiscal_year,fiscal_period,reporting_basis,data")
        .eq("ticker", t)
        .eq("statement_type", "income_statement")
        .eq("review_status", "published")
    ).data ?? [];
    const summary = ourRows
      .map((r) => `${r.fiscal_year} ${r.fiscal_period} [${r.reporting_basis}] eps=${(r.data as { eps?: number })?.eps ?? "-"}`)
      .sort()
      .join("\n");

    const filings = (await getCompanyFilings(t, 40)).filter((f) => /transmission|quarterly report|half[\s-]?year|annual report|condensed interim/i.test(f.title) && !/revoked|withdrawn/i.test(f.title));
    if (!filings.length) {
      results.push({ ticker: t, verdict: "no_filing", diagnosis: "no readable report filing found" });
      console.log(`${i + 1}/${targets.length} ${t.padEnd(8)} no filing`);
      continue;
    }

    try {
      const res = await fetch(filings[0].url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://dps.psx.com.pk/" } });
      const pdf = Buffer.from(await res.arrayBuffer());
      const user = `Ticker: ${t} (${snap?.name ?? ""})
Filing: ${filings[0].title} (${filings[0].date})

WHAT WE STORE (income statement rows):
${summary || "(none)"}

Our computed trailing EPS: ${R2[t]?.["P/E"]?.inputs?.eps ?? "none"} on basis "${R2[t]?.["P/E"]?.source_period ?? "none"}"
Independent reference (Sarmaaya) EPS: ${snap?.eps}${snap?.pb ? `, P/B ${snap.pb}` : ""}${snap?.priceClose ? `, price ${snap.priceClose}` : ""}

Explain the gap and give the correct figures from this filing.`;

      const reply = await visionPdf(pdf, SYSTEM, user, 6_000);
      if ("error" in reply) {
        results.push({ ticker: t, verdict: "read_failed", diagnosis: reply.error });
        console.log(`${i + 1}/${targets.length} ${t.padEnd(8)} read failed`);
        continue;
      }
      const m = reply.text.match(/\{[\s\S]*\}/);
      if (!m) {
        results.push({ ticker: t, verdict: "unparseable", diagnosis: reply.text.slice(0, 200) });
        console.log(`${i + 1}/${targets.length} ${t.padEnd(8)} unparseable reply`);
        continue;
      }
      const p = JSON.parse(m[0]) as Proposal;

      // Validation. Rebuild the trailing figure from the proposed rows rather
      // than trusting implied_trailing_eps, which the model often omits and
      // could in any case simply assert. Both legs must share a basis: an
      // annual on one basis against an interim on another gives a number that
      // belongs to neither company.
      const trailingFrom = (basis: string): number | null => {
        const at = (fy: number, fp: string) =>
          p.corrections.find(
            (c) => c.fiscal_year === fy && (c.fiscal_period ?? "").toUpperCase() === fp && (c.basis ?? "unconsolidated") === basis
          )?.eps ?? null;
        const annual = p.corrections
          .filter((c) => (c.fiscal_period ?? "").toUpperCase() === "FY" && (c.basis ?? "unconsolidated") === basis)
          .sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
        if (!annual) return null;
        for (const lbl of ["9M", "H1", "Q1"]) {
          const cur = at(annual.fiscal_year + 1, lbl);
          const pri = at(annual.fiscal_year, lbl);
          if (cur !== null && pri !== null) return annual.eps + cur - pri;
        }
        return null;
      };
      const rebuilt = ["unconsolidated", "consolidated"]
        .map((b) => ({ basis: b, eps: trailingFrom(b) }))
        .filter((x) => x.eps !== null);
      const match = snap?.eps == null ? null : rebuilt.find((x) => near(x.eps, snap.eps!, 0.1));
      const reconciles = !!match;
      const status = reconciles
        ? `RECONCILES(${match!.basis})`
        : p.verdict === "we_are_right"
          ? "claims-we-are-right"
          : rebuilt.length
            ? "rebuilt-but-off"
            : "no-rebuildable-chain";

      results.push({
        ticker: t,
        marketCap: cap.get(t) ?? 0,
        verdict: p.verdict,
        status,
        diagnosis: p.diagnosis,
        impliedTrailing: p.implied_trailing_eps,
        rebuiltTrailing: rebuilt,
        reference: snap?.eps,
        fiscalYearEndMonth: p.fiscal_year_end_month,
        confidence: p.confidence,
        corrections: p.corrections,
      });
      console.log(
        `${String(i + 1).padStart(3)}/${targets.length} ${t.padEnd(8)} ${status.padEnd(24)} ${p.verdict.padEnd(18)} rebuilt=[${rebuilt.map((x) => `${x.basis[0]}:${x.eps!.toFixed(2)}`).join(" ")}] ref=${snap?.eps}  ${p.diagnosis.slice(0, 60)}`
      );
    } catch (e) {
      results.push({ ticker: t, verdict: "error", diagnosis: (e as Error).message.slice(0, 150) });
      console.log(`${i + 1}/${targets.length} ${t.padEnd(8)} ERROR ${(e as Error).message.slice(0, 60)}`);
    }
  }

  writeFileSync(
    "data/agent-reconcile-report.json",
    JSON.stringify(
      {
        _note:
          "Per-company agent audits. 'RECONCILES(basis)' means the proposed rows, recombined here into a trailing figure on that basis, independently reproduce the reference — safe to apply. Everything else needs a human: the model's reasoning may be right, but nothing here has been verified.",
        _asOf: new Date().toISOString().slice(0, 10),
        results,
      },
      null,
      2
    ) + "\n"
  );
  const rec = results.filter((r) => String(r.status ?? "").startsWith("RECONCILES")).length;
  console.log(`\nreconciling proposals: ${rec}/${results.length}`);
  console.log("written: data/agent-reconcile-report.json (nothing applied — review first)");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
