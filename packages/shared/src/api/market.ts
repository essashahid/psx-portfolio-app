/**
 * The contract for GET /api/market/dashboard.
 *
 * The phone shows the index, how broad the move was, sectors ranked, and the
 * movers. The web dashboard reads more than this; the extra is desk material.
 */

export interface MarketIndex {
  name: string;
  value: number | null;
  change: number | null;
  changePct: number | null;
  /** When the snapshot was taken, as the provider reported it. */
  asOf: string | null;
  source: string | null;
}

export interface MarketBreadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  totalVolume: number;
  totalValue: number;
}

export interface MarketSector {
  sector: string;
  label: string;
  color: string;
  averageReturn: number | null;
  advancers: number;
  decliners: number;
  stockCount: number;
  topGainer: string | null;
  topGainerPct: number | null;
}

export interface MarketMover {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  color: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  /** True when the user holds it, so their own book stands out in the list. */
  owned: boolean;
}

export interface MarketResponse {
  index: MarketIndex | null;
  breadth: MarketBreadth | null;
  /** Best average return first. */
  sectors: MarketSector[];
  gainers: MarketMover[];
  losers: MarketMover[];
  mostActive: MarketMover[];
  updatedLabel: string | null;
}
