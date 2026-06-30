import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStockMasterMap } from "@/lib/stock-master";

/**
 * Market-wide dividend / payout history from the official PSX payouts feed
 * (POST /payouts?symbol=…). One request per company returns the full payout
 * history as rows like:
 *   ["AIRLINK", "Air Link…", "TECHNOLOGY…", "20%(i) (D)", "October 23, 2025 3:22 PM", "04/11/2025 - 06/11/2025"]
 * where "20%(i) (D)" = 20% interim cash dividend. Cash DPS = percentage/100 ×
 * face value (PSX equities are PKR 10 par unless stated). Persisted to
 * company_payouts so the ratios engine can compute trailing yield / payout /
 * cover for every company. Nothing is invented — non-cash payouts (bonus/right)
 * are stored with kind set and a null cash DPS.
 */

const BASE_URL = "https://dps.psx.com.pk";
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_FACE_VALUE = 10;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html, */*; q=0.01",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://dps.psx.com.pk/",
};

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export interface Payout {
  kind: "cash" | "bonus" | "right";
  term: "interim" | "final" | "special" | null;
  percentage: number | null;
  dividendPerShare: number | null;
  faceValue: number;
  announcementDate: string | null; // ISO
  announcedAt: string | null;
  bookClosureStart: string | null;
  bookClosureEnd: string | null;
  raw: string;
}

/** Parse "20%(i) (D)" → { percentage 20, term interim, kind cash }. */
function parseAnnouncement(raw: string): { percentage: number | null; term: Payout["term"]; kind: Payout["kind"] } {
  const pct = raw.match(/([\d.]+)\s*%/);
  const percentage = pct ? Number(pct[1]) : null;
  const lower = raw.toLowerCase();
  const term: Payout["term"] = /\(i\)|interim/.test(lower) ? "interim" : /\(f\)|final/.test(lower) ? "final" : /special/.test(lower) ? "special" : null;
  // (D) cash dividend, (B) bonus, (R) right. Default to cash when a % dividend.
  const kind: Payout["kind"] = /\(b\)|bonus/.test(lower) ? "bonus" : /\(r\)|right/.test(lower) ? "right" : "cash";
  return { percentage, term, kind };
}

/** "October 23, 2025 3:22 PM" → "2025-10-23". */
function parseAnnounceDate(s: string): string | null {
  const d = new Date(s.replace(/\s+\d{1,2}:\d{2}\s*(AM|PM)$/i, ""));
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA") : null;
}

/** "04/11/2025 - 06/11/2025" (DD/MM/YYYY) → [start, end] ISO. */
function parseBookClosure(s: string): [string | null, string | null] {
  const parts = s.split("-").map((p) => p.trim());
  const toIso = (p: string): string | null => {
    const m = p.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  return [parts[0] ? toIso(parts[0]) : null, parts[1] ? toIso(parts[1]) : null];
}

export async function fetchPayouts(ticker: string, faceValue = DEFAULT_FACE_VALUE): Promise<Payout[]> {
  let html: string;
  try {
    const res = await fetch(`${BASE_URL}/payouts`, {
      method: "POST",
      headers: { ...BROWSER_HEADERS, Referer: `${BASE_URL}/company/${ticker.toUpperCase()}` },
      body: new URLSearchParams({ symbol: ticker.toUpperCase() }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const out: Payout[] = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1]));
    if (cells.length < 5 || /^symbol$/i.test(cells[0])) continue; // header
    const raw = cells[3];
    if (!raw) continue;
    const { percentage, term, kind } = parseAnnouncement(raw);
    const [bcStart, bcEnd] = cells[5] ? parseBookClosure(cells[5]) : [null, null];
    out.push({
      kind,
      term,
      percentage,
      dividendPerShare: kind === "cash" && percentage != null ? (percentage / 100) * faceValue : null,
      faceValue,
      announcementDate: cells[4] ? parseAnnounceDate(cells[4]) : null,
      announcedAt: cells[4] || null,
      bookClosureStart: bcStart,
      bookClosureEnd: bcEnd,
      raw,
    });
  }
  return out;
}

export interface PayoutResult {
  ticker: string;
  saved: number;
  cashPayouts: number;
  errors: string[];
}

/** Fetch + persist payout history for a ticker into company_payouts. */
export async function populatePayouts(ticker: string, client?: SupabaseClient): Promise<PayoutResult> {
  const t = ticker.toUpperCase();
  const db = client ?? createAdminClient();
  const out: PayoutResult = { ticker: t, saved: 0, cashPayouts: 0, errors: [] };

  // Face value: prefer a known value from stock_master, else PSX default (10).
  const master = (await getStockMasterMap()).get(t);
  const faceValue = master?.face_value && Number(master.face_value) > 0 ? Number(master.face_value) : DEFAULT_FACE_VALUE;

  const payouts = await fetchPayouts(t, faceValue);
  if (payouts.length === 0) return out;

  const seen = new Set<string>();
  const rows = payouts
    .map((p) => ({
      ticker: t,
      kind: p.kind,
      term: p.term,
      percentage: p.percentage,
      face_value: p.faceValue,
      dividend_per_share: p.dividendPerShare,
      announcement_date: p.announcementDate,
      announced_at: p.announcedAt,
      book_closure_start: p.bookClosureStart,
      book_closure_end: p.bookClosureEnd,
      raw: p.raw,
      source: "psx-payouts",
      updated_at: new Date().toISOString(),
    }))
    .filter((r) => {
      const key = `${r.raw}|${r.announcement_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const { error } = await db.from("company_payouts").upsert(rows, { onConflict: "ticker,raw,announcement_date" });
  if (error) out.errors.push(error.message);
  else {
    out.saved = rows.length;
    out.cashPayouts = rows.filter((r) => r.dividend_per_share != null).length;
  }
  return out;
}
