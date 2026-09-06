/**
 * Deterministic, personalized sample prompts for the Ask empty state. Pure
 * data (no LLM, no DB) so the suggestion pool regenerates instantly when the
 * user switches models or shuffles. This is also the fallback when the
 * generated pool in lib/chat/suggest.ts is missing or fails its gate.
 *
 * The pool is explain-first: questions about what the user owns, how it is
 * doing, what happened, and what terms mean, using their real tickers. It
 * never suggests a buy, trim or sell question.
 *
 * Two dimensions decide which prompts a user sees:
 *
 *  - Model tier: models that chain many tools (Sonnet, Opus, V4 Pro) get the
 *    whole-book explanations; lighter models get single-stock questions that
 *    the pre-built brief already answers.
 *
 *  - Data tier: ledger imported (cost-basis prompts), holdings only, or
 *    nothing yet (general PSX explanations).
 */

import type { ChatModelId } from "@/lib/ai/models";

export interface PromptContext {
  /** True when the user has any imported/recorded transactions (enables ledger prompts). */
  hasLedger: boolean;
  holdingsCount: number;
  cashBalance: number | null;
  /** Top holdings by weight, largest first (up to ~8 for variety). */
  top: { ticker: string; sector: string | null; weightPct: number | null }[];
  /** Heaviest sector by value, for concentration prompts. */
  topSector: string | null;
  /** Distinct sector names the user holds, heaviest first. */
  sectors: string[];
  /** True when at least one holding has a saved thesis (enables thesis-drift prompts). */
  hasThesis: boolean;
}

type Tier = "focused" | "medium" | "deep";

function tierFor(model: ChatModelId): Tier {
  switch (model) {
    case "claude-opus":
    case "claude-sonnet":
    // V4 Pro chained 30+ tool calls cleanly through the July 2026 test run, so
    // it earns the deep portfolio-wide prompts; "medium" remains for a future
    // mid-weight model.
    case "deepseek-pro":
      return "deep";
    case "claude-haiku":
    default:
      return "focused";
  }
}

/**
 * Build the ordered suggestion pool for a model + portfolio. The caller shows
 * the first few and rotates through the rest on "Try another".
 */
export function buildSuggestions(model: ChatModelId, ctx?: PromptContext | null): string[] {
  const tier = tierFor(model);
  const tickers = (ctx?.top ?? []).map((h) => h.ticker);
  const t1 = tickers[0] ?? null;
  const t2 = tickers[1] ?? null;
  const sectors = ctx?.sectors?.length ? ctx.sectors : ctx?.topSector ? [ctx.topSector] : [];
  const sector1 = ctx?.top[0]?.sector ?? ctx?.topSector ?? sectors[0] ?? null;
  const hasHoldings = (ctx?.holdingsCount ?? 0) > 0 && !!t1;
  const hasLedger = !!ctx?.hasLedger;
  const hasThesis = !!ctx?.hasThesis;

  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && !out.includes(s)) out.push(s);
  };

  if (hasHoldings) {
    // The core explain-first pool: the same nine kinds of question for every
    // model, ordered so the first four are the ones a new user most often has.
    add(`Why is my portfolio down today?`);
    add(`How much have I earned from dividends this tax year?`);
    add(t1 ? `Explain ${t1}'s latest results simply` : null);
    add(t1 ? `What does P/E mean, and what is ${t1}'s?` : null);
    add(t2 ? `Why did ${t2} move today?` : t1 ? `Why did ${t1} move today?` : null);
    add(`What are the important developments in my holdings?`);
    add(`Which of my holdings are most concentrated?`);
    add(`How has my portfolio done against the KSE-100?`);
    add(`What does this dividend announcement mean for me?`);

    if (tier === "deep") {
      // Models that chain many tools can take whole-book explanations.
      add(`Which of my holdings pay most of my dividend income, and how reliable is each payer?`);
      add(`How does the current SBP policy rate affect each of my holdings?`);
      add(sector1 ? `Explain how much of my portfolio depends on ${sector1}, and what drives that sector.` : null);
      add(t1 && t2 ? `Explain the difference between ${t1} and ${t2} as businesses.` : null);
      add(`Which of my holdings beat the KSE-100 over my holding period, and which lagged?`);
      if (hasThesis) add(`Which of my holdings still match the thesis I wrote for them?`);
      if (hasLedger) add(`Explain how my average cost in each holding was built up over my purchases.`);
      for (const t of tickers.slice(0, 6)) {
        add(`What does ${t} actually do, and how does it make money?`);
        add(`Explain ${t}'s dividend history and what the yield on my cost is.`);
      }
    } else {
      // Focused: single-stock explanations answerable from the pre-built brief.
      for (const t of tickers.slice(0, 6)) {
        add(`What does ${t} actually do, and how does it make money?`);
        add(`Explain ${t}'s dividend history and what the yield on my cost is.`);
        add(`What is the latest news affecting ${t}?`);
        if (hasThesis) add(`Does ${t} still match the thesis I wrote for it?`);
        if (hasLedger) add(`Explain how my average cost in ${t} was built up over my purchases.`);
      }
      for (const s of sectors.slice(0, 3)) add(`Explain what drives the ${s} sector on the PSX.`);
    }
  } else {
    // No holdings yet: general PSX explanations over well-known large caps.
    const names = ["MEBL", "OGDC", "LUCK", "ENGRO", "FFC", "UBL", "PPL", "HBL"];
    const secs = ["cement", "bank", "fertilizer", "oil and gas", "power"];
    add(`What does P/E mean, and how do I read it for a PSX stock?`);
    add(`What is the difference between dividend yield and yield on cost?`);
    add(`What does book closure mean for a dividend?`);
    add(`How does withholding tax on dividends work for a filer and a non-filer?`);
    for (const n of names.slice(0, 5)) add(`What does ${n} actually do, and how does it make money?`);
    for (const s of secs) add(`Explain what drives the ${s} sector on the PSX.`);
  }

  // Always-available breadth (market, sectors, flows, filings).
  add(`What moved the PSX market today and which sectors led?`);
  add(`Which PSX sectors are leading and lagging right now?`);
  add(`What are foreign investors net buying and selling on the PSX lately?`);
  add(hasHoldings ? `Summarise today's official filings affecting my holdings.` : `Summarise today's notable PSX filings and announcements.`);

  return out;
}
