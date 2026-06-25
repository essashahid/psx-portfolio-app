import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { computeRatios, refreshRatios } from "@/lib/engine/ratios";
import { refreshQuote } from "@/lib/engine/market-data";
import type { PeerRow } from "./types";

const SECTOR_PEER_PRESETS: Record<string, string[]> = {
  cement: ["LUCK", "DGKC", "MLCF", "CHCC", "PIOC"],
  banking: ["HBL", "UBL", "MCB", "BAFL", "MEBL"],
  "commercial banks": ["HBL", "UBL", "MCB", "BAFL", "MEBL"],
  fertilizer: ["FFC", "FATIMA", "EFERT"],
  oil: ["OGDC", "PPL", "POL"],
  textile: ["GATM", "NML", "KTML"],
};

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
      ratios: ratios
        .filter((r) =>
          ["P/E", "P/B", "P/S", "Dividend yield (TTM)", "ROE", "Net margin", "Revenue growth", "EPS growth", "Debt-to-equity"].includes(
            r.ratio_name
          )
        )
        .map((r) => ({ ratio_name: r.ratio_name, ratio_value: r.ratio_value, source_period: r.source_period })),
      selectionReason: peerSelectionReason(peer, sector, preset),
    });
  }
  return rows;
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
  const metrics = ["P/E", "P/B", "ROE", "Net margin", "Dividend yield (TTM)"];
  const out: { ticker: string; metric: string; value: number | null }[] = [];
  for (const metric of metrics) {
    for (const row of rows) {
      const r = row.ratios.find((x) => x.ratio_name === metric);
      out.push({ ticker: row.ticker, metric, value: r?.ratio_value ?? null });
    }
  }
  return out;
}
