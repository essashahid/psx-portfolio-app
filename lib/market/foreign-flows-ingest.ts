import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Foreign / local flow ingestion (FIPI / LIPI).
 *
 * Two paths, both producing the same normalized FlowIngestPayload:
 *   1. Manual — the owner pastes the day's numbers (headline + per-sector lines)
 *      from the NCCPL report; the forgiving parsers below turn them into rows.
 *   2. Auto — the scheduled job can fetch SCSTrade's public FIPI/LIPI JSON
 *      endpoints, or a custom JSON URL when NCCPL_FLOWS_URL is configured.
 *      NCCPL's own site is Cloudflare-protected and has no stable public API,
 *      so the default source is intentionally adapter-based and best-effort.
 *
 * Amounts are stored in their reported unit (NCCPL reports USD millions).
 */

export interface FlowIngestPayload {
  date: string; // YYYY-MM-DD
  currency?: string;
  fipi?: { net?: number | null; grossBuy?: number | null; grossSell?: number | null };
  sectors?: { sector: string; net: number; grossBuy?: number | null; grossSell?: number | null }[];
  participants?: { category: string; label?: string; net: number }[];
  sourceProvider?: string;
  sourceUrl?: string | null;
  note?: string | null;
}

export interface IngestResult {
  date: string;
  fipiNet: number | null;
  sectors: number;
  participants: number;
  source: string;
}

type AutoProvider = "scstrade" | "custom" | "off";

type ScsFlowRow = {
  FLType?: string;
  FLTypeNew?: string;
  FLSectorName?: string;
  FLBuyValue?: number;
  FLSellValue?: number;
  FLNetValueUSD?: number;
};

type ScsResponse<T> = {
  d?: T[];
};

// ---------------------------------------------------------------------------
// Parsing helpers (manual paste)
// ---------------------------------------------------------------------------

/** Pull a signed number out of a string, tolerating commas, $, parentheses-as-negative and units. */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[$,]/g, "");
  let sign = 1;
  // (1.2) accounting-style negative
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    sign = -1;
    s = paren[1];
  }
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n * sign : null;
}

/**
 * Parse "Sector, net" (or "Sector  net", "Sector | net") lines into sector
 * flows. The amount is the trailing number on the line; everything before it is
 * the sector name. Blank lines and comment lines (#) are ignored.
 */
export function parseSectorLines(text: string | null | undefined): FlowIngestPayload["sectors"] {
  if (!text) return [];
  const out: NonNullable<FlowIngestPayload["sectors"]> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // split on the last comma / pipe / tab / run of spaces before a number
    const m = trimmed.match(/^(.*?)[\s,|]+(-?\(?\$?[\d.,]+\)?)\s*$/);
    if (!m) continue;
    const sector = m[1].replace(/[,|]+$/, "").trim();
    const net = parseAmount(m[2]);
    if (sector && net != null) out.push({ sector, net });
  }
  return out;
}

const PARTICIPANT_ALIASES: { match: RegExp; category: string; label: string }[] = [
  { match: /individual/i, category: "individuals", label: "Individuals" },
  { match: /mutual\s*fund/i, category: "mutual_funds", label: "Mutual Funds" },
  { match: /bank|dfi/i, category: "banks_dfi", label: "Banks / DFI" },
  { match: /insur/i, category: "insurance", label: "Insurance" },
  { match: /broker|proprietary/i, category: "brokers", label: "Broker Proprietary" },
  { match: /nbfc/i, category: "nbfc", label: "NBFC" },
  { match: /compan|corporate/i, category: "companies", label: "Companies" },
  { match: /other/i, category: "other_organizations", label: "Other Organizations" },
];

export function normalizeParticipant(label: string): { category: string; label: string } {
  for (const a of PARTICIPANT_ALIASES) if (a.match.test(label)) return { category: a.category, label: a.label };
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "other";
  return { category: slug, label: label.trim() || "Other" };
}

/** Parse "Individuals, -8.0" style participant lines into LIPI rows. */
export function parseParticipantLines(text: string | null | undefined): FlowIngestPayload["participants"] {
  if (!text) return [];
  const out: NonNullable<FlowIngestPayload["participants"]> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^(.*?)[\s,|]+(-?\(?\$?[\d.,]+\)?)\s*$/);
    if (!m) continue;
    const net = parseAmount(m[2]);
    if (net == null) continue;
    const { category, label } = normalizeParticipant(m[1].replace(/[,|]+$/, "").trim());
    out.push({ category, label, net });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Upsert one day of flows (headline + sectors + participants). Idempotent per date. */
export async function ingestForeignFlows(
  admin: SupabaseClient,
  payload: FlowIngestPayload,
  opts: { ingestedBy: "manual" | "auto" } = { ingestedBy: "manual" }
): Promise<IngestResult> {
  const date = payload.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid flow date "${date}" (expected YYYY-MM-DD).`);

  const fipiNet = payload.fipi?.net ?? null;
  // In a two-sided market local net mirrors foreign net unless reported separately.
  const lipiNet = fipiNet != null ? -fipiNet : null;
  const now = new Date().toISOString();

  const { error: dayErr } = await admin.from("foreign_flow_days").upsert(
    {
      market: "PSX",
      flow_date: date,
      currency: payload.currency ?? "USD",
      fipi_net: fipiNet,
      fipi_gross_buy: payload.fipi?.grossBuy ?? null,
      fipi_gross_sell: payload.fipi?.grossSell ?? null,
      lipi_net: lipiNet,
      source_provider: payload.sourceProvider ?? (opts.ingestedBy === "auto" ? "nccpl" : "manual"),
      source_url: payload.sourceUrl ?? null,
      ingested_by: opts.ingestedBy,
      note: payload.note ?? null,
      updated_at: now,
    },
    { onConflict: "market,flow_date" }
  );
  if (dayErr) throw new Error(`flows day: ${dayErr.message}`);

  const sectors = payload.sectors ?? [];
  if (sectors.length) {
    const rows = sectors.map((s) => ({
      market: "PSX",
      flow_date: date,
      sector: s.sector,
      net: s.net,
      gross_buy: s.grossBuy ?? null,
      gross_sell: s.grossSell ?? null,
    }));
    const { error } = await admin.from("foreign_flow_sectors").upsert(rows, { onConflict: "market,flow_date,sector" });
    if (error) throw new Error(`flows sectors: ${error.message}`);
  }

  const participants = payload.participants ?? [];
  if (participants.length) {
    const rows = participants.map((p) => ({
      market: "PSX",
      flow_date: date,
      category: p.category,
      label: p.label ?? p.category,
      net: p.net,
    }));
    const { error } = await admin.from("local_flow_participants").upsert(rows, { onConflict: "market,flow_date,category" });
    if (error) throw new Error(`flows participants: ${error.message}`);
  }

  return {
    date,
    fipiNet,
    sectors: sectors.length,
    participants: participants.length,
    source: payload.sourceProvider ?? (opts.ingestedBy === "auto" ? "nccpl" : "manual"),
  };
}

// ---------------------------------------------------------------------------
// Best-effort auto fetch (env-pluggable)
// ---------------------------------------------------------------------------

export function foreignFlowsAutoConfigured(): boolean {
  return foreignFlowsProvider() !== "off";
}

/**
 * Defensively map an upstream JSON document into a FlowIngestPayload. NCCPL's
 * shape isn't a stable public contract, so we try a few plausible field names
 * and return null when nothing usable is found — the caller treats null as
 * "auto unavailable, keep manual".
 */
export function mapNccplJson(raw: unknown, date: string): FlowIngestPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = parseAmount(v);
        if (n != null) return n;
      }
    }
    return null;
  };
  const net = pick("fipi_net", "fipiNet", "net", "foreign_net");
  const grossBuy = pick("fipi_buy", "gross_buy", "buy", "foreign_buy");
  const grossSell = pick("fipi_sell", "gross_sell", "sell", "foreign_sell");
  if (net == null && grossBuy == null && grossSell == null) return null;

  const sectorsRaw = (obj.sectors ?? obj.sector_flows) as unknown;
  const sectors: FlowIngestPayload["sectors"] = Array.isArray(sectorsRaw)
    ? sectorsRaw
        .map((s) => {
          const so = s as Record<string, unknown>;
          const sector = String(so.sector ?? so.name ?? "").trim();
          const sn = typeof so.net === "number" ? so.net : parseAmount(String(so.net ?? ""));
          return sector && sn != null ? { sector, net: sn } : null;
        })
        .filter((x): x is { sector: string; net: number } => x != null)
    : [];

  return {
    date,
    currency: typeof obj.currency === "string" ? obj.currency : "USD",
    fipi: { net, grossBuy, grossSell },
    sectors,
    sourceProvider: "nccpl",
    sourceUrl: process.env.NCCPL_FLOWS_URL ?? null,
  };
}

/** Fetch + ingest the latest day from the configured auto provider. Returns null if unavailable. */
export async function fetchAndIngestForeignFlows(admin: SupabaseClient): Promise<IngestResult | null> {
  const provider = foreignFlowsProvider();
  if (provider === "off") return null;
  if (provider === "custom") return fetchAndIngestCustomForeignFlows(admin);

  const customFallback = !!process.env.NCCPL_FLOWS_URL?.trim();
  const scs = await fetchScsTradeFlows();
  if (scs) return ingestForeignFlows(admin, scs, { ingestedBy: "auto" });
  return customFallback ? fetchAndIngestCustomForeignFlows(admin) : null;
}

function foreignFlowsProvider(): AutoProvider {
  const configured = (process.env.FOREIGN_FLOWS_PROVIDER ?? "").trim().toLowerCase();
  if (configured === "off" || configured === "manual" || configured === "none") return "off";
  if (configured === "custom" || configured === "nccpl") return process.env.NCCPL_FLOWS_URL?.trim() ? "custom" : "off";
  return "scstrade";
}

async function fetchAndIngestCustomForeignFlows(admin: SupabaseClient): Promise<IngestResult | null> {
  const url = process.env.NCCPL_FLOWS_URL?.trim();
  if (!url) return null;
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    const payload = mapNccplJson(raw, date);
    if (!payload) return null;
    return await ingestForeignFlows(admin, payload, { ingestedBy: "auto" });
  } catch {
    return null;
  }
}

const SCSTRADE_FLOWS_URL = "https://www.scstrade.com/FIPILIPI.aspx";
const SCSTRADE_TIMEOUT_MS = 20_000;
const FLOW_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Content-Type": "application/json; charset=utf-8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: SCSTRADE_FLOWS_URL,
};

/** "2023-03-15" -> "03/15/2023", the form SCSTrade's endpoints expect. */
export function toScsDate(isoDate: string): string | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, year, month, day] = m;
  return `${month}/${day}/${year}`;
}

/** The latest session SCSTrade is currently publishing, as YYYY-MM-DD. */
export async function fetchScsLatestFlowDate(): Promise<string | null> {
  try {
    const page = await fetch(SCSTRADE_FLOWS_URL, {
      headers: { "User-Agent": FLOW_HEADERS["User-Agent"], Accept: "text/html" },
      signal: AbortSignal.timeout(SCSTRADE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!page.ok) return null;
    const mmddyyyy = extractScsLatestDate(await page.text());
    return mmddyyyy ? toIsoDate(mmddyyyy) : null;
  } catch {
    return null;
  }
}

/**
 * One session's flows from SCSTrade.
 *
 * The endpoints accept an arbitrary date range rather than only serving the
 * latest session, so passing `isoDate` reaches back through the archive. That
 * is what makes a historical backfill possible; asking for a single day (date1
 * equal to date2) returns that day's figures rather than a running total.
 *
 * Omitting the date falls back to whichever session the page currently shows,
 * which is what the daily cron wants.
 */
export async function fetchScsTradeFlows(isoDate?: string): Promise<FlowIngestPayload | null> {
  try {
    let mmddyyyy: string | null;
    if (isoDate) {
      mmddyyyy = toScsDate(isoDate);
    } else {
      const page = await fetch(SCSTRADE_FLOWS_URL, {
        headers: { "User-Agent": FLOW_HEADERS["User-Agent"], Accept: "text/html" },
        signal: AbortSignal.timeout(SCSTRADE_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!page.ok) return null;
      mmddyyyy = extractScsLatestDate(await page.text());
    }
    if (!mmddyyyy) return null;
    const date = toIsoDate(mmddyyyy);
    if (!date) return null;

    const [summaryRows, sectorRows, participantRows] = await Promise.all([
      fetchScsRows<ScsFlowRow>("loadmainsum", mmddyyyy),
      fetchScsRows<ScsFlowRow>("loadfipiInvestor", mmddyyyy),
      fetchScsRows<ScsFlowRow>("loadmainsumdetails", mmddyyyy),
    ]);

    const headline = summaryRows.find((r) => cleanLabel(r.FLType) === "FIPI");
    const sectors = sectorRows
      .filter((r) => cleanLabel(r.FLTypeNew) === "FIPI")
      .map((r) => ({
        sector: cleanSectorName(r.FLSectorName),
        net: asNumber(r.FLNetValueUSD),
        grossBuy: asNumber(r.FLBuyValue),
        grossSell: absNumber(r.FLSellValue),
      }))
      .filter((s): s is { sector: string; net: number; grossBuy: number | null; grossSell: number | null } => !!s.sector && s.net != null);

    const participants = participantRows
      .filter((r) => isLocalParticipant(r.FLType))
      .map((r) => {
        const label = cleanParticipantLabel(r.FLType);
        const p = normalizeParticipant(label);
        return { ...p, net: asNumber(r.FLNetValueUSD) };
      })
      .filter((p): p is { category: string; label: string; net: number } => p.net != null);

    const net = asNumber(headline?.FLNetValueUSD);
    const grossBuy = asNumber(headline?.FLBuyValue);
    const grossSell = absNumber(headline?.FLSellValue);
    if (net == null && sectors.length === 0 && participants.length === 0) return null;

    return {
      date,
      currency: "USD",
      fipi: { net, grossBuy, grossSell },
      sectors,
      participants,
      sourceProvider: "scstrade",
      sourceUrl: `${SCSTRADE_FLOWS_URL}?start=${encodeURIComponent(mmddyyyy)}&end=${encodeURIComponent(mmddyyyy)}`,
      note: "Auto-fetched from SCSTrade FIPI/LIPI public tables; source data is attributed to NCCPL.",
    };
  } catch {
    return null;
  }
}

async function fetchScsRows<T>(endpoint: string, mmddyyyy: string): Promise<T[]> {
  const res = await fetch(`${SCSTRADE_FLOWS_URL}/${endpoint}`, {
    method: "POST",
    headers: FLOW_HEADERS,
    body: JSON.stringify({ date1: mmddyyyy, date2: mmddyyyy }),
    signal: AbortSignal.timeout(SCSTRADE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as ScsResponse<T> | null;
  return Array.isArray(data?.d) ? data.d : [];
}

function extractScsLatestDate(html: string): string | null {
  return html.match(/id="date2"[^>]*value="(\d{2}\/\d{2}\/\d{4})"/i)?.[1] ?? html.match(/id="date1"[^>]*value="(\d{2}\/\d{2}\/\d{4})"/i)?.[1] ?? null;
}

function toIsoDate(mmddyyyy: string): string | null {
  const m = mmddyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, month, day, year] = m;
  return `${year}-${month}-${day}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseAmount(value);
  return null;
}

function absNumber(value: unknown): number | null {
  const n = asNumber(value);
  return n == null ? null : Math.abs(n);
}

function cleanLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function cleanSectorName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s*\(mn\$?\)\s*/gi, "").replace(/\s+/g, " ").trim();
}

function cleanParticipantLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isLocalParticipant(value: string | null | undefined): boolean {
  const label = cleanLabel(value);
  if (!label || label === "FIPI" || label === "LIPI") return false;
  return !["FOREIGN CORPORATES", "FOREIGN INDIVIDUAL", "OVERSEAS PAKISTANI"].includes(label);
}
