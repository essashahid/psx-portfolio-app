// Shared domain types (mirrors supabase/migrations/0001_init.sql)

export type StatementType = "holdings" | "trades" | "dividends" | "generic";

export type TxnType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "CASH_IN"
  | "CASH_OUT"
  | "FEE"
  | "TAX"
  | "BONUS"
  | "RIGHT"
  | "SPLIT"
  | "UNKNOWN";

export type ThesisStatus = "Active" | "Watch" | "Weakening" | "Broken" | "Closed";

export type EntryType =
  | "buy_decision"
  | "sell_decision"
  | "hold_review"
  | "news_reaction"
  | "result_review"
  | "dividend_review"
  | "general_note";

export type BriefingType =
  | "daily"
  | "weekly"
  | "risk_review"
  | "thesis_review"
  | "news_only"
  | "news_brief"
  | "dividend_review"
  | "journal_analysis"
  | "stock_review";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type Objective = "growth" | "income" | "preservation" | "learning";

export interface Profile {
  id: string;
  full_name: string | null;
  base_currency: string;
  cost_basis_method: string;
  manual_price_mode: boolean;
  demo_mode: boolean;
  free_cash: number;
  onboarded: boolean;
  experience_level: ExperienceLevel;
  risk_profile: RiskProfile | null;
  objective: Objective | null;
  extra_features: string[];
  hidden_features: string[];
}

export interface Holding {
  id: string;
  user_id: string;
  ticker: string;
  company_name: string | null;
  sector: string | null;
  quantity: number;
  avg_cost: number;
  total_cost: number;
  source: string;
  notes: string | null;
  last_updated: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  ticker: string;
  trade_date: string | null;
  settlement_date: string | null;
  type: TxnType;
  quantity: number | null;
  price: number | null;
  gross_amount: number | null;
  commission: number | null;
  tax: number | null;
  net_amount: number | null;
  realized_pl: number | null;
  source: string;
  notes: string | null;
  created_at: string;
}

export interface Dividend {
  id: string;
  ticker: string | null;
  company_name: string | null;
  announcement_date: string | null;
  ex_date: string | null;
  pay_date: string | null;
  payment_date: string | null;
  dividend_per_share: number | null;
  quantity_held: number | null;
  amount: number;
  tax: number | null;
  net_amount: number | null;
  status: "announced" | "expected" | "received" | "missing";
  notes: string | null;
  source: string;
  created_at: string;
}

export interface PriceRow {
  id: string;
  ticker: string;
  price: number;
  price_date: string;
  source: string;
}

export interface Target {
  id: string;
  ticker: string;
  target_price: number | null;
  target_allocation: number | null;
  review_level: number | null;
  notes: string | null;
}

export interface Thesis {
  id: string;
  ticker: string;
  why_bought: string | null;
  expectation: string | null;
  time_horizon: string | null;
  key_risks: string | null;
  sell_conditions: string | null;
  add_conditions: string | null;
  confidence: number | null;
  status: ThesisStatus;
  review_date: string | null;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  ticker: string | null;
  entry_date: string;
  entry_type: EntryType;
  title: string;
  body: string | null;
  expected_outcome: string | null;
  risk: string | null;
  confidence: number | null;
  follow_up_date: string | null;
  outcome: string | null;
  lessons: string | null;
  source: string;
  created_at: string;
}

export interface NewsArticle {
  id: string;
  ticker: string | null;
  company_name: string | null;
  sector: string | null;
  title: string;
  url: string;
  source: string | null;
  published_at: string | null;
  snippet: string | null;
  ai_summary: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  relevance_score: number | null;
  why_it_matters: string | null;
  thesis_impact: string | null;
  review_question: string | null;
  category: string | null;
  scope: "portfolio" | "market";
  impact_tickers: string[] | null;
  is_interesting: boolean;
  source_quality: "high" | "medium" | "low" | "unknown" | null;
  link_reason: string | null;
  low_confidence: boolean;
  saved: boolean;
  ignored: boolean;
  created_at: string;
}

export interface Briefing {
  id: string;
  briefing_type: BriefingType;
  ticker: string | null;
  title: string | null;
  content: string;
  model: string | null;
  created_at: string;
}

export interface AlertRow {
  id: string;
  ticker: string | null;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string | null;
  status: "open" | "dismissed" | "resolved";
  created_at: string;
}

export interface Snapshot {
  id: string;
  snapshot_date: string;
  total_value: number;
  total_cost: number;
  unrealized_pl: number;
}

// Canonical fields produced by the import normalizer
export interface NormalizedRow {
  ticker?: string | null;
  company_name?: string | null;
  sector?: string | null;
  quantity?: number | null;
  avg_cost?: number | null;
  market_price?: number | null;
  market_value?: number | null;
  total_cost?: number | null;
  trade_date?: string | null;
  settlement_date?: string | null;
  type?: TxnType | null;
  price?: number | null;
  gross_amount?: number | null;
  commission?: number | null;
  tax?: number | null;
  net_amount?: number | null;
  dividend_amount?: number | null;
  cash_balance?: number | null;
  description?: string | null;
}

export interface EnrichedHolding extends Holding {
  latest_price: number | null;
  price_date: string | null;
  price_source: string | null;
  market_value: number | null;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
  weight: number | null;
  target_price: number | null;
  target_allocation: number | null;
  review_level: number | null;
  distance_to_target_pct: number | null;
  dividend_income: number;
  thesis_status: ThesisStatus | null;
  thesis_confidence: number | null;
  review_date: string | null;
  has_thesis: boolean;
}

export interface PortfolioSummary {
  holdings: EnrichedHolding[];
  totalValue: number;
  totalCost: number;
  unrealizedPl: number;
  unrealizedPlPct: number | null;
  realizedPl: number;
  dividendIncome: number;
  expectedDividendIncome: number;
  pendingDividendIncome: number;
  pendingDividends: number;
  cashBalance: number;
  holdingsCount: number;
  largestHolding: EnrichedHolding | null;
  sectorWeights: { sector: string; value: number; weight: number }[];
  largestSector: { sector: string; weight: number } | null;
  pricedHoldings: number;
}
