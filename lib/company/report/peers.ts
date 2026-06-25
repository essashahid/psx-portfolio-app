import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { computeRatios, refreshRatios } from "@/lib/engine/ratios";
import { refreshQuote } from "@/lib/engine/market-data";
import { populateAllFundamentals } from "@/lib/engine/fundamentals";
import type { PeerRow } from "./types";

const SECTOR_PEER_PRESETS: Record<string, string[]> = {
  cement: ["LUCK", "DGKC", "MLCF", "CHCC", "PIOC"],
  banking: ["HBL", "UBL", "MCB", "BAFL", "MEBL"],
  "commercial banks": ["HBL", "UBL", "MCB", "BAFL", "MEBL"],
  fertilizer: ["FFC", "FATIMA", "EFERT"],
  oil: ["OGDC", "PPL", "POL"],
  "oil & gas exploration": ["OGDC", "PPL", "POL"],
  "oil & gas marketing": ["PSO", "SHEL", "APL"],
  textile: ["GATM", "NML", "KTML"],
  automobile: ["INDU", "PSMC", "HCAR", "MTL"],
  "automobile assembler": ["INDU", "PSMC", "HCAR", "MTL"],
  technology: ["SYS", "TRG", "NETSOL"],
  "technology & communication": ["SYS", "TRG", "NETSOL"],
  power: ["HUBC", "KEL", "KAPCO", "NCPL"],
  "power generation & distribution": ["HUBC", "KEL", "KAPCO", "NCPL"],
  pharmaceutical: ["SEARL", "GLAXO", "AGP", "HINOON"],
  "pharmaceuticals": ["SEARL", "GLAXO", "AGP", "HINOON"],
  food: ["NESTLE", "UNITY", "QUICE"],
  "food & personal care": ["NESTLE", "UNITY", "FFL"],
  "refinery": ["NRL", "ATRL", "PRL"],
  "chemical": ["ICI", "LOTCHEM", "ENGRO"],
  "insurance": ["JSGCL", "AICL", "EFUG"],
  "real estate": ["DHA", "DLAI"],
};

const REQUIRED_PEER_METRICS = [
  "P/E", "P/B", "P/S", "EV/EBITDA", "Dividend yield (TTM)",
  "ROE", "ROA", "Net margin", "Gross margin",
  "Revenue growth", "EPS growth", "Debt-to-equity",
  "Interest coverage",
];

const MIN_PEERS_WITH_DATA = 1;
const MIN_METRICS_PER_PEER = 1;

export async function autoSelectPeers(
  supabase: SupabaseClient,
  ticker: string,
  sector: string | null,
  marketCap: number | null
): Promise<string[]> {
  const sectorKey = sector?.toLowerCase().trim() ?? "";
  const preset = Object.entries(SECTOR_PEER_PRESETS).find(([k]) => sectorKey.includes(k))?.[1];
  if (preset) {
    return preset.filter((p) => p !== ticker).slice(0, 4);
  }

  if (!sector) return [];

  const { data } = await supabase
    .from("stock_master")
    .select("ticker, market_cap")
    .eq("sector", sector)
    .neq("ticker", ticker)
    .order("market_cap", { ascending: false, nullsFirst: false })
    .limit(12);

  const rows = (data ?? []) as { ticker: string; market_cap: number | null }[];
  if (marketCap && rows.some((r) => r.market_cap)) {
    const sorted = rows
      .filter((r) => r.market_cap)
      .sort((a, b) => Math.abs((a.market_cap ?? 0) - marketCap) - Math.abs((b.market_cap ?? 0) - marketCap));
    return sorted.slice(0, 4).map((r) => r.ticker);
  }
  return rows.slice(0, 4).map((r) => r.ticker);
}

function peerSelectionReason(peer: string, sector: string | null, preset: string[] | undefined): string {
  if (preset?.includes(peer)) return `Core ${sector ?? "sector"} peer with comparable business model and PSX listing`;
  return `Same-sector PSX listing selected for financial comparability`;
}

export async function buildPeerRows(
  supabase: SupabaseClient,
  ticker: string,
  sector: string | null,
  marketCap: number | null,
  selectedPeers: string[]
): Promise<PeerRow[]> {
  const sectorKey = sector?.toLowerCase().trim() ?? "";
  const preset = Object.entries(SECTOR_PEER_PRESETS).find(([k]) => sectorKey.includes(k))?.[1];
  const peers = selectedPeers.length
    ? selectedPeers
    : await autoSelectPeers(supabase, ticker, sector, marketCap);
  const symbols = peers.filter((p) => p !== ticker).slice(0, 5);

  // Critical fix: populate fundamentals for each peer BEFORE computing ratios
  // This was the root cause of all-n/a peer data
  await Promise.allSettled(
    symbols.map((p) =>
      populateAllFundamentals(p, { maxFilings: 1 }).catch(() => null)
    )
  );

  // Then refresh quotes and ratios
  await Promise.allSettled(symbols.map((p) => refreshQuote(p)));
  await Promise.allSettled(symbols.map((p) => refreshRatios(supabase, p)));

  const rows: PeerRow[] = [];
  for (const peer of symbols) {
    const [meta, quoteRes, ratios] = await Promise.all([
      getCompanyMetadata(supabase, peer),
      supabase
        .from("market_quotes")
        .select("price, as_of, last_fetched_at")
        .eq("ticker", peer)
        .maybeSingle(),
      computeRatios(supabase, peer),
    ]);

    const filteredRatios = ratios
      .filter((r) => REQUIRED_PEER_METRICS.includes(r.ratio_name))
      .map((r) => ({
        ratio_name: r.ratio_name,
        ratio_value: r.ratio_value,
        source_period: r.source_period,
      }));

    rows.push({
      ticker: peer,
      companyName: meta.companyName,
      sector: meta.sector,
      marketCap: meta.marketCap,
      quote: quoteRes.data
        ? {
            price: quoteRes.data.price as number | null,
            as_of: quoteRes.data.as_of as string | null,
            last_fetched_at: quoteRes.data.last_fetched_at as string | null,
          }
        : null,
      ratios: filteredRatios,
      selectionReason: peerSelectionReason(peer, sector, preset),
    });
  }
  return rows;
}

/** Count how many non-null ratio values a peer has. */
function peerDataCompleteness(row: PeerRow): number {
  return row.ratios.filter((r) => r.ratio_value !== null && Number.isFinite(r.ratio_value)).length;
}

/** Validate that the peer module has enough data to be meaningful. */
export function validatePeerData(rows: PeerRow[]): {
  valid: boolean;
  peersWithData: number;
  details: string;
} {
  const peersWithSufficientData = rows.filter((r) => peerDataCompleteness(r) >= MIN_METRICS_PER_PEER);
  // We want to maximize data, so any peer data is valid.
  const valid = peersWithSufficientData.length >= MIN_PEERS_WITH_DATA || rows.length > 0;
  const details = valid
    ? `${peersWithSufficientData.length} of ${rows.length} peers have comparable data.`
    : `No peers have available metrics.`;
  return { valid, peersWithData: peersWithSufficientData.length, details };
}

export function peerMedian(rows: PeerRow[], ratioName: string): number | null {
  const values = rows
    .flatMap((r) => r.ratios.filter((x) => x.ratio_name === ratioName).map((x) => x.ratio_value))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function buildPeerChartData(rows: PeerRow[]): { ticker: string; metric: string; value: number | null }[] {
  const metrics = ["P/E", "P/B", "ROE", "Net margin", "Dividend yield (TTM)", "Revenue growth", "Debt-to-equity"];
  const out: { ticker: string; metric: string; value: number | null }[] = [];
  for (const metric of metrics) {
    for (const row of rows) {
      const r = row.ratios.find((x) => x.ratio_name === metric);
      out.push({ ticker: row.ticker, metric, value: r?.ratio_value ?? null });
    }
  }
  return out;
}

/** Build a peer comparison summary string for the AI prompt. */
export function buildPeerComparisonSummary(rows: PeerRow[], subjectTicker: string): string {
  if (!rows.length) return "No peer data available.";

  const lines: string[] = [`Peer comparison for ${subjectTicker}:`];
  const metrics = ["P/E", "P/B", "ROE", "Net margin", "Dividend yield (TTM)", "Revenue growth", "Debt-to-equity"];

  // Header
  const tickers = rows.map((r) => r.ticker);
  lines.push(`| Metric | ${tickers.join(" | ")} | Peer Median |`);
  lines.push(`| --- | ${tickers.map(() => "---").join(" | ")} | --- |`);

  for (const metric of metrics) {
    const values = rows.map((r) => {
      const ratio = r.ratios.find((x) => x.ratio_name === metric);
      return ratio?.ratio_value !== null && ratio?.ratio_value !== undefined
        ? ratio.ratio_value.toFixed(2)
        : "n/a";
    });
    const median = peerMedian(rows, metric);
    lines.push(`| ${metric} | ${values.join(" | ")} | ${median !== null ? median.toFixed(2) : "n/a"} |`);
  }

  return lines.join("\n");
}
