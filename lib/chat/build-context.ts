import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMessage, type ResolvedMessage } from "@/lib/chat/resolver";
import {
  gatherCards, briefFromCards, briefFromPositionHistory, briefFromHoldingsSummary,
  briefFromThesisJournal, briefFromPortfolioPatterns, type Card,
} from "@/lib/chat/context";
import { getLatestSessionDate, getPositionHistoryCard, getHoldingsSummary, getDecisionNotes, type HoldingsSummary } from "@/lib/chat/data";
import { getMacroSnapshot, briefFromMacro } from "@/lib/chat/macro";
import { getBenchmarkPerformance, briefFromBenchmark } from "@/lib/chat/benchmark";
import { getDividendIncome, briefFromDividendIncome } from "@/lib/chat/income";

/**
 * Assembles the pre-computed `<context>` brief handed to the model. Extracted
 * from the chat route so the exact same pipeline is exercised by the eval
 * harness — the grounding a question receives is what actually holds quality as
 * prompts and models change, so it must be tested against the real assembly, not
 * a drifting copy.
 *
 * The route keeps the streaming card-send inline (so cards render before the
 * heavier briefs finish); it calls `buildBrief` with the cards it already
 * gathered. The harness calls `assembleChatContext`, which does both steps.
 */

/** Whole-message PKR amount, e.g. "add 100k to FFC" -> 100000. */
export function extractProposedPkrAmount(message: string): number | null {
  const text = message.toLowerCase().replace(/,/g, "");
  const suffixMultiplier = (suffix: string | undefined) => {
    if (!suffix) return 1;
    if (suffix === "k") return 1_000;
    if (suffix === "m" || suffix === "mn" || suffix === "million") return 1_000_000;
    if (suffix === "lac" || suffix === "lakh") return 100_000;
    if (suffix === "crore") return 10_000_000;
    return 1;
  };
  const patterns = [
    /(?:pkr|rs\.?|rupees?)\s*(\d+(?:\.\d+)?)\s*(k|m|mn|million|lac|lakh|crore)?\b/,
    /\b(\d+(?:\.\d+)?)\s*(k|m|mn|million|lac|lakh|crore)?\s*(?:pkr|rs\.?|rupees?)\b/,
    /\b(\d+(?:\.\d+)?)\s*(k|m|mn|million|lac|lakh|crore)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const amount = Number(match[1]) * suffixMultiplier(match[2]);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

/** Today's date in Pakistan time as YYYY-MM-DD, for macro/benchmark lookups. */
export function pktTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const PKT_WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", weekday: "long" });

/** Next PSX weekday session strictly after the given ISO date (Mon–Fri). */
function nextWeekday(fromIso: string): string {
  let t = Date.parse(`${fromIso}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    t += 86_400_000;
    const day = new Date(t).toISOString().slice(0, 10);
    const wd = PKT_WEEKDAY.format(new Date(`${day}T12:00:00Z`));
    if (wd !== "Saturday" && wd !== "Sunday") return day;
  }
  return fromIso;
}

function withWeekday(iso: string): string {
  return `${PKT_WEEKDAY.format(new Date(`${iso}T12:00:00Z`))} ${iso}`;
}

/**
 * Deterministic PSX calendar line so day-of-week and settlement reasoning never
 * comes from the model (a V4 Pro test run produced "Friday 4 July is a
 * Saturday" in a liquidation plan). Weekend-aware; public holidays can shift
 * the next session, and the line says so.
 */
export function tradingCalendarLine(latestSession: string | null): string {
  const today = pktTodayIso();
  const next = nextWeekday(today);
  const settle = nextWeekday(nextWeekday(next));
  const parts = [
    `Today is ${withWeekday(today)} (Pakistan time).`,
    latestSession ? `Last completed PSX session: ${withWeekday(latestSession)}.` : null,
    `Next PSX session: ${withWeekday(next)} (weekends excluded; a public holiday can shift this).`,
    `PSX trades settle T+2, so a sale executed ${withWeekday(next)} pays out around ${withWeekday(settle)}.`,
  ].filter(Boolean);
  return `PSX calendar (pre-computed; use these dates and weekdays as given): ${parts.join(" ")}`;
}

export interface BriefInputs {
  message: string;
  resolved: ResolvedMessage;
  cards: Card[];
  latestSession: string | null;
}

/**
 * Build the full pre-computed brief from already-gathered cards. Injects, for a
 * decision, the position tranches + the user's thesis/journal; and for any
 * portfolio-, sector-, or decision-aware question, cross-holding patterns,
 * KSE-100 benchmark returns, dividend income, and the PSX macro backdrop. Each
 * heavier block fails safe (contributes nothing) when its data is unavailable.
 */
export async function buildBrief(
  supabase: SupabaseClient,
  userId: string,
  { message, resolved, cards, latestSession }: BriefInputs
): Promise<string> {
  const proposedAmount = extractProposedPkrAmount(message);
  const isDecision = resolved.intent === "position" && resolved.tickers.length > 0;
  const positionHistoryBriefs = isDecision
    ? await Promise.all(
        resolved.tickers.slice(0, 2).map(async (ticker) => {
          const history = await getPositionHistoryCard(supabase, userId, ticker, proposedAmount);
          return briefFromPositionHistory(history);
        })
      )
    : [];

  let decisionContext = "";
  let patternsBrief = "";
  let benchmarkBrief = "";
  let incomeBrief = "";
  let macroBrief = "";
  {
    const holdingsCard = cards.find((c) => c.kind === "holdings");
    let holdingsData: HoldingsSummary | null =
      holdingsCard && holdingsCard.kind === "holdings" ? holdingsCard.data : null;
    if (isDecision) {
      const [hs, notes] = await Promise.all([
        holdingsData ? Promise.resolve(holdingsData) : getHoldingsSummary(supabase, userId),
        getDecisionNotes(supabase, userId, resolved.tickers[0]),
      ]);
      holdingsData = hs;
      decisionContext = [
        holdingsCard ? "" : hs ? briefFromHoldingsSummary(hs) : "",
        briefFromThesisJournal(notes, resolved.tickers[0]),
      ].filter(Boolean).join("\n\n");
    }
    // A dividend question about a named ticker ("if UBL cut its dividend, what
    // happens to my income?") is still a whole-book income question, so load
    // holdings for it too — without this the canonical two-basis income block
    // never reached the model and it re-aggregated raw rows itself.
    if (!holdingsData && resolved.intent === "dividend") {
      holdingsData = await getHoldingsSummary(supabase, userId);
    }
    if (holdingsData) patternsBrief = briefFromPortfolioPatterns(holdingsData);

    const portfolioAware = isDecision || !!holdingsData || !!resolved.sector;
    if (portfolioAware) {
      const todayIso = pktTodayIso();
      const macroSectors =
        holdingsData?.sectors.map((s) => ({ sector: s.sector, weightPct: s.weightPct })) ??
        (resolved.sector ? [{ sector: resolved.sector, weightPct: null }] : []);
      const [macro, benchmark, income] = await Promise.all([
        getMacroSnapshot(supabase, todayIso),
        getBenchmarkPerformance(supabase, {
          focusTickers: resolved.tickers.slice(0, 4),
          holdings: holdingsData,
        }),
        holdingsData ? getDividendIncome(supabase, userId, holdingsData) : Promise.resolve(null),
      ]);
      macroBrief = briefFromMacro(macro, macroSectors);
      benchmarkBrief = benchmark ? briefFromBenchmark(benchmark) : "";
      incomeBrief = income ? briefFromDividendIncome(income) : "";
    }
  }

  return [
    tradingCalendarLine(latestSession),
    briefFromCards(cards, latestSession),
    ...positionHistoryBriefs,
    decisionContext,
    patternsBrief,
    benchmarkBrief,
    incomeBrief,
    macroBrief,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface AssembledContext {
  resolved: ResolvedMessage;
  cards: Card[];
  latestSession: string | null;
  brief: string;
}

/** Resolve, gather cards, and build the brief — the whole free layer in one call. */
export async function assembleChatContext(
  supabase: SupabaseClient,
  userId: string,
  message: string
): Promise<AssembledContext> {
  const resolved = await resolveMessage(supabase, message);
  const [cards, latestSession] = await Promise.all([
    gatherCards(supabase, userId, resolved),
    getLatestSessionDate(supabase),
  ]);
  const brief = await buildBrief(supabase, userId, { message, resolved, cards, latestSession });
  return { resolved, cards, latestSession, brief };
}
