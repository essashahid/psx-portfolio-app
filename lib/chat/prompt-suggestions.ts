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
  /** Top holdings by weight, largest first. */
  top: { ticker: string; sector: string | null; weightPct: number | null }[];
  /** Heaviest sector by value, for concentration prompts. */
  topSector: string | null;
}

type Tier = "focused" | "medium" | "deep";

function tierFor(model: ChatModelId): Tier {
  switch (model) {
    case "claude-opus":
    case "claude-sonnet":
      return "deep";
    case "deepseek-chat":
      return "medium";
    case "claude-haiku":
    case "deepseek-reasoner":
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
  const t1 = ctx?.top[0]?.ticker ?? null;
  const t2 = ctx?.top[1]?.ticker ?? null;
  const sector = ctx?.top[0]?.sector ?? ctx?.topSector ?? null;
  const amount = amountFor(ctx?.cashBalance ?? null);
  const hasHoldings = (ctx?.holdingsCount ?? 0) > 0 && !!t1;
  const hasLedger = !!ctx?.hasLedger;

  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && !out.includes(s)) out.push(s);
  };

  if (hasHoldings) {
    if (tier === "deep") {
      add(`Rank my holdings from strongest to weakest for adding ${amount} today, and explain each.`);
      add(`Across my whole portfolio, where would ${amount} of new capital most improve diversification and risk?`);
      if (hasLedger) {
        add(`Find any discrepancies between my holdings, transaction ledger, and broker records.`);
        add(`Analyse my ${t1} transaction history and tell me whether recent tranches eroded my margin of safety.`);
        add(`Which holdings drove my realized and unrealized gains the most, after dividends and fees?`);
      } else {
        add(`Review ${t1}: fundamentals, valuation, and whether to add ${amount} for the long term.`);
        add(`Which of my holdings look most attractively valued right now?`);
      }
      add(sector ? `Am I over-concentrated in ${sector}? Show my sector weights and what I'm missing.` : `Show my sector weights and where I'm over- or under-exposed.`);
      add(t2 ? `Compare ${t1} and ${t2} for a long-term hold and which deserves new capital first.` : null);
    } else if (tier === "medium") {
      add(t2 ? `Compare ${t1} and ${t2} for a long-term hold and which deserves ${amount} more.` : `Review ${t1}: valuation, dividends, and whether to add ${amount} for the long term.`);
      add(`Which of my holdings look most attractively valued today?`);
      add(`Review ${t1}: valuation, dividends, and whether to add for the long term.`);
      add(t2 ? `What's the latest news affecting ${t1} and ${t2}?` : `What's the latest news affecting ${t1}?`);
      add(sector ? `Is the ${sector} sector still a good place for my long-term capital?` : null);
    } else {
      add(`Should I add ${amount} to ${t1} for the long term? Weigh the company case against my concentration and cost basis.`);
      add(`Is ${t1} attractively valued right now for a long-term investor?`);
      add(`How has my ${t1} position performed after dividends and fees?`);
      add(`What's the latest news affecting ${t1}?`);
      add(hasLedger ? `Review my ${t1} cost basis and whether recent buys had less margin of safety.` : null);
      add(t2 ? `Should I add to ${t2} or wait? Use its valuation and my current weight.` : null);
    }
  } else {
    // No holdings yet — general PSX prompts.
    if (tier === "deep") {
      add(`What are the most attractively valued large-cap PSX stocks for a long-term investor today?`);
      add(`Compare the cement and bank sectors for long-term accumulation.`);
      add(`Build me a starter long-term watchlist across four PSX sectors.`);
    } else if (tier === "medium") {
      add(`Compare ENGRO and LUCK for a long-term hold.`);
      add(`Which PSX sectors look most attractive for a long-term investor right now?`);
      add(`Is MEBL attractively valued for a long-term investor today?`);
    } else {
      add(`Is MEBL attractively valued for a long-term investor today?`);
      add(`What's the latest news on OGDC?`);
      add(`Is LUCK a good long-term hold at current prices?`);
    }
  }

  // Fillers — guarantee at least four and add breadth.
  add(`What moved the PSX market today and which sectors led?`);
  add(hasHoldings ? `Summarise today's official filings affecting my holdings.` : `Summarise today's notable PSX filings and announcements.`);
  add(`Which PSX sectors are leading and lagging right now?`);

  return out;
}
