import { getCompanyAnnouncements } from "@/lib/news/psx-announcements";
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

/**
 * Recent official PSX filings for a single company, newest first, with cockpit
 * categories. Returns [] (never throws) so the News & Filings tab degrades to a
 * clean empty state when the portal is unreachable.
 */
export async function getCompanyFilings(ticker: string, count = 25): Promise<Filing[]> {
  try {
    const rows = await getCompanyAnnouncements(ticker.toUpperCase(), count);
    return rows.map((r) => ({
      date: r.date || null,
      title: r.title,
      category: categorizeFiling(r.title),
      url: r.url,
      source: "PSX Company Announcements",
    }));
  } catch {
    return [];
  }
}
