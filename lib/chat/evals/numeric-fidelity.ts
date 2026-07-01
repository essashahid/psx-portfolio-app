/**
 * Numeric-fidelity guard: checks that the figures a model states in its answer
 * are actually present in the <context> brief it was given. The Copilot's whole
 * premise is that the model narrates pre-computed numbers and never invents its
 * own, so a number in the answer that does not trace back to the brief is the
 * exact failure mode to catch. Pure and deterministic — usable offline in the
 * eval and, later, as a runtime backstop.
 *
 * It is deliberately tolerant to avoid false positives: representations are
 * normalised (so "31,000", "31.0K" and "PKR 31k" all compare equal), rounding is
 * allowed ("14%" matches a brief "14.2%"), and low-risk tokens (small counts,
 * ordinals, years) are not checked. It flags the numbers most likely to be
 * fabricated: percentages, ratios/prices, and monetary amounts.
 */

export type NumberKind = "percent" | "money" | "ratio" | "plain";

export interface NumberToken {
  raw: string;
  value: number;
  kind: NumberKind;
  index: number;
}

export interface UnmatchedNumber {
  raw: string;
  value: number;
  kind: NumberKind;
  context: string;
}

export interface FidelityResult {
  checked: number;
  matched: number;
  groundedPct: number | null;
  unmatched: UnmatchedNumber[];
}

const SUFFIX_MULT: Record<string, number> = {
  k: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};

// A number, with an optional currency prefix and an optional %/scale suffix. A
// letter suffix must be followed by a non-letter, so "6 months" is not read as
// "6 million" and "3 banks" is not read as "3 billion".
const NUMBER_RE = /(?:(pkr|rs\.?)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(%|(?:k|mn|m|bn|b|million|billion)(?![a-z]))?/gi;

/** Strip fenced ```artifact blocks so embedded chart JSON is not scored as prose. */
export function stripArtifacts(text: string): string {
  return text.replace(/```artifact[\s\S]*?```/gi, " ");
}

export function extractNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const [raw, currency, digits, suffixRaw] = m;
    if (!digits) continue;
    const base = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const suffix = suffixRaw?.toLowerCase();
    let kind: NumberKind;
    let value: number;
    if (suffix === "%") {
      kind = "percent";
      value = base;
    } else if (suffix && SUFFIX_MULT[suffix]) {
      kind = "money";
      value = base * SUFFIX_MULT[suffix];
    } else if (currency) {
      kind = "money";
      value = base;
    } else if (digits.includes(".")) {
      kind = "ratio";
      value = base;
    } else {
      kind = "plain";
      value = base;
    }
    tokens.push({ raw: raw.trim(), value, kind, index: m.index ?? 0 });
  }
  return tokens;
}

/** A plain integer that is a year, a small count, or an ordinal is low-risk. */
function isLowRisk(t: NumberToken): boolean {
  if (t.kind !== "plain") return false;
  if (t.value >= 1990 && t.value <= 2100) return true; // year
  if (Number.isInteger(t.value) && t.value < 100) return true; // count / ordinal
  return false;
}

/** True when `value` matches any brief value exactly, by rounding, or within 2%. */
function matchesBrief(value: number, briefValues: number[], decimals: number): boolean {
  for (const b of briefValues) {
    if (Math.abs(b - value) < 1e-6) return true;
    // Rounding: "14%" should match a brief "14.2%".
    if (Number.isFinite(b) && Math.round(b * 10 ** decimals) / 10 ** decimals === value) return true;
    const denom = Math.max(Math.abs(b), Math.abs(value), 1);
    if (Math.abs(b - value) / denom <= 0.02) return true;
  }
  return false;
}

function decimalsOf(raw: string): number {
  const dot = raw.replace(/,/g, "").match(/\.(\d+)/);
  return dot ? dot[1].length : 0;
}

/**
 * Score an answer's numbers against the brief. `answer` should be the visible
 * prose (artifacts stripped). Only high-risk numbers are checked; the result
 * lists any that do not trace back to the brief.
 */
export function checkNumericFidelity(answer: string, brief: string): FidelityResult {
  const briefValues = extractNumbers(brief).map((t) => t.value);
  const prose = stripArtifacts(answer);
  const answerNumbers = extractNumbers(prose);

  const unmatched: UnmatchedNumber[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let matched = 0;

  for (const t of answerNumbers) {
    if (isLowRisk(t)) continue;
    checked++;
    if (matchesBrief(t.value, briefValues, decimalsOf(t.raw))) {
      matched++;
      continue;
    }
    const key = `${t.kind}:${t.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unmatched.push({
      raw: t.raw,
      value: t.value,
      kind: t.kind,
      context: prose.slice(Math.max(0, t.index - 30), t.index + t.raw.length + 20).replace(/\s+/g, " ").trim(),
    });
  }

  return {
    checked,
    matched,
    groundedPct: checked > 0 ? (matched / checked) * 100 : null,
    unmatched,
  };
}
