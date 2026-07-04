/**
 * Deterministic, personalized sample prompts for the Research Copilot empty
 * state. Pure data — no LLM, no DB — so the suggestion pool regenerates
 * instantly when the user switches models or shuffles.
 *
 * Two dimensions decide which prompts a user sees:
 *
 *  - Model tier: what the selected model can actually do well. Tool-less /
 *    lightweight models (DeepSeek R1, Haiku) get FOCUSED single-stock prompts
 *    they can answer from the pre-built context. DeepSeek Chat (V3) can call
 *    tools, so it gets MEDIUM, few-stock prompts. Sonnet/Opus can chain many
 *    tools over a big budget, so they get DEEP portfolio-wide and ledger scans.
 *    This steers users away from handing a whole-portfolio scan to a model that
 *    will stall on it.
 *
 *  - Data tier: ledger imported (transaction-level prompts), holdings only
 *    (position prompts), or nothing yet (general PSX prompts).
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

/** A clean round add-size that does not exceed the user's available cash. */
function amountFor(cash: number | null): string {
  const tiers = [1_000_000, 500_000, 250_000, 100_000, 50_000, 25_000];
  const amount = cash && cash >= 25_000 ? tiers.find((t) => cash >= t) ?? 50_000 : 50_000;
  return `PKR ${amount.toLocaleString("en-US")}`;
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
  const amount = amountFor(ctx?.cashBalance ?? null);
  const hasHoldings = (ctx?.holdingsCount ?? 0) > 0 && !!t1;
  const hasLedger = !!ctx?.hasLedger;
  const hasThesis = !!ctx?.hasThesis;

  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && !out.includes(s)) out.push(s);
  };

  if (hasHoldings) {
    if (tier === "deep") {
      // Whole-portfolio scans for models that can chain many tools
      // (Sonnet/Opus/V4 Pro). Lead with the questions the platform now answers
      // exceptionally well: benchmark excess, the payout calendar, two-basis
      // income, the rate cycle, earnings quality, and honest stress tests.
      add(`What's the single most important thing in my portfolio I haven't asked about?`);
      add(`Which of my holdings beat the KSE-100 over my holding period, and which just rode the market?`);
      add(`When are my next expected dividends, and how much should I actually receive from each?`);
      add(`How much dividend income did I actually receive over the last 12 months, and who paid it?`);
      add(t1 ? `If ${t1} cut its dividend in half tomorrow, what would happen to my income and my capital?` : null);
      add(`How exposed is my book to the SBP rate cycle after the latest policy move?`);
      add(t2 ? `Compare the earnings quality of ${t1} and ${t2}, not just the earnings.` : null);
      add(t1 ? `Steelman the case against ${t1} using only my own data.` : null);
      add(`If I had to raise ${amount} from this portfolio with the least damage, what would you sell and why?`);
      add(`Rank my holdings from strongest to weakest for adding ${amount} today, and explain each.`);
      add(`Across my whole portfolio, where would ${amount} of new capital most improve diversification and risk?`);
      add(`Which of my holdings look most attractively valued right now, and why?`);
      add(`Which of my holdings no longer earn their place, and should I trim any?`);
      add(sector1 ? `Am I over-concentrated in ${sector1}? Compare it to the rest of my book.` : `Show my sector weights and where I'm over- or under-exposed.`);
      // Cross-holding pattern questions — the platform's edge.
      add(`Which of my holdings share a sector or risk driver, and where am I doubling up?`);
      add(`What single event or risk would hit the most of my holdings at once?`);
      if (hasThesis) add(`Which of my holdings have drifted from the thesis I wrote for them?`);
      if (hasLedger) {
        add(`Find any discrepancies between my holdings, transaction ledger, and broker records.`);
        add(`Which holdings drove my realized and unrealized gains the most, after dividends and fees?`);
        add(`Across my ledger, where did recent tranches buy in with the least margin of safety?`);
      }
      for (const s of sectors.slice(1, 4)) add(`Is the ${s} sector pulling its weight in my portfolio, or should I rotate out?`);
      for (const t of tickers.slice(0, 6)) {
        add(`Should I add ${amount} to ${t}, hold, or trim, given my weight and cost basis?`);
        if (hasLedger) add(`Analyse my ${t} tranches: did recent buys erode my margin of safety?`);
      }
    } else if (tier === "medium") {
      add(`Which of my holdings look most attractively valued today?`);
      add(`When is my next expected dividend, and from which holding?`);
      add(`How much dividend income did I actually receive over the last 12 months?`);
      add(`Which of my holdings beat the KSE-100 over my holding period?`);
      add(`Which of my holdings overlap in sector or risk?`);
      if (hasThesis) add(`Which of my holdings still match the thesis I wrote, and which have drifted?`);
      add(t2 ? `Compare ${t1} and ${t2} for a long-term hold, and which deserves ${amount} more.` : null);
      for (const s of sectors.slice(0, 3)) add(`Is the ${s} sector still a good place for my long-term capital?`);
      for (const t of tickers.slice(0, 6)) {
        add(`Review ${t}: valuation, dividends, and whether to add ${amount} for the long term.`);
        add(`What's the latest news affecting ${t}?`);
      }
    } else {
      // Focused: single-stock, answerable from the pre-built brief.
      add(`When is my next expected dividend, and from which holding?`);
      for (const t of tickers.slice(0, 6)) {
        add(`Should I add ${amount} to ${t} for the long term? Weigh the company case against my concentration and cost basis.`);
        add(`Is ${t} attractively valued right now for a long-term investor?`);
        add(`How has my ${t} position performed after dividends and fees?`);
        add(`What's the latest news affecting ${t}?`);
        if (hasThesis) add(`Does my ${t} position still match the thesis I wrote for it?`);
        if (hasLedger) add(`Review my ${t} cost basis: did recent buys have less margin of safety?`);
      }
    }
  } else {
    // No holdings yet — general PSX prompts over well-known large caps.
    const names = ["MEBL", "OGDC", "LUCK", "ENGRO", "FFC", "UBL", "PPL", "HBL"];
    const secs = ["cement", "bank", "fertilizer", "oil and gas", "power"];
    if (tier === "deep") {
      add(`What are the most attractively valued large-cap PSX stocks for a long-term investor today?`);
      add(`Build me a starter long-term watchlist across four PSX sectors.`);
      add(`Compare the cement and bank sectors for long-term accumulation.`);
      for (const s of secs) add(`Is the ${s} sector attractive for long-term accumulation right now?`);
    } else if (tier === "medium") {
      add(`Which PSX sectors look most attractive for a long-term investor right now?`);
      add(`Compare ENGRO and LUCK for a long-term hold.`);
      for (const n of names.slice(0, 5)) add(`Is ${n} attractively valued for a long-term investor today?`);
    } else {
      for (const n of names.slice(0, 6)) add(`Is ${n} a good long-term hold at current prices?`);
      for (const n of names.slice(0, 4)) add(`What's the latest news on ${n}?`);
    }
  }

  // Always-available breadth (market, movement, flows, filings).
  if (hasHoldings) add(`Why did my portfolio move today, and what contributed most?`);
  add(`What moved the PSX market today and which sectors led?`);
  add(`Which PSX sectors are leading and lagging right now?`);
  add(`What are foreign investors net buying and selling on the PSX lately?`);
  add(hasHoldings ? `Summarise today's official filings affecting my holdings.` : `Summarise today's notable PSX filings and announcements.`);

  return out;
}
