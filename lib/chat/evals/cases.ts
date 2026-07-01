/**
 * Chat grounding eval cases. Each case pairs a representative question with the
 * data points the assembled <context> brief MUST contain for the model to answer
 * it well. This guards the retrieval/injection layer — the grounding a question
 * receives is what actually holds answer quality as prompts and models change, so
 * it is tested against the real assembly (lib/chat/build-context), not the model.
 *
 * `must` are critical (a missing one fails the case); `should` are expected but
 * data-dependent (reported, not fatal — e.g. benchmark needs cached KSE-100
 * history); `mustNot` may never appear. All are matched case-insensitively as
 * regular expressions against the brief text.
 */

export interface EvalCase {
  id: string;
  description: string;
  /** Question template; {TOP} {SECOND} {SECTOR} {AMOUNT} are substituted. */
  question: string;
  /** Data-point checks against the assembled brief (context grounding). */
  must: string[];
  should?: string[];
  mustNot?: string[];
  /** Checks against the model's live answer (used by the live eval only). */
  answerMust?: string[];
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
];

/** Fill a case's template with the portfolio-derived variables. */
export function renderQuestion(template: string, vars: EvalTemplateVars): string {
  return template
    .replaceAll("{TOP}", vars.TOP)
    .replaceAll("{SECOND}", vars.SECOND)
    .replaceAll("{SECTOR}", vars.SECTOR)
    .replaceAll("{AMOUNT}", vars.AMOUNT);
}
