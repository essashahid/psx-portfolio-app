import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPsxSymbols } from "@/lib/market-data/psx-dps";
import { categorizeFiling } from "@/lib/company/filings";

/**
 * Market-wide events feed. The PSX portal exposes every company announcement
 * for a date range in a single POST, so today's official filings (results,
 * dividends, board meetings, material information) come back in one request —
 * no per-ticker loop. Rows are classified and cached in market_events;
 * ownership badges are applied per-user at render time.
 */

const BASE_URL = "https://dps.psx.com.pk";
const REQUEST_TIMEOUT_MS = 12_000;
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html, */*; q=0.01",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://dps.psx.com.pk/announcements/companies",
};

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function pktDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

interface RawEvent {
  date: string;
  time: string;
  ticker: string;
  companyName: string;
  title: string;
  url: string | null;
}

async function fetchMarketAnnouncements(dateFrom: string, dateTo: string): Promise<RawEvent[]> {
  const body = new URLSearchParams({ type: "C", symbol: "", query: "", count: "150", offset: "0", date_from: dateFrom, date_to: dateTo });
  let html: string;
  try {
    const res = await fetch(`${BASE_URL}/announcements`, { method: "POST", headers: BROWSER_HEADERS, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }
  const out: RawEvent[] = [];
  for (const row of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (cells.length < 5 || !cells[2]) continue;
    const pdf = row.match(/href="([^"]*\/download\/document\/[^"]+\.pdf)"/i)?.[1];
    out.push({
      date: cells[0],
      time: cells[1],
      ticker: cells[2].toUpperCase(),
      companyName: cells[3],
      title: cells[4],
      url: pdf ? (pdf.startsWith("http") ? pdf : `${BASE_URL}${pdf}`) : `${BASE_URL}/announcements/companies`,
    });
  }
  return out;
}

/** "Jun 11, 2026" → "2026-06-11"; falls back to today's PKT date. */
function isoDate(label: string): string {
  const d = new Date(label);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA") : pktDate();
}

export interface EventsResult {
  date: string;
  saved: number;
  errors: string[];
}

/**
 * Refresh today's market events. PSX filings are official, so source_quality is
 * "high". Re-runs upsert by (ticker, title, event_date) so the feed converges.
 */
export async function refreshMarketEvents(client?: SupabaseClient): Promise<EventsResult> {
  const db = client ?? createAdminClient();
  const today = pktDate();
  const errors: string[] = [];

  const [events, directory] = await Promise.all([
    fetchMarketAnnouncements(today, today),
    fetchPsxSymbols().catch(() => new Map()),
  ]);

  if (events.length === 0) return { date: today, saved: 0, errors: ["No announcements returned for today (market may be pre-open or a holiday)."] };

  // Dedupe by the conflict key — the feed can list the same filing twice (e.g.
  // notice + reminder), which Postgres rejects within a single upsert batch.
  const seen = new Set<string>();
  const rows = events
    .map((e) => ({
      ticker: e.ticker,
      company_name: e.companyName || directory.get(e.ticker)?.name || null,
      sector: directory.get(e.ticker)?.sector || null,
      event_type: categorizeFiling(e.title),
      title: e.title,
      source_url: e.url,
      source_quality: "high",
      event_date: isoDate(e.date),
      event_time: e.time || null,
      summary: `${e.companyName || e.ticker} — ${e.title}`,
    }))
    .filter((r) => {
      const key = `${r.ticker}|${r.title}|${r.event_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  let saved = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error, count } = await db
      .from("market_events")
      .upsert(rows.slice(i, i + 200), { onConflict: "ticker,title,event_date", count: "exact" });
    if (error) errors.push(error.message);
    else saved += count ?? rows.slice(i, i + 200).length;
  }

  await db.from("data_fetch_logs").insert({
    ticker: null, section: "market_events", source: "psx-announcements",
    status: errors.length ? "error" : "ok", rows: saved, detail: errors.join("; ").slice(0, 300) || `${rows.length} events`,
  }).then(() => {}, () => {});

  return { date: today, saved, errors };
}
