/**
 * State Bank of Pakistan EasyData.
 *
 * The one official, documented, free API in the macro stack. Everything else
 * this project reads for Pakistan macro was either a hardcoded step table or a
 * hardcoded month table, which is why this exists.
 *
 *   GET /api/v1/series/{key}/data?api_key=…&start_date=…&end_date=…&format=json
 *
 * A key is free from an EasyData account and expires every 90 days, which is
 * the main operational catch: a series that silently stops updating three
 * months after someone set it up looks exactly like a series that has not
 * moved. `fetchSbpSeries` therefore separates "no key configured" from "the
 * request failed", and neither case invents a value.
 *
 * Series keys are per-indicator and look like TS_GP_IRS_TBAUC_D.T60. They are
 * configured rather than hardcoded because the right series for "the short
 * rate" is a judgement call between the policy rate, the 3-month T-bill
 * cut-off and KIBOR, and that choice should not need a code change.
 */

const BASE = "https://easydata.sbp.org.pk/api/v1";
const TIMEOUT_MS = 15_000;

export interface SbpPoint {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  value: number;
}

export type SbpResult =
  | { ok: true; points: SbpPoint[] }
  | { ok: false; reason: "not-configured" | "no-series" | "request-failed"; detail?: string };

/** The API key, or null when EasyData is not set up in this environment. */
export function sbpApiKey(): string | null {
  return process.env.SBP_EASYDATA_API_KEY?.trim() || null;
}

/** Series key for the short-term PKR rate, if one is configured. */
export function sbpTbillSeries(): string | null {
  return process.env.SBP_TBILL_SERIES?.trim() || null;
}

/** Series key for national CPI, if one is configured. */
export function sbpCpiSeries(): string | null {
  return process.env.SBP_CPI_SERIES?.trim() || null;
}

/**
 * A row as EasyData returns it. The API is not strict about casing or which
 * field carries the observation date, so the parser accepts the shapes seen in
 * their own documentation rather than one canonical form.
 */
type RawRow = Record<string, unknown>;

function pick(row: RawRow, keys: string[]): unknown {
  for (const k of Object.keys(row)) {
    if (keys.includes(k.toLowerCase())) return row[k];
  }
  return undefined;
}

/** "2026-06-30", "30-06-2026" and "2026-06" all normalise to an ISO date. */
export function normaliseSbpDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Rows to points, dropping anything that is not a dated number. */
export function parseSbpRows(rows: unknown): SbpPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: SbpPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const date = normaliseSbpDate(pick(row as RawRow, ["date", "observation_date", "period", "time_period"]));
    const rawValue = pick(row as RawRow, ["value", "obs_value", "observation_value"]);
    const value = typeof rawValue === "number" ? rawValue : Number(String(rawValue ?? "").replace(/,/g, ""));
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

export async function fetchSbpSeries(
  seriesKey: string | null,
  startDate: string,
  endDate: string
): Promise<SbpResult> {
  const key = sbpApiKey();
  if (!key) return { ok: false, reason: "not-configured" };
  if (!seriesKey) return { ok: false, reason: "no-series" };

  const url =
    `${BASE}/series/${encodeURIComponent(seriesKey)}/data` +
    `?api_key=${encodeURIComponent(key)}&start_date=${startDate}&end_date=${endDate}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false, reason: "request-failed", detail: `HTTP ${res.status}` };
    const json: unknown = await res.json();
    // The payload has been documented both as a bare array and as { data: [...] }.
    const rows = Array.isArray(json) ? json : (json as { data?: unknown })?.data;
    const points = parseSbpRows(rows);
    if (points.length === 0) return { ok: false, reason: "request-failed", detail: "no usable rows" };
    return { ok: true, points };
  } catch (e) {
    return { ok: false, reason: "request-failed", detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export const SBP_SOURCE = "sbp-easydata";
