import type { PromptMode } from "@/lib/chat/system-prompt";

/**
 * Chat grounding eval cases. Each case pairs a representative question with the
 * data points the assembled <context> brief MUST contain for the model to answer
 * it well. This guards the retrieval/injection layer: the grounding a question
 * receives is what actually holds answer quality as prompts and models change, so
 * it is tested against the real assembly (lib/chat/build-context), not the model.
 *
 * `must` are critical (a missing one fails the case); `should` are expected but
 * data-dependent (reported, not fatal; e.g. benchmark needs cached KSE-100
 * history); `mustNot` may never appear. All are matched case-insensitively as
 * regular expressions against the brief text.
 */

export interface EvalCase {
  id: string;
  description: string;
  /** Question template; {TOP} {SECOND} {SECTOR} {AMOUNT} are substituted (in patterns too). */
  question: string;
  /** Answer posture the case is written for; defaults to explain, the product default. */
  mode?: PromptMode;
  /** Data-point checks against the assembled brief (context grounding). */
  must: string[];
  should?: string[];
  mustNot?: string[];
  /** Checks against the model's live answer (used by the live eval only). */
  answerMust?: string[];
  /** Patterns the live answer may never contain (verdict openers, trading constructs). */
  answerMustNot?: string[];
}

export interface EvalTemplateVars {
  TOP: string;
  SECOND: string;
  SECTOR: string;
  AMOUNT: string;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "decision-add",
    description: "Single-ticker add decision pulls tranches, scenarios, patterns, macro",
    question: "Should I add {AMOUNT} to {TOP} for the long term? Weigh the company case against my concentration and cost basis.",
    must: ["decision evidence", "Addition scenarios", "Portfolio patterns", "PSX macro backdrop"],
    should: ["Performance vs KSE-100", "your thesis|your recent journal", "Dividend income"],
    answerMust: ["\\b{TOP}\\b", "%"],
  },
  {
    id: "cross-holding",
    description: "Whole-portfolio concentration question loads patterns + macro over the book",
    question: "Which of my holdings share a sector or risk driver, and where am I doubling up?",
    must: ["Portfolio patterns", "Your portfolio", "PSX macro backdrop"],
    should: ["Shared .* exposure|No two holdings", "Performance vs KSE-100"],
    answerMust: ["%"],
  },
  {
    id: "dividend-income",
    description: "No-ticker dividend question injects portfolio dividend income",
    question: "Which of my holdings carry my dividend income, and is any payout at risk?",
    must: ["Dividend income", "yield on cost"],
    should: ["Share of income", "Portfolio patterns", "PSX macro backdrop"],
    answerMust: ["%"],
  },
  {
    id: "benchmark",
    description: "Portfolio performance question injects KSE-100 excess returns",
    question: "How are my holdings doing relative to the KSE-100 this year?",
    must: ["Performance vs KSE-100", "Excess", "PSX macro backdrop"],
    should: ["Portfolio \\(current weights\\)"],
    answerMust: ["KSE|%"],
  },
  {
    id: "macro-sectors",
    description: "Rate-cycle question injects macro backdrop with per-sector sensitivity",
    question: "With interest rates where they are, how exposed is my book to the rate cycle?",
    must: ["PSX macro backdrop", "Policy rate", "How this backdrop hits your sectors"],
    should: ["net interest margins|rate-sensitive|USD-linked"],
    answerMust: ["%"],
  },
  {
    id: "market",
    description: "Market question still returns the market + sector snapshot (no regression)",
    question: "What moved the PSX market today and which sectors led?",
    must: ["MARKET", "SECTORS"],
  },

  // Beginner cases: the explain-first posture. The brief must carry the user's
  // own figure for a term, the session date for a "today" question, and period
  // labels for results; the answer must define, cite and label without a verdict.
  {
    id: "term-pe",
    description: "A term question loads the holding's ratio card so the definition can use the user's own P/E",
    question: "What does P/E mean, and what is {TOP}'s?",
    must: ["{TOP} RATIOS", "P/E \\d"],
    should: ["{TOP} YOUR POSITION"],
    answerMust: ["price", "earnings", "P/E"],
    // No verdict: neither a buy/sell opener nor a "you should buy/sell" line.
    answerMustNot: ["^\\s*[#*_]*\\s*(buy|sell|hold)\\b", "\\b(you should|i would|i'd) (buy|sell|add|trim)\\b"],
  },
  {
    id: "portfolio-down-today",
    description: "A 'today' question carries the last completed session date and the positions by weight",
    question: "Why is my portfolio down today?",
    must: ["Last completed PSX session: \\w+ 20\\d\\d-\\d\\d-\\d\\d", "Positions by weight"],
    should: ["MARKET", "SECTORS"],
    // The answer must anchor to a session date and cite at least one holding figure.
    answerMust: ["20\\d\\d-\\d\\d-\\d\\d|\\b\\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\b|(Mon|Tues|Wednes|Thurs|Fri)day", "\\b{TOP}\\b.*(%|PKR)"],
  },
  {
    id: "results-simply",
    description: "A results question loads the holding's period-labelled ratios and no trading constructs",
    question: "Explain {TOP}'s latest results simply",
    must: ["{TOP} RATIOS", "\\[(20\\d\\d FY|20\\d\\d Q[1-4]|TTM|Last 12 months)"],
    mustNot: ["stop.?loss", "target price"],
    answerMust: ["FY ?20\\d\\d|20\\d\\d FY|Q[1-4] ?20\\d\\d|20\\d\\d ?Q[1-4]|TTM|trailing twelve|9M|1H|H1|last 12 months"],
    answerMustNot: ["stop.?loss", "target price"],
  },
  {
    id: "decision-explain",
    description: "A decision question in explain mode gets what-to-weigh conditions, never a verdict opener",
    question: "Should I buy more {TOP}?",
    mode: "explain",
    must: ["decision", "Addition scenarios"],
    should: ["Portfolio patterns", "PSX macro backdrop"],
    answerMust: ["defensible if"],
    answerMustNot: ["^\\s*[#*_]*\\s*(Buy|Sell|Hold|Add|Trim)\\b"],
  },
];

/** Fill a case's template with the portfolio-derived variables. */
export function renderQuestion(template: string, vars: EvalTemplateVars): string {
  return template
    .replaceAll("{TOP}", vars.TOP)
    .replaceAll("{SECOND}", vars.SECOND)
    .replaceAll("{SECTOR}", vars.SECTOR)
    .replaceAll("{AMOUNT}", vars.AMOUNT);
}
