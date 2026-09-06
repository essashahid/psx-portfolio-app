import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyAnnouncements, getCompanyAnnouncementArchive } from "@/lib/news/psx-announcements";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Filing } from "@/lib/company/types";

/** Map a PSX announcement title to a cockpit filing category. */
export function categorizeFiling(title: string): string {
  const t = title.toLowerCase();
  if (/\b(financial result|quarterly|half year|annual report|accounts|audited|un-?audited)\b/.test(t)) return "result";
  if (/\b(dividend|bonus|right|entitlement|payout)\b/.test(t)) return "dividend";
  if (/\bboard of directors|board meeting|bod meeting|meeting of the board\b/.test(t)) return "board_meeting";
  if (/\bmaterial information|price sensitive|disclosure\b/.test(t)) return "material";
  return "corporate_announcement";
}

const SOURCE_LABEL = "PSX Company Announcements";

/** Fewer stored rows than this and the live portal is consulted as well. */
const STORED_ENOUGH = 8;

interface EventRow {
  title: string;
  event_type: string | null;
  source_url: string | null;
  event_date: string | null;
}

function fromStored(r: EventRow): Filing {
  return {
    date: r.event_date,
    title: r.title,
    category: r.event_type ?? categorizeFiling(r.title),
    url: r.source_url ?? "https://dps.psx.com.pk/announcements/companies",
    source: SOURCE_LABEL,
  };
}

/** "Jun 11, 2026" or an ISO date to ISO; null when unreadable. */
function isoDate(label: string | null | undefined): string | null {
  if (!label) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  const d = new Date(label);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA") : null;
}

/**
 * Recent official PSX filings for one company, newest first.
 *
 * Served from market_events, which the market cron fills every weekday from
 * the exchange's own feed, so a page render no longer depends on the portal
 * answering in time. The live portal is consulted only when the store holds
 * too little for the company (a thin filer, or a ticker the cron has not seen
 * since the store began), and what it returns is written back so the next
 * render is served from the store.
 *
 * Returns [] rather than throwing so the Filings tab degrades to an empty
 * state when both the store and the portal are unavailable.
 */
export async function getCompanyFilings(
  ticker: string,
  count = 25,
  opts: { supabase?: SupabaseClient } = {}
): Promise<Filing[]> {
  const t = ticker.toUpperCase();
  let stored: Filing[] = [];
  if (opts.supabase) {
    try {
      const { data } = await opts.supabase
        .from("market_events")
        .select("title, event_type, source_url, event_date")
        .eq("ticker", t)
        .order("event_date", { ascending: false })
        .limit(count);
      stored = ((data ?? []) as EventRow[]).map(fromStored);
    } catch {
      stored = [];
    }
  }
  if (stored.length >= Math.min(STORED_ENOUGH, count)) return stored;

  let live: Filing[] = [];
  try {
    const rows = await getCompanyAnnouncements(t, count);
    live = rows.map((r) => ({
      date: isoDate(r.date),
      title: r.title,
      category: categorizeFiling(r.title),
      url: r.url,
      source: SOURCE_LABEL,
    }));
  } catch {
    live = [];
  }
  if (live.length === 0) return stored;

  // Write back, best effort, so the store catches up on companies the daily
  // sweep has not covered. Same conflict key as the market cron.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const seen = new Set<string>();
      const rows = live
        .filter((f) => f.date)
        .map((f) => ({
          ticker: t,
          event_type: f.category,
          title: f.title,
          source_url: f.url,
          source_quality: "high",
          event_date: f.date,
          summary: `${t}: ${f.title}`,
        }))
        .filter((r) => {
          const key = `${r.title}|${r.event_date}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (rows.length) await createAdminClient().from("market_events").upsert(rows, { onConflict: "ticker,title,event_date" });
    } catch {
      /* best effort */
    }
  }

  // Merge, newest first, without duplicating a filing the store already has.
  const key = (f: Filing) => `${f.title}|${f.date ?? ""}`;
  const have = new Set(stored.map(key));
  const merged = [...stored, ...live.filter((f) => !have.has(key(f)))];
  merged.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return merged.slice(0, count);
}

/**
 * The whole filing archive for one company, not just the newest page. Used by
 * the history backfill, which needs filings from several years back, beyond
 * the 100 rows a single portal response will ever return.
 */
export async function getCompanyFilingArchive(
  ticker: string,
  opts: { maxPages?: number; notBefore?: Date } = {}
): Promise<Filing[]> {
  try {
    const rows = await getCompanyAnnouncementArchive(ticker.toUpperCase(), opts);
    return rows.map((r) => ({
      date: isoDate(r.date),
      title: r.title,
      category: categorizeFiling(r.title),
      url: r.url,
      source: SOURCE_LABEL,
    }));
  } catch {
    return [];
  }
}
