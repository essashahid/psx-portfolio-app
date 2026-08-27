// Normalized shapes the Company Cockpit reads. The UI never touches an external
// API directly — it reads these from the service layer, which is backed by the
// shared company_* caches and the PSX provider.

export type Freshness = "fresh" | "stale" | "missing" | "partial" | "needs_review";

export interface SectionMeta {
  source: string | null;
  sourceUrl?: string | null;
  lastUpdated: string | null; // ISO
  freshness: Freshness;
}

export interface CompanyMetadata {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string;
  faceValue: number | null;
  sharesOutstanding: number | null;
  marketCap: number | null;
  website: string | null;
  description: string | null;
  businessLines: string[];
  meta: SectionMeta;
}

export interface Quote {
  ticker: string;
  price: number | null;
  prevClose: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  volume: number | null;
  asOf: string | null; // YYYY-MM-DD
  meta: SectionMeta;
}

export interface Candle {
  date: string;
  close: number;
  volume: number;
}

export interface Technicals {
  ticker: string;
  asOfDate: string | null;
  latestPrice: number | null;
  prevClose: number | null;
  dayChangePct: number | null;
  volume: number | null;
  averageVolume: number | null;
  ma20: number | null;
  ma50: number | null;
  ma100: number | null;
  ma200: number | null;
  rsi: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  distanceFromHighPct: number | null;
  distanceFromLowPct: number | null;
  volatility: number | null; // annualized %, derived from daily returns
  flags: TechnicalFlag[];
  history: Candle[];
  meta: SectionMeta;
}

export interface TechnicalFlag {
  label: string;
  tone: "neutral" | "positive" | "negative";
}

export interface CompanyDividendRow {
  date: string | null;       // ex / announcement date used for sorting
  announcementDate: string | null;
  exDate: string | null;
  payDate: string | null;
  perShare: number | null;
  percentage: number | null;
  kind: "cash" | "bonus" | "right" | "other";
  source: string;
}

export interface Filing {
  date: string | null;
  title: string;
  category: string;          // result | dividend | board_meeting | corporate_announcement | material
  url: string;
  source: string;
}

/** Everything the page shell needs to paint the top summary immediately. */
export interface CompanyHeader {
  metadata: CompanyMetadata;
  quote: Quote;
  technicals: Pick<
    Technicals,
    "fiftyTwoWeekHigh" | "fiftyTwoWeekLow" | "asOfDate"
  > | null;
}
