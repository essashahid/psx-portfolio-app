"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ActionButton } from "@/components/action-button";
import { AXIS_TICK, ChartEmpty, CURSOR, GlassTooltip, INK, SERIES_COLORS, fmtCompact } from "@/components/chart-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { CompanyMetadata } from "@/lib/company/types";
import type { RatioRow } from "@/lib/engine/ratios";
import { cn, formatFinancialPeriod, formatNumber } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowDownUp,
  BarChart3,
  Bell,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Info,
  LineChart,
  MoreHorizontal,
  Pin,
  Search,
  Settings2,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";

type RatioCategory =
  | "valuation"
  | "profitability"
  | "growth"
  | "financial_strength"
  | "liquidity"
  | "efficiency"
  | "cash_flow"
  | "dividends"
  | "per_share"
  | "market"
  | "other";

type ExplorerCategory = RatioCategory | "all" | "key" | "pinned";
type FormatMode = "compact" | "exact";
type SortMode = "default" | "name" | "category" | "value" | "availability";
type StatusTone = "green" | "amber" | "red" | "blue" | "secondary";
type FormatKind = "multiple" | "percent" | "money" | "statementMoney" | "perShare" | "shares" | "days" | "number";
type TrendPoint = { period: string; rank: number; [key: string]: string | number | null };

export interface RatiosFinancialRow {
  ticker: string;
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  reported_date: string | null;
  source_type: string | null;
  source_url: string | null;
  confidence: number | null;
  updated_at: string | null;
  data: Record<string, number | null | string>;
}

export interface RatiosPeerRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  ratios: {
    ratio_name: string;
    ratio_value: number | null;
    source_period: string | null;
    computed_at: string | null;
  }[];
}

export interface RatiosQuoteRow {
  price: number | null;
  as_of: string | null;
  last_fetched_at: string | null;
}

interface RatioDefinition {
  displayName: string;
  category: RatioCategory;
  kind: FormatKind;
  important?: boolean;
  definition: string;
  why: string;
  limitation: string;
}

interface FactorInput {
  ratio: string;
  weight: number;
  direction: "higher" | "lower" | "lowerPositive";
  low: number;
  high: number;
}

interface FactorResult {
  key: string;
  label: string;
  category: RatioCategory;
  score: number | null;
  status: "preliminary" | "unavailable";
  confidence: number;
  summary: string;
  inputs: (FactorInput & { value: number | null; score: number | null })[];
}

const CATEGORY_LABELS: Record<RatioCategory, string> = {
  valuation: "Valuation",
  profitability: "Profitability",
  growth: "Growth",
  financial_strength: "Financial strength",
  liquidity: "Liquidity",
  efficiency: "Efficiency",
  cash_flow: "Cash flow",
  dividends: "Dividends",
  per_share: "Per-share metrics",
  market: "Market data",
  other: "Other",
};

const EXPLORER_CATEGORIES: { value: ExplorerCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "key", label: "Key ratios" },
  { value: "valuation", label: "Valuation" },
  { value: "profitability", label: "Profitability" },
  { value: "growth", label: "Growth" },
  { value: "financial_strength", label: "Financial strength" },
  { value: "liquidity", label: "Liquidity" },
  { value: "efficiency", label: "Efficiency" },
  { value: "cash_flow", label: "Cash flow" },
  { value: "dividends", label: "Dividends" },
  { value: "per_share", label: "Per-share" },
  { value: "pinned", label: "Pinned" },
];

const ANALYSIS_TABS: { value: ExplorerCategory; label: string }[] = [
  { value: "all", label: "Overview" },
  { value: "valuation", label: "Valuation" },
  { value: "profitability", label: "Profitability" },
  { value: "financial_strength", label: "Financial strength" },
  { value: "growth", label: "Growth" },
  { value: "efficiency", label: "Efficiency" },
  { value: "cash_flow", label: "Cash flow" },
  { value: "dividends", label: "Dividends" },
];

const RATIO_DEFINITIONS: Record<string, RatioDefinition> = {
  "P/E": {
    displayName: "P/E",
    category: "valuation",
    kind: "multiple",
    important: true,
    definition: "Market price divided by earnings per share.",
    why: "Shows how much investors are paying for each rupee of reported earnings.",
    limitation: "A low P/E can reflect undervaluation, peak cyclical earnings, slower growth, or higher risk.",
  },
  "Earnings yield": {
    displayName: "Earnings yield",
    category: "valuation",
    kind: "percent",
    important: true,
    definition: "Earnings per share divided by market price.",
    why: "The inverse of P/E, useful for comparing earnings power to market price.",
    limitation: "It uses reported earnings and does not prove that earnings are sustainable.",
  },
  "Shares outstanding (derived)": {
    displayName: "Shares outstanding",
    category: "market",
    kind: "shares",
    definition: "Profit after tax divided by EPS, adjusted from statement units into shares.",
    why: "Provides the share-count bridge used by market-cap and per-share ratios.",
    limitation: "Derived share count can differ from official weighted-average shares if EPS is adjusted.",
  },
  "Market cap (derived)": {
    displayName: "Market cap",
    category: "market",
    kind: "money",
    definition: "Market price multiplied by derived shares outstanding.",
    why: "Connects the company's equity value to sales, earnings, cash flow, and peers.",
    limitation: "Depends on the latest stored market quote and the derived share count.",
  },
  "Book value / share": {
    displayName: "Book value / share",
    category: "per_share",
    kind: "perShare",
    important: true,
    definition: "Equity divided by derived shares outstanding.",
    why: "Shows accounting equity backing per share.",
    limitation: "Book value uses period-end equity and may not capture asset revaluations or impairments promptly.",
  },
  "Sales / share": {
    displayName: "Sales / share",
    category: "per_share",
    kind: "perShare",
    definition: "Revenue divided by derived shares outstanding.",
    why: "Connects reported revenue to the share base.",
    limitation: "Revenue per share does not measure profit quality.",
  },
  "Cash / share": {
    displayName: "Cash / share",
    category: "per_share",
    kind: "perShare",
    definition: "Cash and equivalents divided by derived shares outstanding.",
    why: "Shows the cash balance attributable to each share.",
    limitation: "Cash may be restricted, operationally required, or offset by borrowings.",
  },
  "P/B": {
    displayName: "P/B",
    category: "valuation",
    kind: "multiple",
    important: true,
    definition: "Market price divided by book value per share.",
    why: "Frames market value relative to accounting equity.",
    limitation: "Cross-company comparability depends on asset intensity and accounting policies.",
  },
  "P/S": {
    displayName: "P/S",
    category: "valuation",
    kind: "multiple",
    definition: "Market capitalization divided by revenue.",
    why: "Useful when earnings are temporarily depressed or volatile.",
    limitation: "Sales multiples do not account for margins, leverage, or capital intensity.",
  },
  "Price / FCF": {
    displayName: "Price / FCF",
    category: "valuation",
    kind: "multiple",
    important: true,
    definition: "Market capitalization divided by free cash flow.",
    why: "Shows how much the market pays for free cash flow generation.",
    limitation: "Free cash flow can be temporarily boosted or depressed by working capital and capex timing.",
  },
  "FCF yield": {
    displayName: "FCF yield",
    category: "valuation",
    kind: "percent",
    important: true,
    definition: "Free cash flow divided by market capitalization.",
    why: "Highlights cash-flow return relative to the current equity value.",
    limitation: "A high FCF yield may not be sustainable if capex or working capital is unusually favorable.",
  },
  "EV/Sales": {
    displayName: "EV/Sales",
    category: "valuation",
    kind: "multiple",
    definition: "Enterprise value divided by revenue.",
    why: "Compares operating value to sales before capital structure effects.",
    limitation: "Needs peer context because normal levels vary strongly by industry and margin profile.",
  },
  "EV/EBIT": {
    displayName: "EV/EBIT",
    category: "valuation",
    kind: "multiple",
    definition: "Enterprise value divided by operating profit.",
    why: "Compares enterprise value to operating earnings before financing costs.",
    limitation: "Operating profit and balance-sheet values may come from different reporting periods.",
  },
  "Dividend yield (TTM)": {
    displayName: "Dividend yield",
    category: "dividends",
    kind: "percent",
    important: true,
    definition: "Trailing 12-month cash dividends per share divided by market price.",
    why: "Shows recent cash payout relative to the current share price.",
    limitation: "Trailing payout does not guarantee future dividends.",
  },
  "Payout ratio": {
    displayName: "Payout ratio",
    category: "dividends",
    kind: "percent",
    definition: "Trailing cash DPS divided by EPS.",
    why: "Shows how much of earnings were distributed as cash dividends.",
    limitation: "Can be distorted when EPS is unusually high, low, or negative.",
  },
  "Dividend cover": {
    displayName: "Dividend cover",
    category: "dividends",
    kind: "multiple",
    definition: "EPS divided by trailing cash DPS.",
    why: "Shows how many times earnings covered the recent cash dividend.",
    limitation: "High cover indicates capacity, not a guaranteed future payout.",
  },
  "Gross margin": {
    displayName: "Gross margin",
    category: "profitability",
    kind: "percent",
    important: true,
    definition: "Gross profit divided by revenue.",
    why: "Shows product-level profitability before operating expenses and financing costs.",
    limitation: "Mix, pricing, inventory, and cost recognition can affect comparability.",
  },
  "Operating margin": {
    displayName: "Operating margin",
    category: "profitability",
    kind: "percent",
    important: true,
    definition: "Operating profit divided by revenue.",
    why: "Shows profit from operations before financing and tax.",
    limitation: "The operating-profit input may come from extracted filings rather than the PSX summary page.",
  },
  "Net margin": {
    displayName: "Net margin",
    category: "profitability",
    kind: "percent",
    important: true,
    definition: "Profit after tax divided by revenue.",
    why: "Shows how much reported sales converted into profit after tax.",
    limitation: "Financing, tax, and one-off items can move net margin without changing core operations.",
  },
  "Cost of sales ratio": {
    displayName: "Cost of sales ratio",
    category: "efficiency",
    kind: "percent",
    definition: "Cost of sales divided by revenue.",
    why: "Shows how much revenue is consumed by direct production or service costs.",
    limitation: "Needs product-mix context before judging direction.",
  },
  "Operating expense ratio": {
    displayName: "Operating expense ratio",
    category: "efficiency",
    kind: "percent",
    definition: "Operating expenses divided by revenue.",
    why: "Shows overhead and operating expense intensity.",
    limitation: "Classification can vary between companies and reports.",
  },
  "Effective tax rate": {
    displayName: "Effective tax rate",
    category: "profitability",
    kind: "percent",
    definition: "Tax expense divided by profit before tax.",
    why: "Shows reported tax burden for the period.",
    limitation: "Not meaningful when profit before tax is very low or negative.",
  },
  ROE: {
    displayName: "ROE",
    category: "profitability",
    kind: "percent",
    important: true,
    definition: "Profit after tax divided by equity.",
    why: "Shows reported profit relative to shareholder equity.",
    limitation: "Current engine uses period-end equity where average balance data is unavailable.",
  },
  ROA: {
    displayName: "ROA",
    category: "profitability",
    kind: "percent",
    definition: "Profit after tax divided by total assets.",
    why: "Shows profit generated from the asset base.",
    limitation: "Current engine uses period-end assets where average balance data is unavailable.",
  },
  ROIC: {
    displayName: "ROIC",
    category: "profitability",
    kind: "percent",
    important: true,
    definition: "NOPAT divided by equity plus borrowings less cash.",
    why: "Shows return on capital employed in the operating business.",
    limitation: "Requires compatible operating profit, tax, debt, cash, and equity data.",
  },
  "Asset turnover": {
    displayName: "Asset turnover",
    category: "efficiency",
    kind: "multiple",
    definition: "Revenue divided by total assets.",
    why: "Shows how efficiently assets produce sales.",
    limitation: "Current engine uses period-end assets where average balance data is unavailable.",
  },
  "Equity multiplier": {
    displayName: "Equity multiplier",
    category: "financial_strength",
    kind: "multiple",
    definition: "Total assets divided by equity.",
    why: "Shows balance-sheet leverage used in DuPont-style ROE analysis.",
    limitation: "Higher leverage can lift ROE while also increasing risk.",
  },
  "Debt-to-equity": {
    displayName: "Debt / equity",
    category: "financial_strength",
    kind: "multiple",
    important: true,
    definition: "Borrowings divided by equity.",
    why: "Shows balance-sheet leverage from interest-bearing debt.",
    limitation: "Low debt is not automatically optimal and depends on sector capital needs.",
  },
  "Net debt": {
    displayName: "Net debt",
    category: "financial_strength",
    kind: "statementMoney",
    important: true,
    definition: "Borrowings minus cash and equivalents.",
    why: "Shows whether debt exceeds cash or the company is in a net cash position.",
    limitation: "Cash availability and debt maturity are not visible in this single number.",
  },
  "Net debt-to-equity": {
    displayName: "Net debt / equity",
    category: "financial_strength",
    kind: "multiple",
    definition: "Borrowings less cash, divided by equity.",
    why: "Shows leverage after offsetting cash.",
    limitation: "A negative value means net cash and should not be read as a bad leverage number.",
  },
  "Debt / assets": {
    displayName: "Debt / assets",
    category: "financial_strength",
    kind: "multiple",
    definition: "Borrowings divided by total assets.",
    why: "Shows debt funding as a share of the asset base.",
    limitation: "Asset quality and debt maturity still matter.",
  },
  "Liabilities / assets": {
    displayName: "Liabilities / assets",
    category: "financial_strength",
    kind: "multiple",
    definition: "Total liabilities divided by total assets.",
    why: "Shows total liability intensity, not just borrowings.",
    limitation: "Includes operating liabilities as well as financial liabilities.",
  },
  "Current ratio": {
    displayName: "Current ratio",
    category: "liquidity",
    kind: "multiple",
    important: true,
    definition: "Current assets divided by current liabilities.",
    why: "Shows short-term asset coverage of short-term obligations.",
    limitation: "A ratio near 1 does not automatically imply distress; working-capital cycle matters.",
  },
  "Quick ratio": {
    displayName: "Quick ratio",
    category: "liquidity",
    kind: "multiple",
    definition: "Current assets less inventory, divided by current liabilities.",
    why: "Shows liquid coverage without relying on inventory conversion.",
    limitation: "Receivable quality and payment timing still matter.",
  },
  "Cash ratio": {
    displayName: "Cash ratio",
    category: "liquidity",
    kind: "multiple",
    definition: "Cash and equivalents divided by current liabilities.",
    why: "Shows immediate cash coverage of current liabilities.",
    limitation: "A low cash ratio is not automatically negative for businesses with predictable cash collection.",
  },
  "Receivables / revenue": {
    displayName: "Receivables / revenue",
    category: "efficiency",
    kind: "multiple",
    definition: "Receivables divided by revenue.",
    why: "Shows how much revenue is tied up in receivables.",
    limitation: "Needs customer, credit-term, and period-length context.",
  },
  "Receivables / share": {
    displayName: "Receivables / share",
    category: "per_share",
    kind: "perShare",
    definition: "Receivables divided by derived shares outstanding.",
    why: "Frames receivables on a per-share basis.",
    limitation: "Per-share receivables do not indicate collectability.",
  },
  "Receivables % of market cap": {
    displayName: "Receivables / market value",
    category: "efficiency",
    kind: "percent",
    definition: "Receivables divided by market capitalization.",
    why: "Shows receivable exposure relative to the equity value.",
    limitation: "Market value moves daily while receivables update only with financial statements.",
  },
  "Days sales outstanding": {
    displayName: "Days sales outstanding",
    category: "efficiency",
    kind: "days",
    definition: "Receivables divided by revenue, multiplied by 365.",
    why: "Approximates the days of sales tied up in receivables.",
    limitation: "Annualization can be misleading when interim revenue periods are used.",
  },
  "Retained earnings / assets": {
    displayName: "Retained earnings / assets",
    category: "financial_strength",
    kind: "multiple",
    definition: "Retained earnings divided by total assets.",
    why: "Shows accumulated profitability relative to assets.",
    limitation: "Accounting history and dividend policy influence this metric.",
  },
  "Interest coverage": {
    displayName: "Interest coverage",
    category: "financial_strength",
    kind: "multiple",
    important: true,
    definition: "Profit before tax plus finance cost, divided by finance cost.",
    why: "Shows operating-plus-pre-tax earnings coverage of finance cost.",
    limitation: "Coverage can weaken quickly if margins fall or rates rise.",
  },
  "Revenue growth": {
    displayName: "Revenue growth",
    category: "growth",
    kind: "percent",
    important: true,
    definition: "Revenue change versus the prior comparable period.",
    why: "Shows whether the top line is expanding or contracting.",
    limitation: "One period of growth does not establish a durable trend.",
  },
  "Profit growth": {
    displayName: "Profit growth",
    category: "growth",
    kind: "percent",
    important: true,
    definition: "Profit after tax change versus the prior comparable period.",
    why: "Shows whether earnings grew faster or slower than sales.",
    limitation: "Low bases and one-off items can exaggerate growth.",
  },
  "EPS growth": {
    displayName: "EPS growth",
    category: "growth",
    kind: "percent",
    important: true,
    definition: "EPS change versus the prior comparable period.",
    why: "Shows growth attributable to each share.",
    limitation: "EPS can be affected by share count and accounting adjustments.",
  },
  "Revenue CAGR": {
    displayName: "Revenue CAGR",
    category: "growth",
    kind: "percent",
    definition: "Compound annual revenue growth over the available multi-year gap.",
    why: "Summarizes multi-year revenue compounding.",
    limitation: "CAGR can hide recent acceleration or weakness.",
  },
  "EPS CAGR": {
    displayName: "EPS CAGR",
    category: "growth",
    kind: "percent",
    definition: "Compound annual EPS growth over the available multi-year gap.",
    why: "Summarizes multi-year per-share earnings compounding.",
    limitation: "CAGR can be distorted by the starting year.",
  },
  "Gross margin change": {
    displayName: "Gross margin change",
    category: "growth",
    kind: "percent",
    definition: "Current gross margin minus prior comparable gross margin.",
    why: "Shows whether product-level profitability expanded or contracted.",
    limitation: "Mix and cost timing can move one period's margin.",
  },
  "Net margin change": {
    displayName: "Net margin change",
    category: "growth",
    kind: "percent",
    definition: "Current net margin minus prior comparable net margin.",
    why: "Shows whether reported profit capture improved or deteriorated.",
    limitation: "Financing, tax, and one-offs can drive the change.",
  },
  "FCF (OCF − Capex)": {
    displayName: "Free cash flow",
    category: "cash_flow",
    kind: "statementMoney",
    important: true,
    definition: "Operating cash flow minus capital expenditure.",
    why: "Shows cash left after reinvestment in fixed assets.",
    limitation: "Capex timing and working capital can make one period unusually strong or weak.",
  },
  "FCF margin": {
    displayName: "FCF margin",
    category: "cash_flow",
    kind: "percent",
    important: true,
    definition: "Free cash flow divided by revenue.",
    why: "Shows how much revenue converted into free cash flow.",
    limitation: "A single strong period does not prove durable cash conversion.",
  },
  "OCF / PAT": {
    displayName: "Operating cash flow / profit",
    category: "cash_flow",
    kind: "multiple",
    important: true,
    definition: "Operating cash flow divided by profit after tax.",
    why: "Checks whether reported profit is supported by operating cash flow.",
    limitation: "Working-capital movements can swing this metric period to period.",
  },
  "Cash conversion": {
    displayName: "Operating cash flow / operating profit",
    category: "cash_flow",
    kind: "multiple",
    definition: "Operating cash flow divided by operating profit.",
    why: "Compares cash generation to operating profit.",
    limitation: "Requires compatible operating profit and cash-flow periods.",
  },
  "Accrual ratio": {
    displayName: "Accrual ratio",
    category: "cash_flow",
    kind: "multiple",
    definition: "Profit after tax less operating cash flow, divided by total assets.",
    why: "Highlights how much earnings are not backed by operating cash flow.",
    limitation: "Interpretation depends on business model and working-capital cycle.",
  },
};

const KEY_RATIO_GROUPS = [
  { label: "Valuation", ratios: ["P/E", "P/B", "Earnings yield", "FCF yield"] },
  { label: "Profitability", ratios: ["Gross margin", "Net margin", "ROE", "ROIC"] },
  { label: "Financial strength", ratios: ["Net debt", "Debt-to-equity", "Interest coverage", "Current ratio"] },
  { label: "Growth and cash quality", ratios: ["Revenue growth", "EPS growth", "OCF / PAT", "FCF margin"] },
];

const FACTORS: {
  key: string;
  label: string;
  category: RatioCategory;
  inputs: FactorInput[];
}[] = [
  {
    key: "value",
    label: "Value",
    category: "valuation",
    inputs: [
      { ratio: "Earnings yield", weight: 22, direction: "higher", low: 0, high: 18 },
      { ratio: "FCF yield", weight: 22, direction: "higher", low: 0, high: 15 },
      { ratio: "P/E", weight: 20, direction: "lowerPositive", low: 6, high: 30 },
      { ratio: "P/B", weight: 14, direction: "lowerPositive", low: 0.6, high: 3 },
      { ratio: "P/S", weight: 10, direction: "lowerPositive", low: 0.5, high: 5 },
      { ratio: "EV/EBIT", weight: 12, direction: "lowerPositive", low: 4, high: 25 },
    ],
  },
  {
    key: "quality",
    label: "Quality",
    category: "profitability",
    inputs: [
      { ratio: "Gross margin", weight: 14, direction: "higher", low: 0, high: 40 },
      { ratio: "Net margin", weight: 16, direction: "higher", low: 0, high: 25 },
      { ratio: "ROE", weight: 18, direction: "higher", low: 0, high: 30 },
      { ratio: "ROIC", weight: 18, direction: "higher", low: 0, high: 25 },
      { ratio: "OCF / PAT", weight: 18, direction: "higher", low: 0, high: 1.5 },
      { ratio: "Accrual ratio", weight: 16, direction: "lower", low: -0.1, high: 0.2 },
    ],
  },
  {
    key: "growth",
    label: "Growth",
    category: "growth",
    inputs: [
      { ratio: "Revenue growth", weight: 18, direction: "higher", low: -10, high: 25 },
      { ratio: "Profit growth", weight: 18, direction: "higher", low: -10, high: 30 },
      { ratio: "EPS growth", weight: 18, direction: "higher", low: -10, high: 30 },
      { ratio: "Revenue CAGR", weight: 16, direction: "higher", low: 0, high: 20 },
      { ratio: "EPS CAGR", weight: 16, direction: "higher", low: 0, high: 20 },
      { ratio: "Gross margin change", weight: 14, direction: "higher", low: -5, high: 5 },
    ],
  },
  {
    key: "strength",
    label: "Financial strength",
    category: "financial_strength",
    inputs: [
      { ratio: "Debt-to-equity", weight: 18, direction: "lower", low: 0, high: 2 },
      { ratio: "Net debt-to-equity", weight: 18, direction: "lower", low: -0.5, high: 1.5 },
      { ratio: "Liabilities / assets", weight: 14, direction: "lower", low: 0.2, high: 0.8 },
      { ratio: "Interest coverage", weight: 20, direction: "higher", low: 0, high: 8 },
      { ratio: "Current ratio", weight: 16, direction: "higher", low: 0.6, high: 2 },
      { ratio: "Quick ratio", weight: 14, direction: "higher", low: 0.5, high: 1.5 },
    ],
  },
  {
    key: "cash",
    label: "Cash flow",
    category: "cash_flow",
    inputs: [
      { ratio: "FCF margin", weight: 22, direction: "higher", low: -5, high: 20 },
      { ratio: "FCF yield", weight: 18, direction: "higher", low: 0, high: 15 },
      { ratio: "OCF / PAT", weight: 22, direction: "higher", low: 0, high: 1.5 },
      { ratio: "Cash conversion", weight: 20, direction: "higher", low: 0, high: 1.5 },
      { ratio: "Accrual ratio", weight: 18, direction: "lower", low: -0.1, high: 0.2 },
    ],
  },
];

const PRESET_VIEWS = [
  { label: "Value investor", ratios: ["P/E", "P/B", "EV/EBIT", "FCF yield", "Earnings yield"] },
  { label: "Dividend quality", ratios: ["Dividend yield (TTM)", "Payout ratio", "Dividend cover", "OCF / PAT", "FCF margin"] },
  { label: "Financial strength", ratios: ["Net debt", "Debt-to-equity", "Net debt-to-equity", "Interest coverage", "Current ratio", "Quick ratio"] },
  { label: "Growth", ratios: ["Revenue growth", "Profit growth", "EPS growth", "Revenue CAGR", "EPS CAGR"] },
  { label: "Cash-flow quality", ratios: ["FCF (OCF − Capex)", "FCF margin", "OCF / PAT", "Cash conversion", "Accrual ratio"] },
];

const PEER_METRICS = ["P/E", "P/B", "EV/EBIT", "FCF yield", "ROE", "ROIC", "Gross margin", "Net margin", "Debt-to-equity", "Interest coverage"];

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function defFor(name: string): RatioDefinition {
  return (
    RATIO_DEFINITIONS[name] ?? {
      displayName: name,
      category: "other",
      kind: /yield|margin|growth|ROE|ROA|ROIC|Payout|tax rate|CAGR|change|% of/i.test(name) ? "percent" : "number",
      definition: "Derived ratio from the central ratio engine.",
      why: "Used as part of the company's financial profile.",
      limitation: "No additional methodology note is available for this metric yet.",
    }
  );
}

function ratioDisplayName(rowOrName: RatioRow | string): string {
  const name = typeof rowOrName === "string" ? rowOrName : rowOrName.ratio_name;
  const value = typeof rowOrName === "string" ? null : rowOrName.ratio_value;
  if (name === "Net debt" && value !== null && value < 0) return "Net cash";
  if (name === "Net debt-to-equity" && value !== null && value < 0) return "Net cash / equity";
  return defFor(name).displayName;
}

function isImportant(row: RatioRow): boolean {
  return Boolean(defFor(row.ratio_name).important);
}

function isMixedPeriod(period: string | null | undefined): boolean {
  return Boolean(period && (period.includes("/") || /\bvs\b/i.test(period)));
}

function formattedPeriod(period: string | null | undefined): string {
  return formatFinancialPeriod(period) ?? period ?? "-";
}

function compactCurrency(value: number, digits = 1): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}PKR ${(abs / 1_000_000_000).toFixed(digits)}B`;
  if (abs >= 1_000_000) return `${sign}PKR ${(abs / 1_000_000).toFixed(digits)}M`;
  if (abs >= 1_000) return `${sign}PKR ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}PKR ${abs.toFixed(0)}`;
}

function exactCurrency(value: number): string {
  return `PKR ${value.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function formatRatioValue(row: RatioRow | { ratio_name: string; ratio_value: number | null }, mode: FormatMode = "compact"): string {
  const value = finiteNumber(row.ratio_value);
  if (value === null) return "-";
  const kind = defFor(row.ratio_name).kind;
  const digits = mode === "exact" ? 4 : 2;
  if (kind === "percent") return `${value.toFixed(mode === "exact" ? 3 : 1)}%`;
  if (kind === "multiple") return `${value.toFixed(mode === "exact" ? 3 : 2)}x`;
  if (kind === "days") return `${value.toFixed(0)} days`;
  if (kind === "perShare") return `PKR ${value.toLocaleString("en-PK", { maximumFractionDigits: mode === "exact" ? 4 : 2 })}`;
  if (kind === "shares") return mode === "exact" ? `${formatNumber(value, 0)} shares` : fmtCompact(value);
  if (kind === "money") return mode === "exact" ? exactCurrency(value) : compactCurrency(value);
  if (kind === "statementMoney") {
    const rupees = value * 1000;
    if (row.ratio_name === "Net debt" && rupees < 0) {
      return mode === "exact" ? exactCurrency(Math.abs(rupees)) : compactCurrency(Math.abs(rupees));
    }
    return mode === "exact" ? exactCurrency(rupees) : compactCurrency(rupees);
  }
  return value.toLocaleString("en-PK", { maximumFractionDigits: digits });
}

function formatChartValue(value: number, metric: string): string {
  return formatRatioValue({ ratio_name: metric, ratio_value: value }, "compact");
}

function rowRank(row: RatiosFinancialRow): number {
  const p = (row.fiscal_period ?? "").toUpperCase();
  const order: Record<string, number> = { Q1: 1, H1: 2, Q2: 2, "9M": 3, Q3: 3, FY: 4, Q4: 4 };
  return (row.fiscal_year ?? 0) * 10 + (order[p] ?? (row.period_type === "annual" ? 4 : 0));
}

function rowPeriod(row: RatiosFinancialRow): string {
  const fy = row.fiscal_year ? `FY${row.fiscal_year}` : "FY?";
  const p = (row.fiscal_period ?? "").toUpperCase();
  if (row.period_type === "annual" || p === "FY") return fy;
  return `${p || "Period"} ${fy}`;
}

function periodKey(row: RatiosFinancialRow): string {
  return `${row.period_type}|${row.fiscal_year ?? "?"}|${(row.fiscal_period ?? "").toUpperCase() || row.period_type}`;
}

function rowGroupKey(row: RatiosFinancialRow): string {
  const p = (row.fiscal_period ?? "").toUpperCase();
  if (row.period_type === "annual" || p === "FY") return "annual|FY";
  return `${row.period_type}|${p || "period"}`;
}

function raw(row: RatiosFinancialRow | null | undefined, key: string): number | null {
  if (!row) return null;
  return finiteNumber(row.data?.[key]);
}

function safeDiv(num: number | null, den: number | null): number | null {
  return num !== null && den !== null && den !== 0 ? num / den : null;
}

function pct(num: number | null, den: number | null): number | null {
  const v = safeDiv(num, den);
  return v === null ? null : v * 100;
}

function statementRows(rows: RatiosFinancialRow[], statement: string): RatiosFinancialRow[] {
  return rows.filter((r) => r.statement_type === statement).sort((a, b) => rowRank(a) - rowRank(b));
}

function comparableRows(rows: RatiosFinancialRow[], statement: string): RatiosFinancialRow[] {
  const typed = statementRows(rows, statement);
  if (!typed.length) return [];
  const groups = new Map<string, RatiosFinancialRow[]>();
  for (const row of typed) {
    const key = rowGroupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const annual = groups.get("annual|FY");
  const selected =
    annual && annual.length >= 2
      ? annual
      : [...groups.values()].sort((a, b) => b.length - a.length || rowRank(b[b.length - 1]) - rowRank(a[a.length - 1]))[0] ?? [];
  return selected.sort((a, b) => rowRank(a) - rowRank(b)).slice(-8);
}

function latestByPeriod(rows: RatiosFinancialRow[], statement: string): Map<string, RatiosFinancialRow> {
  const out = new Map<string, RatiosFinancialRow>();
  for (const row of statementRows(rows, statement)) out.set(periodKey(row), row);
  return out;
}

function joinedComparableRows(rows: RatiosFinancialRow[]): { period: string; rank: number; income?: RatiosFinancialRow; balance?: RatiosFinancialRow; cash?: RatiosFinancialRow }[] {
  const income = latestByPeriod(rows, "income_statement");
  const balance = latestByPeriod(rows, "balance_sheet");
  const cash = latestByPeriod(rows, "cash_flow");
  const keys = new Set([...income.keys(), ...balance.keys(), ...cash.keys()]);
  return [...keys]
    .map((key) => {
      const source = income.get(key) ?? balance.get(key) ?? cash.get(key);
      return {
        period: source ? rowPeriod(source) : key,
        rank: source ? rowRank(source) : 0,
        income: income.get(key),
        balance: balance.get(key),
        cash: cash.get(key),
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(-8);
}

function trendValuesFor(ratioName: string, financialRows: RatiosFinancialRow[]): { period: string; rank: number; value: number }[] {
  const incomeRows = comparableRows(financialRows, "income_statement");
  const balanceRows = comparableRows(financialRows, "balance_sheet");
  const cashRows = comparableRows(financialRows, "cash_flow");
  const joined = joinedComparableRows(financialRows);

  const simpleIncome = (fn: (row: RatiosFinancialRow) => number | null) =>
    incomeRows.map((row) => ({ period: rowPeriod(row), rank: rowRank(row), value: fn(row) })).filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
  const simpleBalance = (fn: (row: RatiosFinancialRow) => number | null) =>
    balanceRows.map((row) => ({ period: rowPeriod(row), rank: rowRank(row), value: fn(row) })).filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
  const simpleCash = (fn: (row: RatiosFinancialRow) => number | null) =>
    cashRows.map((row) => ({ period: rowPeriod(row), rank: rowRank(row), value: fn(row) })).filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
  const growth = (key: string) => {
    const points = incomeRows
      .map((row) => ({ period: rowPeriod(row), rank: rowRank(row), raw: raw(row, key) }))
      .filter((p): p is { period: string; rank: number; raw: number } => p.raw !== null);
    return points
      .map((point, index) => {
        const prior = points[index - 1]?.raw ?? null;
        return { period: point.period, rank: point.rank, value: prior ? ((point.raw - prior) / Math.abs(prior)) * 100 : null };
      })
      .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
  };

  switch (ratioName) {
    case "Gross margin":
      return simpleIncome((r) => pct(raw(r, "gross_profit"), raw(r, "revenue")));
    case "Operating margin":
      return simpleIncome((r) => pct(raw(r, "operating_profit"), raw(r, "revenue")));
    case "Net margin":
      return simpleIncome((r) => pct(raw(r, "profit_after_tax"), raw(r, "revenue")));
    case "Cost of sales ratio":
      return simpleIncome((r) => pct(raw(r, "cost_of_sales"), raw(r, "revenue")));
    case "Operating expense ratio":
      return simpleIncome((r) => pct(raw(r, "operating_expenses"), raw(r, "revenue")));
    case "Revenue growth":
      return growth("revenue");
    case "Profit growth":
      return growth("profit_after_tax");
    case "EPS growth":
      return growth("eps");
    case "Debt-to-equity":
      return simpleBalance((r) => safeDiv(raw(r, "borrowings"), raw(r, "equity")));
    case "Net debt":
      return simpleBalance((r) => {
        const borrowings = raw(r, "borrowings");
        const cash = raw(r, "cash_and_equivalents");
        return borrowings !== null && cash !== null ? borrowings - cash : null;
      });
    case "Net debt-to-equity":
      return simpleBalance((r) => {
        const borrowings = raw(r, "borrowings");
        const cash = raw(r, "cash_and_equivalents");
        const equity = raw(r, "equity");
        return borrowings !== null && cash !== null ? safeDiv(borrowings - cash, equity) : null;
      });
    case "Debt / assets":
      return simpleBalance((r) => safeDiv(raw(r, "borrowings"), raw(r, "total_assets")));
    case "Liabilities / assets":
      return simpleBalance((r) => safeDiv(raw(r, "total_liabilities"), raw(r, "total_assets")));
    case "Current ratio":
      return simpleBalance((r) => safeDiv(raw(r, "current_assets"), raw(r, "current_liabilities")));
    case "Quick ratio":
      return simpleBalance((r) => {
        const currentAssets = raw(r, "current_assets");
        const inventory = raw(r, "inventory");
        const currentLiabilities = raw(r, "current_liabilities");
        return currentAssets !== null && inventory !== null ? safeDiv(currentAssets - inventory, currentLiabilities) : null;
      });
    case "Cash ratio":
      return simpleBalance((r) => safeDiv(raw(r, "cash_and_equivalents"), raw(r, "current_liabilities")));
    case "Receivables / revenue":
      return joined
        .map((p) => ({ period: p.period, rank: p.rank, value: safeDiv(raw(p.balance, "receivables"), raw(p.income, "revenue")) }))
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "Days sales outstanding":
      return joined
        .map((p) => {
          const value = safeDiv(raw(p.balance, "receivables"), raw(p.income, "revenue"));
          return { period: p.period, rank: p.rank, value: value === null ? null : value * 365 };
        })
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "ROE":
      return joined
        .map((p) => ({ period: p.period, rank: p.rank, value: pct(raw(p.income, "profit_after_tax"), raw(p.balance, "equity")) }))
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "ROA":
      return joined
        .map((p) => ({ period: p.period, rank: p.rank, value: pct(raw(p.income, "profit_after_tax"), raw(p.balance, "total_assets")) }))
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "Asset turnover":
      return joined
        .map((p) => ({ period: p.period, rank: p.rank, value: safeDiv(raw(p.income, "revenue"), raw(p.balance, "total_assets")) }))
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "Equity multiplier":
      return simpleBalance((r) => safeDiv(raw(r, "total_assets"), raw(r, "equity")));
    case "FCF (OCF − Capex)":
      return simpleCash((r) => {
        const ocf = raw(r, "operating_cash_flow");
        const capex = raw(r, "capex");
        return ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;
      });
    case "FCF margin":
      return joined
        .map((p) => {
          const ocf = raw(p.cash, "operating_cash_flow");
          const capex = raw(p.cash, "capex");
          const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;
          return { period: p.period, rank: p.rank, value: pct(fcf, raw(p.income, "revenue")) };
        })
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "OCF / PAT":
      return joined
        .map((p) => ({ period: p.period, rank: p.rank, value: safeDiv(raw(p.cash, "operating_cash_flow"), raw(p.income, "profit_after_tax")) }))
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "Cash conversion":
      return joined
        .map((p) => ({ period: p.period, rank: p.rank, value: safeDiv(raw(p.cash, "operating_cash_flow"), raw(p.income, "operating_profit")) }))
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    case "Accrual ratio":
      return joined
        .map((p) => {
          const pat = raw(p.income, "profit_after_tax");
          const ocf = raw(p.cash, "operating_cash_flow");
          return { period: p.period, rank: p.rank, value: pat !== null && ocf !== null ? safeDiv(pat - ocf, raw(p.balance, "total_assets")) : null };
        })
        .filter((p): p is { period: string; rank: number; value: number } => p.value !== null);
    default:
      return [];
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentileRank(values: number[], current: number): number | null {
  if (values.length < 4) return null;
  const belowOrEqual = values.filter((v) => v <= current).length;
  return Math.round((belowOrEqual / values.length) * 100);
}

function historicalContext(row: RatioRow, financialRows: RatiosFinancialRow[]): { label: string; detail: string; values: { period: string; value: number }[] } {
  const history = trendValuesFor(row.ratio_name, financialRows);
  if (history.length < 2) return { label: "No verified history", detail: "Historical series unavailable", values: [] };
  const values = history.map((p) => p.value);
  const med = median(values);
  const current = history[history.length - 1]?.value ?? row.ratio_value;
  if (history.length >= 4 && med !== null && current !== null) {
    const pctile = percentileRank(values, current);
    const direction = current >= med ? "above" : "below";
    return {
      label: `${direction} historical median`,
      detail: pctile !== null ? `${pctile}th percentile across ${history.length} comparable periods` : `${history.length} comparable periods`,
      values: history.map((p) => ({ period: p.period, value: p.value })),
    };
  }
  return {
    label: "Partial trend",
    detail: `${history.length} comparable periods; percentile hidden`,
    values: history.map((p) => ({ period: p.period, value: p.value })),
  };
}

function priorChange(row: RatioRow, financialRows: RatiosFinancialRow[]): { label: string; tone: "positive" | "negative" | "neutral" } | null {
  const history = trendValuesFor(row.ratio_name, financialRows);
  if (history.length < 2) return null;
  const latest = history[history.length - 1]?.value;
  const prior = history[history.length - 2]?.value;
  if (latest === undefined || prior === undefined) return null;
  const delta = latest - prior;
  const def = defFor(row.ratio_name);
  const suffix = def.kind === "percent" ? " pp" : "";
  return {
    label: `${delta >= 0 ? "+" : ""}${delta.toFixed(def.kind === "percent" ? 1 : 2)}${suffix}`,
    tone: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function scoreInput(value: number | null, input: FactorInput): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (input.direction === "lowerPositive" && value <= 0) return null;
  if (input.direction === "higher") return clamp(((value - input.low) / (input.high - input.low)) * 100);
  return clamp(((input.high - value) / (input.high - input.low)) * 100);
}

function buildFactors(ratios: RatioRow[]): FactorResult[] {
  const byName = new Map(ratios.map((r) => [r.ratio_name, r.ratio_value]));
  return FACTORS.map((factor) => {
    const inputs = factor.inputs.map((input) => {
      const value = finiteNumber(byName.get(input.ratio));
      return { ...input, value, score: scoreInput(value, input) };
    });
    const available = inputs.filter((input) => input.score !== null);
    const required = Math.max(2, Math.ceil(inputs.length * 0.4));
    const confidence = Math.round((available.length / inputs.length) * 100);
    if (available.length < required) {
      return {
        key: factor.key,
        label: factor.label,
        category: factor.category,
        score: null,
        status: "unavailable" as const,
        confidence,
        summary: "Insufficient comparison data",
        inputs,
      };
    }
    const weighted = available.reduce((sum, input) => sum + (input.score ?? 0) * input.weight, 0);
    const weights = available.reduce((sum, input) => sum + input.weight, 0);
    return {
      key: factor.key,
      label: factor.label,
      category: factor.category,
      score: Math.round(weighted / weights),
      status: "preliminary" as const,
      confidence,
      summary: `Based on ${available.length} of ${inputs.length} documented inputs`,
      inputs,
    };
  });
}

function statusVariant(status: "Complete" | "Partial" | "Unavailable" | "Present" | "Documented"): StatusTone {
  if (status === "Complete" || status === "Documented") return "green";
  if (status === "Partial" || status === "Present") return "amber";
  if (status === "Unavailable") return "red";
  return "secondary";
}

function dataStatusItems(ratios: RatioRow[], financialRows: RatiosFinancialRow[], peers: RatiosPeerRow[]) {
  const available = ratios.filter((r) => r.ratio_value !== null).length;
  const sourcedFinancials = financialRows.filter((r) => r.source_url || r.source_type).length;
  const statements = new Set(financialRows.map((r) => r.statement_type));
  const maxHistory = Math.max(
    comparableRows(financialRows, "income_statement").length,
    comparableRows(financialRows, "balance_sheet").length,
    comparableRows(financialRows, "cash_flow").length
  );
  const peerCount = peers.filter((p) => p.ratios.some((r) => r.ratio_value !== null)).length;
  const formulaComplete = ratios.every((r) => r.formula && r.inputs);
  const mixedCount = ratios.filter((r) => isMixedPeriod(r.source_period)).length;

  return [
    {
      label: "Reported values",
      status: statements.has("income_statement") && statements.has("balance_sheet") && statements.has("cash_flow") ? "Complete" : sourcedFinancials ? "Partial" : "Unavailable",
      detail: sourcedFinancials ? `${sourcedFinancials} sourced statement rows` : "No sourced financial rows",
    },
    {
      label: "Derived ratios",
      status: available === ratios.length ? "Complete" : available > 0 ? "Partial" : "Unavailable",
      detail: `${available} of ${ratios.length} computable`,
    },
    {
      label: "Historical context",
      status: maxHistory >= 4 ? "Complete" : maxHistory >= 2 ? "Partial" : "Unavailable",
      detail: maxHistory >= 2 ? `${maxHistory} comparable periods in the strongest series` : "Not enough comparable periods",
    },
    {
      label: "Peer comparison",
      status: peerCount >= 3 ? "Complete" : peerCount > 0 ? "Partial" : "Unavailable",
      detail: peerCount ? `${peerCount} same-sector peers with stored ratios` : "No stored peer ratio rows",
    },
    {
      label: "Formula verification",
      status: formulaComplete ? "Documented" : "Partial",
      detail: formulaComplete ? "Every ratio has formula and inputs" : "Some formulas or inputs are missing",
    },
    {
      label: "Mixed-period calculations",
      status: mixedCount > 0 ? "Present" : "Complete",
      detail: mixedCount ? `${mixedCount} ratios combine periods or comparisons` : "No mixed-period labels detected",
    },
  ] as const;
}

function latestPeriodForCategory(ratios: RatioRow[], names: string[]): string {
  const period = names.map((name) => ratios.find((r) => r.ratio_name === name)?.source_period).find(Boolean);
  return formattedPeriod(period);
}

function sourceUrl(ratios: RatioRow[], metadata: CompanyMetadata): string | null {
  return ratios.find((r) => r.source)?.source ?? metadata.meta.sourceUrl ?? null;
}

function sourceLabel(metadata: CompanyMetadata): string {
  if (metadata.meta.source === "ai") return "AI profile, financials from PSX rows";
  if (metadata.meta.source) return metadata.meta.source;
  return "Official PSX financials where sourced";
}

function readPinnedStorage(storageKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const rawValue = window.localStorage.getItem(storageKey);
    const parsed = rawValue ? (JSON.parse(rawValue) as string[]) : [];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function factorTone(score: number | null): StatusTone {
  if (score === null) return "amber";
  if (score >= 67) return "green";
  if (score < 34) return "red";
  return "blue";
}

function Segment<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="scroll-touch flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value ? "bg-white text-slate-950 shadow-sm" : "text-muted-foreground hover:text-slate-950"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2" title={detail}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Badge variant={statusVariant(status as "Complete" | "Partial" | "Unavailable" | "Present" | "Documented")}>{status}</Badge>
        <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </div>
    </div>
  );
}

function RatioHeader({
  ticker,
  ratios,
  metadata,
  quote,
  financialRows,
  peers,
  readOnly,
  activeAnalysis,
  setActiveAnalysis,
  formatMode,
  setFormatMode,
  onExport,
}: {
  ticker: string;
  ratios: RatioRow[];
  metadata: CompanyMetadata;
  quote: RatiosQuoteRow | null;
  financialRows: RatiosFinancialRow[];
  peers: RatiosPeerRow[];
  readOnly: boolean;
  activeAnalysis: ExplorerCategory;
  setActiveAnalysis: (value: ExplorerCategory) => void;
  formatMode: FormatMode;
  setFormatMode: (value: FormatMode) => void;
  onExport: () => void;
}) {
  const statusItems = dataStatusItems(ratios, financialRows, peers);
  const earningsPeriod = latestPeriodForCategory(ratios, ["P/E", "Gross margin", "Net margin", "Revenue growth"]);
  const balancePeriod = latestPeriodForCategory(ratios, ["Current ratio", "Debt-to-equity", "Net debt"]);
  const cashPeriod = latestPeriodForCategory(ratios, ["FCF (OCF - Capex)", "OCF / PAT", "FCF margin"]);
  const priceDate = quote?.as_of ? `Price as of ${quote.as_of}` : "Price date unavailable";
  const officialSource = sourceUrl(ratios, metadata);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Ratio analysis</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Ratios</h2>
            <Badge variant="blue">{ticker}</Badge>
            {metadata.sector ? <Badge variant="secondary">{metadata.sector}</Badge> : null}
          </div>
          <p className="mt-2 max-w-4xl text-sm text-slate-700">
            {earningsPeriod} earnings - {balancePeriod} balance sheet - {cashPeriod} cash flow - {priceDate}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sourceLabel(metadata)} - Mixed-period calculations are labelled at ratio level
            {metadata.meta.lastUpdated ? ` - Updated ${metadata.meta.lastUpdated.slice(0, 10)}` : ""}
            {officialSource ? (
              <>
                {" - "}
                <a href={officialSource} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline underline-offset-2">
                  Source <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button type="button" size="sm" variant={activeAnalysis === "all" ? "default" : "outline"} onClick={() => setActiveAnalysis("all")}>
            <BarChart3 className="h-3.5 w-3.5" /> Snapshot
          </Button>
          <Button type="button" size="sm" variant={activeAnalysis === "profitability" ? "default" : "outline"} onClick={() => setActiveAnalysis("profitability")}>
            <LineChart className="h-3.5 w-3.5" /> Trends
          </Button>
          <Button type="button" size="sm" variant={activeAnalysis === "valuation" ? "default" : "outline"} onClick={() => setActiveAnalysis("valuation")}>
            <ArrowDownUp className="h-3.5 w-3.5" /> Peers
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setFormatMode(formatMode === "compact" ? "exact" : "compact")}>
            <Settings2 className="h-3.5 w-3.5" /> {formatMode === "compact" ? "Compact" : "Exact"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button type="button" size="sm" variant="ghost" title="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          {!readOnly && (
            <ActionButton
              endpoint={`/api/stocks/${ticker}/refresh`}
              body={{ section: "ratios" }}
              label={
                <>
                  <TrendingUp className="h-3.5 w-3.5" /> Refresh
                </>
              }
              variant="outline"
              size="sm"
            />
          )}
        </div>
      </div>
      <div className="grid gap-2 border-t border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statusItems.map((item) => (
          <StatusPill key={item.label} label={item.label} status={item.status} detail={item.detail} />
        ))}
      </div>
    </section>
  );
}

function FactorDashboard({
  factors,
  ratios,
  activeFactor,
  onSelectFactor,
  setSelectedRatio,
}: {
  factors: FactorResult[];
  ratios: RatioRow[];
  activeFactor: string | null;
  onSelectFactor: (factor: FactorResult) => void;
  setSelectedRatio: (row: RatioRow) => void;
}) {
  const ratioMap = new Map(ratios.map((r) => [r.ratio_name, r]));
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Factor snapshot</p>
          <h3 className="text-lg font-semibold text-slate-950">Documented factor read</h3>
        </div>
        <Badge variant="amber">Preliminary until history and peer baselines are complete</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {factors.map((factor) => (
          <button
            key={factor.key}
            type="button"
            onClick={() => onSelectFactor(factor)}
            className={cn(
              "min-h-[190px] rounded-lg border bg-white p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeFactor === factor.key ? "border-blue-300 bg-blue-50/40" : "border-slate-200 hover:border-slate-300"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">{factor.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{factor.summary}</p>
              </div>
              <Badge variant={factor.status === "unavailable" ? "amber" : "blue"}>{factor.status === "unavailable" ? "Unavailable" : "Preliminary"}</Badge>
            </div>
            <div className="mt-4">
              {factor.score === null ? (
                <p className="text-2xl font-semibold text-slate-500">No score</p>
              ) : (
                <div>
                  <p className="text-3xl font-semibold tabular-nums text-slate-950">{factor.score}<span className="text-base text-muted-foreground">/100</span></p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`${factor.label} preliminary score ${factor.score} out of 100`}>
                    <div className={cn("h-full rounded-full", factorTone(factor.score) === "green" && "bg-emerald-600", factorTone(factor.score) === "red" && "bg-red-600", factorTone(factor.score) === "blue" && "bg-blue-600")} style={{ width: `${factor.score}%` }} />
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 space-y-1.5">
              {factor.inputs
                .filter((input) => input.value !== null)
                .slice(0, 3)
                .map((input) => {
                  const row = ratioMap.get(input.ratio);
                  return (
                    <span key={input.ratio} className="block text-[11px] text-slate-600">
                      {row ? ratioDisplayName(row) : ratioDisplayName(input.ratio)}: {row ? formatRatioValue(row) : "-"}
                    </span>
                  );
                })}
              <span className="block text-[11px] text-muted-foreground">Confidence {factor.confidence}% - change and percentiles shown only where data exists.</span>
            </div>
          </button>
        ))}
      </div>
      {activeFactor ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {factors
            .filter((factor) => factor.key === activeFactor)
            .map((factor) => (
              <div key={factor.key}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">{factor.label} inputs</h4>
                    <p className="mt-1 text-xs text-muted-foreground">50 is the midpoint of this absolute-threshold scale. It is not a historical or peer median.</p>
                  </div>
                  <Badge variant="secondary">{factor.inputs.filter((i) => i.value !== null).length} of {factor.inputs.length} inputs available</Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {factor.inputs.map((input) => {
                    const row = ratioMap.get(input.ratio);
                    return (
                      <button
                        key={input.ratio}
                        type="button"
                        className="rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => row && setSelectedRatio(row)}
                        disabled={!row}
                      >
                        <p className="text-xs font-medium text-slate-950">{row ? ratioDisplayName(row) : ratioDisplayName(input.ratio)}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Weight {input.weight}% - {input.direction === "higher" ? "higher values score higher" : "lower values score higher"}
                        </p>
                        <p className="mt-1 text-sm font-semibold tabular-nums">{row ? formatRatioValue(row) : "Missing"}</p>
                      </button>
                    );
                  })}
                </div>
                <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-900">How factor scores work</summary>
                  <div className="mt-2 space-y-2 text-xs leading-relaxed text-slate-600">
                    <p>Each factor uses the documented ratios shown above. Inputs are normalized from 0 to 100 using visible absolute thresholds, then weighted by the percentages shown.</p>
                    <p>Missing inputs are excluded. If fewer than the minimum required inputs are available, the score is hidden. Negative or zero valuation multiples are excluded from lower-is-better valuation scoring.</p>
                    <p>Current scores are labelled preliminary because they do not yet use a finalized historical lookback or peer universe. Peer and historical percentiles remain hidden until enough comparable observations exist.</p>
                  </div>
                </details>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}

function KeyRatioCard({
  row,
  financialRows,
  formatMode,
  pinned,
  onPin,
  onOpen,
}: {
  row: RatioRow | null;
  financialRows: RatiosFinancialRow[];
  formatMode: FormatMode;
  pinned: boolean;
  onPin: () => void;
  onOpen: () => void;
}) {
  if (!row) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-muted-foreground">Unavailable</p>
      </div>
    );
  }
  const context = historicalContext(row, financialRows);
  const change = priorChange(row, financialRows);
  const mixed = isMixedPeriod(row.source_period);
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-950">{ratioDisplayName(row)}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{formatRatioValue(row, formatMode)}</p>
        </div>
        <button type="button" onClick={onPin} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-50 hover:text-slate-950" aria-label={pinned ? `Unpin ${ratioDisplayName(row)}` : `Pin ${ratioDisplayName(row)}`}>
          {pinned ? <Pin className="h-4 w-4 fill-slate-900 text-slate-900" /> : <Pin className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{formattedPeriod(row.source_period)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {change ? <Badge variant={change.tone === "positive" ? "green" : change.tone === "negative" ? "red" : "secondary"}>{change.label}</Badge> : null}
        <Badge variant={mixed ? "amber" : "secondary"}>{mixed ? "Mixed period" : "Derived"}</Badge>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{context.label} - {context.detail}</p>
      <Button type="button" size="sm" variant="ghost" className="mt-2 h-7 px-2 text-[11px]" onClick={onOpen}>
        <Eye className="h-3.5 w-3.5" /> View
      </Button>
    </div>
  );
}

function KeyRatios({
  ratios,
  financialRows,
  formatMode,
  pinned,
  togglePin,
  setSelectedRatio,
}: {
  ratios: RatioRow[];
  financialRows: RatiosFinancialRow[];
  formatMode: FormatMode;
  pinned: Set<string>;
  togglePin: (name: string) => void;
  setSelectedRatio: (row: RatioRow) => void;
}) {
  const byName = new Map(ratios.map((r) => [r.ratio_name, r]));
  return (
    <section className="space-y-3">
      <div>
        <p className="eyebrow">Key ratios</p>
        <h3 className="text-lg font-semibold text-slate-950">Investor questions first</h3>
      </div>
      <div className="grid gap-3 xl:grid-cols-4">
        {KEY_RATIO_GROUPS.map((group) => (
          <div key={group.label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <h4 className="text-sm font-semibold text-slate-950">{group.label}</h4>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {group.ratios.map((name) => {
                const row = byName.get(name) ?? null;
                return (
                  <KeyRatioCard
                    key={name}
                    row={row}
                    financialRows={financialRows}
                    formatMode={formatMode}
                    pinned={pinned.has(name)}
                    onPin={() => togglePin(name)}
                    onOpen={() => row && setSelectedRatio(row)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function toTrendData(rows: { period: string; rank: number; value: number }[], key: string): TrendPoint[] {
  return rows.map((row) => ({ period: row.period, rank: row.rank, [key]: row.value }));
}

function mergeTrendSeries(series: { key: string; rows: { period: string; rank: number; value: number }[] }[]): TrendPoint[] {
  const map = new Map<string, TrendPoint>();
  for (const item of series) {
    for (const point of item.rows) {
      const existing = map.get(point.period) ?? { period: point.period, rank: point.rank };
      existing[item.key] = point.value;
      map.set(point.period, existing);
    }
  }
  return [...map.values()].sort((a, b) => Number(a.rank) - Number(b.rank));
}

function TrendChart({
  title,
  description,
  data,
  series,
  percent = false,
  height = 260,
}: {
  title: string;
  description: string;
  data: TrendPoint[];
  series: { key: string; label: string; color?: string }[];
  percent?: boolean;
  height?: number;
}) {
  const usable = data.filter((row) => series.some((s) => typeof row[s.key] === "number"));
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {usable.length >= 2 ? (
          <div role="img" aria-label={`${title}: ${usable.length} comparable periods`}>
            <ResponsiveContainer width="100%" height={height}>
              <ComposedChart data={usable} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="period" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => (percent ? `${v}%` : fmtCompact(Number(v)))} width={48} />
                <RechartsTooltip cursor={CURSOR} content={<GlassTooltip format={(v, key) => (percent || key?.toLowerCase().includes("margin") || key?.toLowerCase().includes("growth") ? `${v.toFixed(1)}%` : fmtCompact(v))} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {series.map((item, index) => (
                  <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color ?? SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartEmpty note="Not enough comparable periods to chart this ratio without mixing definitions." height={height} />
        )}
      </CardContent>
    </Card>
  );
}

function BarValueChart({
  title,
  description,
  data,
  metric,
  height = 280,
}: {
  title: string;
  description: string;
  data: { name: string; value: number; period?: string; current?: boolean }[];
  metric: string;
  height?: number;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {data.length >= 2 ? (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical" margin={{ top: 6, right: 24, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={INK.grid} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatChartValue(Number(v), metric)} />
              <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={70} />
              <RechartsTooltip cursor={CURSOR} content={<GlassTooltip format={(v) => formatChartValue(v, metric)} />} />
              <Bar dataKey="value" name={ratioDisplayName(metric)} radius={[0, 4, 4, 0]}>
                {data.map((row, index) => (
                  <Cell key={row.name} fill={row.current ? INK.line : SERIES_COLORS[(index + 1) % SERIES_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ChartEmpty note="Peer comparison unavailable from stored, comparable ratio rows." height={height} />
        )}
      </CardContent>
    </Card>
  );
}

function peerMetricData(metric: string, ratios: RatioRow[], peers: RatiosPeerRow[]) {
  const current = ratios.find((r) => r.ratio_name === metric);
  const rows: { name: string; value: number; period?: string; current?: boolean }[] = [];
  if (current?.ratio_value !== null && current?.ratio_value !== undefined) {
    rows.push({ name: current.ticker, value: current.ratio_value, period: current.source_period ?? undefined, current: true });
  }
  for (const peer of peers) {
    const row = peer.ratios.find((r) => r.ratio_name === metric);
    const value = finiteNumber(row?.ratio_value);
    if (value !== null) rows.push({ name: peer.ticker, value, period: row?.source_period ?? undefined });
  }
  return rows;
}

function VisualAnalysis({
  active,
  setActive,
  ratios,
  financialRows,
  peers,
}: {
  active: ExplorerCategory;
  setActive: (value: ExplorerCategory) => void;
  ratios: RatioRow[];
  financialRows: RatiosFinancialRow[];
  peers: RatiosPeerRow[];
}) {
  const [peerMetric, setPeerMetric] = useState("P/E");
  const marginData = mergeTrendSeries([
    { key: "gross", rows: trendValuesFor("Gross margin", financialRows) },
    { key: "operating", rows: trendValuesFor("Operating margin", financialRows) },
    { key: "net", rows: trendValuesFor("Net margin", financialRows) },
  ]);
  const returnData = mergeTrendSeries([
    { key: "roe", rows: trendValuesFor("ROE", financialRows) },
    { key: "roa", rows: trendValuesFor("ROA", financialRows) },
    { key: "roic", rows: trendValuesFor("ROIC", financialRows) },
  ]);
  const strengthData = mergeTrendSeries([
    { key: "debtEquity", rows: trendValuesFor("Debt-to-equity", financialRows) },
    { key: "current", rows: trendValuesFor("Current ratio", financialRows) },
    { key: "coverage", rows: trendValuesFor("Interest coverage", financialRows) },
  ]);
  const growthData = mergeTrendSeries([
    { key: "revenue", rows: trendValuesFor("Revenue growth", financialRows) },
    { key: "profit", rows: trendValuesFor("Profit growth", financialRows) },
    { key: "eps", rows: trendValuesFor("EPS growth", financialRows) },
  ]);
  const efficiencyData = mergeTrendSeries([
    { key: "assetTurnover", rows: trendValuesFor("Asset turnover", financialRows) },
    { key: "receivablesRevenue", rows: trendValuesFor("Receivables / revenue", financialRows) },
    { key: "dso", rows: trendValuesFor("Days sales outstanding", financialRows) },
  ]);
  const cashData = mergeTrendSeries([
    { key: "ocfPat", rows: trendValuesFor("OCF / PAT", financialRows) },
    { key: "fcfMargin", rows: trendValuesFor("FCF margin", financialRows) },
    { key: "accrual", rows: trendValuesFor("Accrual ratio", financialRows) },
  ]);
  const fcfData = toTrendData(trendValuesFor("FCF (OCF - Capex)", financialRows), "fcf");
  const peerData = peerMetricData(peerMetric, ratios, peers);
  const currentPeerPeriod = peerData.find((row) => row.current)?.period ?? null;
  const incompatiblePeers = peerData.filter((row) => !row.current && row.period && currentPeerPeriod && row.period !== currentPeerPeriod).length;
  const netDebt = ratios.find((r) => r.ratio_name === "Net debt");
  const dupontRows = ["Net margin", "Asset turnover", "Equity multiplier"].map((name) => ratios.find((r) => r.ratio_name === name)).filter((row): row is RatioRow => Boolean(row && row.ratio_value !== null));

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Visual analysis</p>
          <h3 className="text-lg font-semibold text-slate-950">Charts by investor question</h3>
        </div>
        <Segment value={active} options={ANALYSIS_TABS} onChange={setActive} />
      </div>

      {(active === "all" || active === "valuation") && (
        <div className="grid gap-3 xl:grid-cols-2">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">Valuation peer view</CardTitle>
                  <CardDescription>Stored same-sector ratios using each company&apos;s central ratio-engine definitions.</CardDescription>
                </div>
                <Select value={peerMetric} onChange={(e) => setPeerMetric(e.target.value)} className="w-full sm:w-44">
                  {PEER_METRICS.map((metric) => (
                    <option key={metric} value={metric}>{ratioDisplayName(metric)}</option>
                  ))}
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {incompatiblePeers ? (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {incompatiblePeers} peer rows use a different source period; treat the comparison as partial.
                </div>
              ) : null}
              <div className="h-[280px]">
                {peerData.length >= 2 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={peerData} layout="vertical" margin={{ top: 6, right: 24, bottom: 0, left: 8 }}>
                      <CartesianGrid stroke={INK.grid} horizontal={false} />
                      <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatChartValue(Number(v), peerMetric)} />
                      <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={70} />
                      <RechartsTooltip cursor={CURSOR} content={<GlassTooltip format={(v) => formatChartValue(v, peerMetric)} />} />
                      <Bar dataKey="value" name={ratioDisplayName(peerMetric)} radius={[0, 4, 4, 0]}>
                        {peerData.map((row, index) => (
                          <Cell key={row.name} fill={row.current ? INK.line : SERIES_COLORS[(index + 1) % SERIES_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmpty note="Peer comparison is unavailable until same-sector peers have stored ratio rows." height={280} />
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">Valuation history readiness</CardTitle>
              <CardDescription>Historical P/E, P/B, EV/EBIT, and Price/FCF need multiple comparable market-price observations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              {["P/E", "P/B", "EV/EBIT", "Price / FCF", "Earnings yield", "FCF yield"].map((metric) => (
                <div key={metric} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-950">{ratioDisplayName(metric)}</p>
                    <p className="text-[11px] text-muted-foreground">Current value: {formatRatioValue(ratios.find((r) => r.ratio_name === metric) ?? { ratio_name: metric, ratio_value: null })}</p>
                  </div>
                  <Badge variant="amber">History pending</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {(active === "all" || active === "profitability") && (
        <div className="grid gap-3 xl:grid-cols-2">
          <TrendChart title="Margins" description="Gross, operating, and net margins over comparable periods." data={marginData} percent series={[
            { key: "gross", label: "Gross margin", color: INK.line },
            { key: "operating", label: "Operating margin", color: INK.amber },
            { key: "net", label: "Net margin", color: INK.up },
          ]} />
          <TrendChart title="Returns" description="ROE and ROA use period-end balances where average balances are unavailable." data={returnData} percent series={[
            { key: "roe", label: "ROE", color: INK.line },
            { key: "roa", label: "ROA", color: INK.up },
            { key: "roic", label: "ROIC", color: INK.amber },
          ]} />
          <Card className="border-slate-200 bg-white shadow-sm xl:col-span-2">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">DuPont-style ROE check</CardTitle>
              <CardDescription>ROE approximately equals net margin x asset turnover x equity multiplier when periods are compatible.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              {dupontRows.length === 3 ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {dupontRows.map((row) => (
                    <div key={row.ratio_name} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs text-muted-foreground">{ratioDisplayName(row)}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">{formatRatioValue(row)}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formattedPeriod(row.source_period)}</p>
                    </div>
                  ))}
                  <div className="sm:col-span-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Based on period-end balance-sheet values, not average balances. Treat as an approximation until average balance data is available.
                  </div>
                </div>
              ) : (
                <ChartEmpty note="DuPont view needs net margin, asset turnover, and equity multiplier with compatible periods." height={160} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {(active === "all" || active === "financial_strength") && (
        <div className="grid gap-3 xl:grid-cols-2">
          <TrendChart title="Leverage and liquidity" description="Debt/equity, current ratio, and coverage where comparable period data exists." data={strengthData} series={[
            { key: "debtEquity", label: "Debt/equity", color: INK.down },
            { key: "current", label: "Current ratio", color: INK.line },
            { key: "coverage", label: "Interest coverage", color: INK.up },
          ]} />
          <BarValueChart
            title={netDebt?.ratio_value !== null && netDebt?.ratio_value !== undefined && netDebt.ratio_value < 0 ? "Net cash position" : "Net debt position"}
            description="Borrowings minus cash and equivalents. Negative net debt is displayed to users as net cash."
            data={trendValuesFor("Net debt", financialRows).map((p) => ({ name: p.period, value: p.value }))}
            metric="Net debt"
          />
        </div>
      )}

      {(active === "all" || active === "growth") && (
        <div className="grid gap-3 xl:grid-cols-2">
          <TrendChart title="Annual growth" description="Revenue, profit, and EPS growth use comparable periods only." data={growthData} percent series={[
            { key: "revenue", label: "Revenue growth", color: INK.line },
            { key: "profit", label: "Profit growth", color: INK.up },
            { key: "eps", label: "EPS growth", color: INK.amber },
          ]} />
          <TrendChart title="Margin change context" description="Margin expansion is separated from absolute growth." data={marginData} percent series={[
            { key: "gross", label: "Gross margin", color: INK.line },
            { key: "net", label: "Net margin", color: INK.up },
          ]} />
        </div>
      )}

      {(active === "all" || active === "efficiency") && (
        <div className="grid gap-3 xl:grid-cols-2">
          <TrendChart title="Asset and working-capital efficiency" description="Asset turnover, receivables intensity, and days sales outstanding." data={efficiencyData} series={[
            { key: "assetTurnover", label: "Asset turnover", color: INK.line },
            { key: "receivablesRevenue", label: "Receivables/revenue", color: INK.amber },
            { key: "dso", label: "DSO", color: INK.down },
          ]} />
          <TrendChart title="Cost structure" description="Cost of sales and operating expense ratios where extracted." data={mergeTrendSeries([
            { key: "cost", rows: trendValuesFor("Cost of sales ratio", financialRows) },
            { key: "opex", rows: trendValuesFor("Operating expense ratio", financialRows) },
          ])} percent series={[
            { key: "cost", label: "Cost of sales", color: INK.down },
            { key: "opex", label: "Operating expenses", color: INK.amber },
          ]} />
        </div>
      )}

      {(active === "all" || active === "cash_flow") && (
        <div className="grid gap-3 xl:grid-cols-2">
          <BarValueChart title="Free cash flow" description="Operating cash flow minus capex, using stored cash-flow periods." data={fcfData.map((p) => ({ name: p.period, value: Number(p.fcf) }))} metric="FCF (OCF − Capex)" />
          <TrendChart title="Earnings quality" description="OCF/PAT, FCF margin, and accrual ratio where compatible periods exist." data={cashData} series={[
            { key: "ocfPat", label: "OCF/PAT", color: INK.line },
            { key: "fcfMargin", label: "FCF margin", color: INK.up },
            { key: "accrual", label: "Accrual ratio", color: INK.down },
          ]} />
        </div>
      )}

      {active === "dividends" && (
        <div className="grid gap-3 xl:grid-cols-2">
          <BarValueChart title="Dividend peer view" description="Trailing dividend yield, where stored peer data exists." data={peerMetricData("Dividend yield (TTM)", ratios, peers)} metric="Dividend yield (TTM)" />
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">Dividend ratio detail</CardTitle>
              <CardDescription>Market payout metrics are separate from user-received dividend records.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 p-4 pt-2 sm:grid-cols-3">
              {["Dividend yield (TTM)", "Payout ratio", "Dividend cover"].map((metric) => {
                const row = ratios.find((r) => r.ratio_name === metric);
                return (
                  <div key={metric} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">{ratioDisplayName(metric)}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{row ? formatRatioValue(row) : "-"}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{formattedPeriod(row?.source_period)}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

function RatioExplorer({
  ticker,
  ratios,
  financialRows,
  peers,
  formatMode,
  setFormatMode,
  activeCategory,
  setActiveCategory,
  pinned,
  togglePin,
  setSelectedRatio,
  exportRows,
}: {
  ticker: string;
  ratios: RatioRow[];
  financialRows: RatiosFinancialRow[];
  peers: RatiosPeerRow[];
  formatMode: FormatMode;
  setFormatMode: (value: FormatMode) => void;
  activeCategory: ExplorerCategory;
  setActiveCategory: (value: ExplorerCategory) => void;
  pinned: Set<string>;
  togglePin: (name: string) => void;
  setSelectedRatio: (row: RatioRow) => void;
  exportRows: (rows: RatioRow[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [derivedOnly, setDerivedOnly] = useState(false);
  const [mixedOnly, setMixedOnly] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [historyOnly, setHistoryOnly] = useState(false);
  const [peerOnly, setPeerOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [visibleColumns, setVisibleColumns] = useState({ change: true, context: true, period: true, status: true });
  const [preset, setPreset] = useState<string>("All ratios");

  const peerMetricSet = useMemo(() => {
    const set = new Set<string>();
    for (const peer of peers) for (const ratio of peer.ratios) if (ratio.ratio_value !== null) set.add(ratio.ratio_name);
    return set;
  }, [peers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const presetRatios = PRESET_VIEWS.find((view) => view.label === preset)?.ratios ?? null;
    let out = ratios.filter((row) => {
      const def = defFor(row.ratio_name);
      const matchesQuery = !q || row.ratio_name.toLowerCase().includes(q) || def.displayName.toLowerCase().includes(q) || def.category.includes(q);
      const matchesCategory =
        activeCategory === "all" ||
        (activeCategory === "key" && isImportant(row)) ||
        (activeCategory === "pinned" && pinned.has(row.ratio_name)) ||
        def.category === activeCategory;
      const matchesPreset = !presetRatios || presetRatios.includes(row.ratio_name);
      const matchesImportant = !importantOnly || isImportant(row);
      const matchesDerived = !derivedOnly || row.ratio_value !== null;
      const matchesMixed = !mixedOnly || isMixedPeriod(row.source_period);
      const matchesIncomplete = !incompleteOnly || row.ratio_value === null;
      const matchesHistory = !historyOnly || trendValuesFor(row.ratio_name, financialRows).length >= 2;
      const matchesPeer = !peerOnly || peerMetricSet.has(row.ratio_name);
      return matchesQuery && matchesCategory && matchesPreset && matchesImportant && matchesDerived && matchesMixed && matchesIncomplete && matchesHistory && matchesPeer;
    });
    out = out.sort((a, b) => {
      const pinDiff = Number(pinned.has(b.ratio_name)) - Number(pinned.has(a.ratio_name));
      if (pinDiff) return pinDiff;
      const importantDiff = Number(isImportant(b)) - Number(isImportant(a));
      if (sortMode === "default" && importantDiff) return importantDiff;
      if (sortMode === "name") return ratioDisplayName(a).localeCompare(ratioDisplayName(b));
      if (sortMode === "category") return CATEGORY_LABELS[defFor(a.ratio_name).category].localeCompare(CATEGORY_LABELS[defFor(b.ratio_name).category]);
      if (sortMode === "value") return (b.ratio_value ?? Number.NEGATIVE_INFINITY) - (a.ratio_value ?? Number.NEGATIVE_INFINITY);
      if (sortMode === "availability") return Number(b.ratio_value !== null) - Number(a.ratio_value !== null);
      return 0;
    });
    return out;
  }, [activeCategory, derivedOnly, financialRows, historyOnly, importantOnly, incompleteOnly, mixedOnly, peerMetricSet, peerOnly, pinned, preset, query, ratios, sortMode]);

  const pinnedRows = ratios.filter((row) => pinned.has(row.ratio_name));

  function saveCurrentView() {
    try {
      window.localStorage.setItem(
        `portfolioos:ratio-view:${ticker}`,
        JSON.stringify({ activeCategory, query, importantOnly, mixedOnly, historyOnly, peerOnly, preset, sortMode })
      );
    } catch {
      /* local persistence is optional */
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Ratio explorer</p>
          <h3 className="text-lg font-semibold text-slate-950">Full ratio dataset</h3>
          <p className="mt-1 text-xs text-muted-foreground">{filtered.length} of {ratios.length} ratios shown. Formulas are in the detail inspector.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => exportRows(filtered)}>
            <Download className="h-3.5 w-3.5" /> Export selected
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={saveCurrentView}>
            <Star className="h-3.5 w-3.5" /> Save view
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_160px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search P/E, debt, margin, cash flow, EPS" className="pl-9" />
          </label>
          <Select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} aria-label="Sort ratios">
            <option value="default">Sort: default</option>
            <option value="name">Sort: name</option>
            <option value="category">Sort: category</option>
            <option value="value">Sort: value</option>
            <option value="availability">Sort: availability</option>
          </Select>
          <Select value={formatMode} onChange={(e) => setFormatMode(e.target.value as FormatMode)} aria-label="Display format">
            <option value="compact">Compact values</option>
            <option value="exact">Exact values</option>
          </Select>
        </div>

        <div className="mt-3">
          <Segment value={activeCategory} options={EXPLORER_CATEGORIES} onChange={setActiveCategory} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: "Important only", active: importantOnly, onClick: () => setImportantOnly((v) => !v) },
            { label: "Derived", active: derivedOnly, onClick: () => setDerivedOnly((v) => !v) },
            { label: "Mixed period", active: mixedOnly, onClick: () => setMixedOnly((v) => !v) },
            { label: "Incomplete", active: incompleteOnly, onClick: () => setIncompleteOnly((v) => !v) },
            { label: "History available", active: historyOnly, onClick: () => setHistoryOnly((v) => !v) },
            { label: "Peer data available", active: peerOnly, onClick: () => setPeerOnly((v) => !v) },
          ].map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={filter.onClick}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter.active ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              <Filter className="h-3.5 w-3.5" /> {filter.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-full sm:w-56" aria-label="Preset ratio view">
            <option>All ratios</option>
            {PRESET_VIEWS.map((view) => (
              <option key={view.label}>{view.label}</option>
            ))}
          </Select>
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-900">
              <Settings2 className="mr-1 inline h-3.5 w-3.5" /> Columns
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Object.entries(visibleColumns).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => setVisibleColumns((current) => ({ ...current, [key]: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="capitalize">{key}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      {pinnedRows.length ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            <Pin className="h-4 w-4 text-slate-600" />
            <p className="text-sm font-semibold text-slate-950">Pinned ratio watchlist</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {pinnedRows.map((row) => (
              <button key={row.ratio_name} type="button" onClick={() => setSelectedRatio(row)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50">
                <span className="block text-xs font-medium text-slate-950">{ratioDisplayName(row)}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{formatRatioValue(row, formatMode)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <THead>
                <TR>
                  <TH>Ratio</TH>
                  <TH className="text-right">Current value</TH>
                  {visibleColumns.change ? <TH>Change</TH> : null}
                  {visibleColumns.context ? <TH>Context</TH> : null}
                  {visibleColumns.period ? <TH>Period</TH> : null}
                  {visibleColumns.status ? <TH>Status</TH> : null}
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((row) => {
                  const def = defFor(row.ratio_name);
                  const change = priorChange(row, financialRows);
                  const context = historicalContext(row, financialRows);
                  const mixed = isMixedPeriod(row.source_period);
                  return (
                    <TR key={row.ratio_name}>
                      <TD className="min-w-[220px]">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => togglePin(row.ratio_name)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-50 hover:text-slate-950" aria-label={pinned.has(row.ratio_name) ? `Unpin ${ratioDisplayName(row)}` : `Pin ${ratioDisplayName(row)}`}>
                            <Pin className={cn("h-3.5 w-3.5", pinned.has(row.ratio_name) && "fill-slate-900 text-slate-900")} />
                          </button>
                          <div>
                            <button type="button" onClick={() => setSelectedRatio(row)} className="text-left text-xs font-semibold text-slate-950 hover:underline">{ratioDisplayName(row)}</button>
                            <p className="text-[11px] text-muted-foreground">{CATEGORY_LABELS[def.category]}</p>
                          </div>
                        </div>
                      </TD>
                      <TD className="text-right text-xs font-semibold tabular-nums">{formatRatioValue(row, formatMode)}</TD>
                      {visibleColumns.change ? (
                        <TD>{change ? <Badge variant={change.tone === "positive" ? "green" : change.tone === "negative" ? "red" : "secondary"}>{change.label}</Badge> : <span className="text-xs text-muted-foreground">-</span>}</TD>
                      ) : null}
                      {visibleColumns.context ? (
                        <TD className="max-w-[240px] whitespace-normal text-xs text-slate-600">{context.label}<span className="block text-[11px] text-muted-foreground">{context.detail}</span></TD>
                      ) : null}
                      {visibleColumns.period ? <TD className="text-xs text-muted-foreground">{formattedPeriod(row.source_period)}</TD> : null}
                      {visibleColumns.status ? (
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={row.ratio_value === null ? "red" : "blue"}>{row.ratio_value === null ? "Incomplete" : "Derived"}</Badge>
                            {mixed ? <Badge variant="amber">Mixed</Badge> : null}
                            {peerMetricSet.has(row.ratio_name) ? <Badge variant="secondary">Peer</Badge> : null}
                          </div>
                        </TD>
                      ) : null}
                      <TD className="text-right">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedRatio(row)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>

          <div className="divide-y divide-slate-100 lg:hidden">
            {filtered.map((row) => {
              const context = historicalContext(row, financialRows);
              const change = priorChange(row, financialRows);
              return (
                <div key={row.ratio_name} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{ratioDisplayName(row)}</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">{formatRatioValue(row, formatMode)}</p>
                      <p className="text-[11px] text-muted-foreground">{formattedPeriod(row.source_period)}</p>
                    </div>
                    <button type="button" onClick={() => togglePin(row.ratio_name)} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-50" aria-label={pinned.has(row.ratio_name) ? `Unpin ${ratioDisplayName(row)}` : `Pin ${ratioDisplayName(row)}`}>
                      <Pin className={cn("h-4 w-4", pinned.has(row.ratio_name) && "fill-slate-900 text-slate-900")} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {change ? <Badge variant={change.tone === "positive" ? "green" : change.tone === "negative" ? "red" : "secondary"}>{change.label}</Badge> : null}
                    <Badge variant={isMixedPeriod(row.source_period) ? "amber" : "blue"}>{isMixedPeriod(row.source_period) ? "Mixed period" : "Derived"}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{context.label} - {context.detail}</p>
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setSelectedRatio(row)}>
                    <Eye className="h-3.5 w-3.5" /> View details
                  </Button>
                </div>
              );
            })}
          </div>
          {!filtered.length ? <ChartEmpty note="No ratios match the current filters." height={180} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}

function RatioDetailDialog({
  ticker,
  row,
  financialRows,
  peers,
  formatMode,
  onClose,
}: {
  ticker: string;
  row: RatioRow | null;
  financialRows: RatiosFinancialRow[];
  peers: RatiosPeerRow[];
  formatMode: FormatMode;
  onClose: () => void;
}) {
  const [runningAi, setRunningAi] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  if (!row) return null;
  const selected = row;
  const def = defFor(selected.ratio_name);
  const history = trendValuesFor(selected.ratio_name, financialRows);
  const peerRows = peerMetricData(selected.ratio_name, [selected], peers);
  const mixed = isMixedPeriod(selected.source_period);
  const inputs = Object.entries(selected.inputs ?? {});
  const numeratorPeriod = selected.source_period?.split(/\s+\/\s+|\s+vs\s+/i)[0] ?? selected.source_period ?? null;
  const denominatorPeriod = selected.source_period?.split(/\s+\/\s+|\s+vs\s+/i)[1] ?? null;

  async function runAi() {
    setRunningAi(true);
    setAiMessage(null);
    try {
      const res = await fetch("/api/ai/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, action: "explain_ratios" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "AI action failed");
      setAiMessage("AI ratio analysis saved in AI Analysis.");
    } catch (err) {
      setAiMessage(err instanceof Error ? err.message : "AI action failed");
    } finally {
      setRunningAi(false);
    }
  }

  function createLocalAlert() {
    const defaultValue = selected.ratio_value !== null ? String(selected.ratio_value) : "";
    const threshold = window.prompt(`Alert threshold for ${ratioDisplayName(selected)}. Use >, <, >=, or <= with a number.`, defaultValue);
    if (!threshold?.trim()) return;
    try {
      const key = "portfolioos:ratio-alert-intents";
      const existing = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown[];
      window.localStorage.setItem(
        key,
        JSON.stringify([
          ...existing,
          {
            ticker,
            ratio: selected.ratio_name,
            threshold: threshold.trim(),
            createdAt: new Date().toISOString(),
          },
        ])
      );
      setAiMessage(`Saved alert intent for ${ratioDisplayName(selected)}. It can only be evaluated when new financial or market data is published.`);
    } catch {
      setAiMessage("Could not save the alert intent in this browser.");
    }
  }

  return (
    <Dialog open={Boolean(row)} onClose={onClose} title={`${ratioDisplayName(row)} - ${formatRatioValue(row, formatMode)}`} className="sm:max-w-3xl lg:max-w-5xl">
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What it means</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-800">{def.definition}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-800">{def.why}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">Interpret carefully</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">{def.limitation}</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-muted-foreground">Current value</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{formatRatioValue(row, formatMode)}</p>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Period</span><span className="text-right">{formattedPeriod(row.source_period)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Status</span><Badge variant={row.ratio_value === null ? "red" : "blue"}>{row.ratio_value === null ? "Incomplete" : "Derived"}</Badge></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Alignment</span><Badge variant={mixed ? "amber" : "secondary"}>{mixed ? "Mixed period" : "Single label"}</Badge></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Category</span><span>{CATEGORY_LABELS[def.category]}</span></div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="border-slate-200 shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">Calculation inspector</CardTitle>
              <CardDescription>Formula, inputs, periods, and missing-data treatment from the ratio engine.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              <div className="rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-white">{row.formula}</div>
              {row.missing ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{row.missing}</div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Numerator period</p>
                  <p className="text-xs font-medium">{formattedPeriod(numeratorPeriod)}</p>
                </div>
                <div className="rounded-md border border-slate-200 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Denominator period</p>
                  <p className="text-xs font-medium">{denominatorPeriod ? formattedPeriod(denominatorPeriod) : formattedPeriod(row.source_period)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR><TH>Input</TH><TH className="text-right">Exact value</TH><TH>Source</TH></TR>
                  </THead>
                  <TBody>
                    {inputs.map(([key, value]) => (
                      <TR key={key}>
                        <TD className="text-xs font-medium">{key.replace(/_/g, " ")}</TD>
                        <TD className="text-right text-xs tabular-nums">{typeof value === "number" ? value.toLocaleString("en-PK", { maximumFractionDigits: 4 }) : String(value ?? "-")}</TD>
                        <TD className="text-[11px] text-muted-foreground">{/price/i.test(key) ? "Market quote" : /dps|dividend/i.test(key) ? "Payout record" : "Stored financial row"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Rounding is display-only. Corporate actions are reflected only when they are present in the stored financial, price, payout, or derived-share inputs.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <TrendChart
              title="Historical trend"
              description="Shown only when comparable stored periods exist."
              data={toTrendData(history, "value")}
              series={[{ key: "value", label: ratioDisplayName(row), color: INK.line }]}
              percent={def.kind === "percent"}
              height={220}
            />
            <BarValueChart
              title="Peer comparison"
              description="Stored same-sector peer rows; incompatible periods are treated as partial."
              data={peerRows}
              metric={row.ratio_name}
              height={220}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">Related actions</p>
              <p className="text-xs text-muted-foreground">AI uses the same stored ratio table and financial rows as this page.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={runAi} disabled={runningAi}>
                <Sparkles className="h-3.5 w-3.5" /> {runningAi ? "Running" : "Explain ratios"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={createLocalAlert} title="Ratio alerts depend on newly published financial or market data.">
                <Bell className="h-3.5 w-3.5" /> Alert
              </Button>
            </div>
          </div>
          {aiMessage ? <p className="mt-2 text-xs text-muted-foreground">{aiMessage}</p> : null}
        </div>
      </div>
    </Dialog>
  );
}

export function RatiosWorkspace({
  ticker,
  ratios,
  financialRows,
  metadata,
  quote,
  peers,
  readOnly = false,
}: {
  ticker: string;
  ratios: RatioRow[];
  financialRows: RatiosFinancialRow[];
  metadata: CompanyMetadata;
  quote: RatiosQuoteRow | null;
  peers: RatiosPeerRow[];
  readOnly?: boolean;
}) {
  const [activeAnalysis, setActiveAnalysis] = useState<ExplorerCategory>("all");
  const [activeCategory, setActiveCategory] = useState<ExplorerCategory>("all");
  const [formatMode, setFormatMode] = useState<FormatMode>("compact");
  const [activeFactor, setActiveFactor] = useState<string | null>(null);
  const [selectedRatio, setSelectedRatio] = useState<RatioRow | null>(null);
  const storageKey = `portfolioos:pinned-ratios:${ticker}`;
  const [pinned, setPinned] = useState<Set<string>>(() => readPinnedStorage(storageKey));

  const factors = useMemo(() => buildFactors(ratios), [ratios]);

  function persistPinned(next: Set<string>) {
    setPinned(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      /* local persistence is optional */
    }
  }

  function togglePin(name: string) {
    const next = new Set(pinned);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    persistPinned(next);
  }

  function exportRows(rows: RatioRow[] = ratios) {
    const header = ["Ratio", "Value", "Period", "Status", "Formula", "Missing", "Source"];
    const body = rows.map((row) => [
      ratioDisplayName(row),
      row.ratio_value ?? "",
      row.source_period ?? "",
      row.ratio_value === null ? "Incomplete" : "Derived",
      row.formula,
      row.missing ?? "",
      row.source ?? "",
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ticker}-ratios.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function selectFactor(factor: FactorResult) {
    setActiveFactor(factor.key);
    setActiveCategory(factor.category);
    setActiveAnalysis(factor.category);
  }

  const hasFinancials = ratios.some((r) => r.source !== null) || financialRows.length > 0;

  return (
    <div className="space-y-5">
      {!hasFinancials ? (
        <Card className="border-amber-200 bg-amber-50 shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="text-sm font-semibold text-amber-950">Most ratios need financials loaded</p>
                <p className="mt-1 text-xs text-amber-800">Only market-data ratios can be computed until official PSX financial rows are stored.</p>
              </div>
            </div>
            {!readOnly ? (
              <ActionButton
                endpoint={`/api/stocks/${ticker}/refresh`}
                body={{ section: "financials" }}
                label={
                  <>
                    <TrendingUp className="h-3.5 w-3.5" /> Load financials
                  </>
                }
                variant="outline"
                size="sm"
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <RatioHeader
        ticker={ticker}
        ratios={ratios}
        metadata={metadata}
        quote={quote}
        financialRows={financialRows}
        peers={peers}
        readOnly={readOnly}
        activeAnalysis={activeAnalysis}
        setActiveAnalysis={setActiveAnalysis}
        formatMode={formatMode}
        setFormatMode={setFormatMode}
        onExport={() => exportRows(ratios)}
      />

      <FactorDashboard
        factors={factors}
        ratios={ratios}
        activeFactor={activeFactor}
        onSelectFactor={selectFactor}
        setSelectedRatio={setSelectedRatio}
      />

      <KeyRatios
        ratios={ratios}
        financialRows={financialRows}
        formatMode={formatMode}
        pinned={pinned}
        togglePin={togglePin}
        setSelectedRatio={setSelectedRatio}
      />

      <VisualAnalysis
        active={activeAnalysis}
        setActive={setActiveAnalysis}
        ratios={ratios}
        financialRows={financialRows}
        peers={peers}
      />

      <RatioExplorer
        ticker={ticker}
        ratios={ratios}
        financialRows={financialRows}
        peers={peers}
        formatMode={formatMode}
        setFormatMode={setFormatMode}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        pinned={pinned}
        togglePin={togglePin}
        setSelectedRatio={setSelectedRatio}
        exportRows={exportRows}
      />

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          <div>
            <p className="text-sm font-semibold text-slate-950">Definition standardization</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              EPS, P/E, earnings yield, P/B, margins, ROE, ROA, ROIC, leverage, liquidity, FCF yield, dividend yield, and OCF/PAT are read from the central ratio engine used across the stock page and generated research context.
            </p>
          </div>
        </div>
      </div>

      <RatioDetailDialog
        ticker={ticker}
        row={selectedRatio}
        financialRows={financialRows}
        peers={peers}
        formatMode={formatMode}
        onClose={() => setSelectedRatio(null)}
      />
    </div>
  );
}
