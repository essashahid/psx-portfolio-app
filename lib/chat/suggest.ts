import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHoldingsSummary, type HoldingsSummary } from "@/lib/chat/data";
import { getDividendIncome, type DividendIncome } from "@/lib/chat/income";
import { getBenchmarkPerformance, type BenchmarkPerformance } from "@/lib/chat/benchmark";
import { policyRateContext } from "@/lib/market-data/macro-assets";
import { pktTodayIso } from "@/lib/chat/build-context";
import { stripEmDashes, tidyTypography } from "@/lib/chat/sanitize";
import { deepseekKey } from "@/lib/ai/deepseek-chat";

/**
 * Personalized empty-state suggestions for the Research Copilot.
 *
 * A cheap model (DeepSeek V4 Flash) turns a compact profile of the user's book
 * — holdings, income calendar, benchmark laggards, recent ledger activity, and
 * the questions they have already asked — into a pool of suggested questions.
 * The pool is cached in chat_suggestions and served instantly; regeneration
 * happens in the background when the profile hash changes or the cache ages
 * out. The deterministic template pool (prompt-suggestions.ts) remains the
 * fallback for new users and generation failures.
 *
 * Every generated string passes a deterministic validation gate before it is
 * cached: only tickers the user holds, no trading constructs, house typography.
 * The model is free at generation time; the gate owns correctness.
 */

export const SUGGEST_MODEL = "deepseek-v4-flash";
const STALE_MS = 24 * 60 * 60 * 1000;
const POOL_TARGET = 14;
const GENERATED_CAP = 11; // rest of the pool comes from deterministic event slots

export interface SuggestionCache {
  suggestions: string[];
  profileHash: string | null;
  generatedAt: string;
}

interface Profile {
  holdings: HoldingsSummary;
  income: DividendIncome | null;
  benchmark: BenchmarkPerformance | null;
  recentQuestions: string[];
  recentTrades: { ticker: string; type: string; date: string }[];
  hasThesis: boolean;
  hash: string;
}

// ── Profile assembly ─────────────────────────────────────────────────────────

/**
 * The cheap half of the profile: enough to compute the change-detection hash
 * with a handful of fast queries, so a cache hit never pays for the heavy
 * income and benchmark assembly. The hash covers what should trigger
 * regeneration — the shape of the book, question history, ledger activity —
 * and deliberately excludes daily price wobble; calendar drift is covered by
 * the 24-hour age-out.
 */
async function cheapProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<Omit<Profile, "income" | "benchmark"> | null> {
  const holdings = await getHoldingsSummary(supabase, userId);
  if (!holdings || holdings.holdings.length === 0) return null;

  const [threadsRes, txRes, thesisRes] = await Promise.all([
    supabase
      .from("chat_threads")
      .select("title")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false })
      .limit(20),
    supabase
      .from("transactions")
      .select("ticker, type, trade_date")
      .eq("user_id", userId)
      .order("trade_date", { ascending: false })
      .limit(10),
    supabase.from("theses").select("ticker", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  const recentQuestions = (threadsRes.data ?? []).map((t) => String(t.title ?? "")).filter(Boolean);
  const recentTrades = (txRes.data ?? []).map((t) => ({
    ticker: String(t.ticker ?? "").toUpperCase(),
    type: String(t.type ?? ""),
    date: String(t.trade_date ?? ""),
  }));

  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        h: holdings.holdings.map((h) => [h.ticker, h.quantity]),
        q: recentQuestions,
        t: recentTrades,
      })
    )
    .digest("hex")
    .slice(0, 32);

  return { holdings, recentQuestions, recentTrades, hasThesis: (thesisRes.count ?? 0) > 0, hash };
}

/** The heavy half — income calendar and benchmark excess — fetched only when regeneration is actually happening. */
async function enrichProfile(
  supabase: SupabaseClient,
  userId: string,
  base: Omit<Profile, "income" | "benchmark">
): Promise<Profile> {
  const [income, benchmark] = await Promise.all([
    getDividendIncome(supabase, userId, base.holdings).catch(() => null),
    getBenchmarkPerformance(supabase, { focusTickers: [], holdings: base.holdings }).catch(() => null),
  ]);
  return { ...base, income, benchmark };
}

/** Compact plain-text profile for the generation prompt. */
function profileText(p: Profile): string {
  const lines: string[] = [];
  const h = p.holdings;
  lines.push(
    `Holdings (${h.count}): ${h.holdings
      .map((x) => `${x.ticker} ${x.weightPct != null ? `${x.weightPct.toFixed(1)}%` : "?"}${x.sector ? ` (${x.sector})` : ""}`)
      .join(", ")}`
  );
  const topSectors = h.sectors.slice(0, 4).map((s) => `${s.sector} ${s.weightPct.toFixed(0)}%`).join(", ");
  if (topSectors) lines.push(`Sector weights: ${topSectors}`);

  if (p.income?.received) {
    const r = p.income.received;
    lines.push(
      `Dividends RECEIVED trailing 12m: PKR ${r.totalGross.toLocaleString()} gross; top payers ${r.rows
        .slice(0, 3)
        .map((x) => `${x.ticker} ${x.sharePct.toFixed(0)}%`)
        .join(", ")}`
    );
  }
  for (const u of (p.income?.upcoming ?? []).slice(0, 4)) {
    lines.push(`Upcoming payout: ${u.ticker} ${u.status} ${u.dpsText}${u.expectedDate ? ` around ${u.expectedDate}` : ""}`);
  }

  const win = p.benchmark?.windows.find((w) => w.rows.some((r) => r.excessPct != null));
  if (win) {
    const ranked = win.rows.filter((r) => r.excessPct != null).sort((a, b) => a.excessPct! - b.excessPct!);
    const laggards = ranked.slice(0, 3).map((r) => `${r.ticker} ${r.excessPct!.toFixed(0)}pts`);
    const leaders = ranked.slice(-2).map((r) => `${r.ticker} +${r.excessPct!.toFixed(0)}pts`);
    lines.push(`Vs KSE-100 (${win.label}): laggards ${laggards.join(", ")}; leaders ${leaders.join(", ")}`);
  }

  const rate = policyRateContext(pktTodayIso());
  const move =
    rate.previousPct != null && rate.previousPct !== rate.currentPct
      ? `; last move ${rate.currentPct > rate.previousPct ? "a hike" : "a cut"} of ${Math.round(Math.abs(rate.currentPct - rate.previousPct) * 100)}bps effective ${rate.since}`
      : "";
  lines.push(`SBP policy rate: ${rate.currentPct.toFixed(1)}%${move}`);

  if (p.recentTrades.length) {
    lines.push(`Recent ledger activity: ${p.recentTrades.slice(0, 6).map((t) => `${t.type} ${t.ticker} ${t.date}`).join("; ")}`);
  }
  if (p.recentQuestions.length) {
    lines.push(`Questions already asked (do NOT repeat these topics verbatim): ${p.recentQuestions.slice(0, 15).join(" | ")}`);
  }
  if (!p.hasThesis) {
    lines.push(`The user has not adopted the thesis-writing workflow; never suggest writing or reviewing a thesis.`);
  }
  return lines.join("\n");
}

// ── Validation gate ──────────────────────────────────────────────────────────

// Acronyms that legitimately appear in questions without being tickers.
const ACRONYM_ALLOWLIST = new Set([
  "PSX", "KSE", "SBP", "PKR", "USD", "CPI", "GDP", "IMF", "SECP", "NCCPL", "MPC", "IPO", "AGM",
  "EPS", "DPS", "ROE", "ROIC", "ROA", "FCF", "OCF", "PAT", "TTM", "RSI", "NIM", "REIT", "ETF",
  "KSE100", "PE", "PB", "AND", "THE", "FOR", "NOT", "VS",
]);

const TRADING_CONSTRUCTS =
  /stop.?loss|price target|target price|entry (point|price)|exit (point|price|window)|break.?out|swing trade|intraday|day.?trad|buy tomorrow|sell tomorrow|tomorrow'?s (best|top)|short.?sell|scalp|momentum trade|support level|resistance level|technical breakout|chase the/i;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Deterministic gate for one generated suggestion. Returns the cleaned string
 * or null when it must be rejected. Exported for tests.
 */
export function validateSuggestion(
  raw: string,
  heldTickers: Set<string>,
  taken: string[]
): string | null {
  let s = tidyTypography(stripEmDashes(raw.replace(/\s+/g, " ").trim())).trim();
  s = s.replace(/^["'‘’“”\d.\-)\s]+/, "").replace(/["'‘’“”]+$/, "").trim(); // list numbering / stray quotes
  if (s.length < 20 || s.length > 160) return null;
  if (/\n/.test(s) || /[<>{}\\]/.test(s)) return null;
  if (TRADING_CONSTRUCTS.test(s)) return null;

  // Every ticker-looking token must be a holding or a known market acronym —
  // a suggestion about a stock the user does not own reads as generic spam.
  for (const token of s.match(/\b[A-Z][A-Z0-9]{2,7}\b/g) ?? []) {
    if (!heldTickers.has(token) && !ACRONYM_ALLOWLIST.has(token)) return null;
  }

  // Dedupe against already-accepted suggestions and recent questions.
  const n = normalize(s);
  for (const prior of taken) {
    const np = normalize(prior);
    if (n === np || (n.length > 30 && np.length > 30 && n.slice(0, 40) === np.slice(0, 40))) return null;
  }
  return s;
}

// ── Deterministic event slots (always correct, zero cost) ────────────────────

function eventSlots(p: Profile): string[] {
  const out: string[] = [];

  const next = (p.income?.upcoming ?? [])[0];
  if (next?.expectedDate) {
    out.push(
      next.status === "announced"
        ? `${next.ticker} pays ${next.dpsText} around ${next.expectedDate}. How much lands in my account, and does it change anything?`
        : `${next.ticker} is forecast to pay ${next.dpsText} around ${next.expectedDate}. How reliable is that estimate for my position?`
    );
  }

  const win = p.benchmark?.windows.find((w) => w.rows.some((r) => r.excessPct != null));
  if (win) {
    const worst = win.rows
      .filter((r) => r.excessPct != null && r.excessPct < -5)
      .sort((a, b) => a.excessPct! - b.excessPct!)[0];
    if (worst) {
      const period = win.label.replace(/^(\d+)-month$/, "$1 months"); // "6-month" -> "6 months"
      out.push(
        `${worst.ticker} has lagged the KSE-100 by ${Math.abs(worst.excessPct!).toFixed(0)} points over the last ${period}. Is it still earning its place in my book?`
      );
    }
  }

  // A burst of recent buys in one name deserves a sizing review.
  const buys = p.recentTrades.filter((t) => /buy/i.test(t.type));
  const byTicker = new Map<string, number>();
  for (const b of buys) byTicker.set(b.ticker, (byTicker.get(b.ticker) ?? 0) + 1);
  const burst = [...byTicker.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])[0];
  if (burst) {
    out.push(`I have bought ${burst[0]} ${burst[1]} times recently. Review my sizing and average cost after those adds.`);
  }

  return out;
}

// ── Generation ───────────────────────────────────────────────────────────────

const GENERATION_PROMPT = `You write suggested questions for a Pakistan Stock Exchange portfolio research assistant. The user is a LONG-TERM INVESTOR: fundamentals, valuation, income, concentration, never trading (no targets, stop-losses, timing, breakouts).

From the portfolio profile below, write ${GENERATED_CAP + 4} distinct suggested questions the user would genuinely want to ask next. Rules:
- First person, as the user would type them ("Which of my holdings...", "Should I...").
- Each must be specific to THIS portfolio: reference their actual tickers, weights, payers, laggards, or recent activity. Nothing a generic investor could be shown.
- Learn from their question history: go deeper on themes they ask about, and cover one or two important angles they have never asked (income, concentration, benchmark excess, rate cycle, earnings quality).
- Do not repeat a question they already asked. Do not mention writing a thesis unless the profile says they use theses.
- One sentence each, 20 to 140 characters, plain language, no em dashes, no numbering commentary.

Return ONLY a JSON object: {"suggestions": ["...", "..."]}

Portfolio profile:
`;

async function generateWithFlash(profile: Profile): Promise<string[]> {
  const key = deepseekKey();
  if (!key) return [];
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: SUGGEST_MODEL,
      messages: [{ role: "user", content: GENERATION_PROMPT + profileText(profile) }],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 1200,
      thinking: { type: "disabled" },
    }),
  });
  if (!res.ok) throw new Error(`suggestion generation failed: ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content) as { suggestions?: unknown };
    return Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// ── Cache read/write ─────────────────────────────────────────────────────────

export async function getCachedSuggestions(
  supabase: SupabaseClient,
  userId: string
): Promise<SuggestionCache | null> {
  const { data } = await supabase
    .from("chat_suggestions")
    .select("suggestions, profile_hash, generated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || !Array.isArray(data.suggestions) || data.suggestions.length === 0) return null;
  return {
    suggestions: (data.suggestions as unknown[]).filter((s): s is string => typeof s === "string"),
    profileHash: (data.profile_hash as string | null) ?? null,
    generatedAt: String(data.generated_at),
  };
}

export function isStale(cache: SuggestionCache | null, currentHash?: string | null): boolean {
  if (!cache) return true;
  if (Date.now() - Date.parse(cache.generatedAt) > STALE_MS) return true;
  if (currentHash && cache.profileHash && currentHash !== cache.profileHash) return true;
  return false;
}

/**
 * Regenerate the user's suggestion pool when the profile changed or the cache
 * aged out. Returns the fresh (or still-valid cached) pool; null when the user
 * has no holdings or generation produced nothing usable.
 */
export async function refreshSuggestions(
  supabase: SupabaseClient,
  userId: string,
  opts?: { force?: boolean }
): Promise<SuggestionCache | null> {
  const [base, cached] = await Promise.all([
    cheapProfile(supabase, userId),
    getCachedSuggestions(supabase, userId),
  ]);
  if (!base) return cached;
  if (!opts?.force && !isStale(cached, base.hash)) return cached;

  const profile = await enrichProfile(supabase, userId, base);
  const held = new Set(profile.holdings.holdings.map((h) => h.ticker.toUpperCase()));
  const taken: string[] = [...profile.recentQuestions];
  const pool: string[] = [];
  const accept = (raw: string) => {
    const clean = validateSuggestion(raw, held, [...taken, ...pool]);
    if (clean && pool.length < POOL_TARGET) pool.push(clean);
  };

  // Deterministic event slots first — always correct, and they anchor the pool
  // in what is actually happening in the book right now.
  for (const slot of eventSlots(profile)) accept(slot);

  let generated: string[] = [];
  try {
    generated = await generateWithFlash(profile);
  } catch {
    generated = [];
  }
  let taken2 = 0;
  for (const s of generated) {
    if (taken2 >= GENERATED_CAP) break;
    const before = pool.length;
    accept(s);
    if (pool.length > before) taken2++;
  }

  // A pool too small to rotate is worse than the deterministic fallback.
  if (pool.length < 6) return cached;

  const row = {
    user_id: userId,
    suggestions: pool,
    profile_hash: profile.hash,
    model: SUGGEST_MODEL,
    generated_at: new Date().toISOString(),
  };
  await supabase.from("chat_suggestions").upsert(row, { onConflict: "user_id" });
  return { suggestions: pool, profileHash: profile.hash, generatedAt: row.generated_at };
}
