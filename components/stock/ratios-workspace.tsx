"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { CompanyMetadata } from "@/lib/company/types";
import type { RatioRow } from "@/lib/engine/ratios";
import { cn, formatFinancialPeriod, formatNumber } from "@/lib/utils";
import {
  BarChart3,
  
  Download,
  ExternalLink,
  
  Pin,
  Search,
  Settings2,
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
type ActiveTab = "snapshot" | "explorer";
type FormatMode = "compact" | "exact";
type FormatKind = "multiple" | "percent" | "money" | "statementMoney" | "perShare" | "shares" | "days" | "number";

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
    limitation: "Current engine uses period-end equity when average balance data is not stored.",
  },
  ROA: {
    displayName: "ROA",
    category: "profitability",
    kind: "percent",
    definition: "Profit after tax divided by total assets.",
    why: "Shows profit generated from the asset base.",
    limitation: "Current engine uses period-end assets when average balance data is not stored.",
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
    limitation: "Current engine uses period-end assets when average balance data is not stored.",
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
  { label: "Valuation", ratios: ["P/E", "FCF yield"] },
  { label: "Profitability", ratios: ["ROIC", "Net margin"] },
  { label: "Financial strength", ratios: ["Net debt", "Interest coverage"] },
  { label: "Growth and cash quality", ratios: ["EPS growth", "OCF / PAT"] },
];

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

function latestPeriodForCategory(ratios: RatioRow[], names: string[]): string {
  const period = names.map((name) => ratios.find((r) => r.ratio_name === name)?.source_period).find(Boolean);
  return formattedPeriod(period);
}

function sourceUrl(ratios: RatioRow[], metadata: CompanyMetadata): string | null {
  return ratios.find((r) => r.source)?.source ?? metadata.meta.sourceUrl ?? null;
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

function RatioHeader({
  ticker,
  ratios,
  metadata,
  quote,
  readOnly,
  activeTab,
  setActiveTab,
  formatMode,
  setFormatMode,
  onExport,
}: {
  ticker: string;
  ratios: RatioRow[];
  metadata: CompanyMetadata;
  quote: RatiosQuoteRow | null;
  readOnly: boolean;
  activeTab: ActiveTab;
  setActiveTab: (value: ActiveTab) => void;
  formatMode: FormatMode;
  setFormatMode: (value: FormatMode) => void;
  onExport: () => void;
}) {
  const earningsPeriod = latestPeriodForCategory(ratios, ["P/E", "Gross margin", "Net margin", "Revenue growth"]);
  const balancePeriod = latestPeriodForCategory(ratios, ["Current ratio", "Debt-to-equity", "Net debt"]);
  const cashPeriod = latestPeriodForCategory(ratios, ["FCF (OCF - Capex)", "OCF / PAT", "FCF margin"]);
  const officialSource = sourceUrl(ratios, metadata);
  const contextBits = [
    `${ratios.length} stored ratio${ratios.length === 1 ? "" : "s"}`,
    earningsPeriod !== "-" ? `Earnings ${earningsPeriod}` : null,
    balancePeriod !== "-" ? `Balance sheet ${balancePeriod}` : null,
    cashPeriod !== "-" ? `Cash flow ${cashPeriod}` : null,
    quote?.as_of ? `Price as of ${quote.as_of}` : null,
  ].filter(Boolean);

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
          <div className="mt-3 space-y-1 text-sm text-slate-700">
            <p>{contextBits.join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button type="button" size="sm" variant={activeTab === "snapshot" ? "default" : "outline"} onClick={() => setActiveTab("snapshot")}>
            <BarChart3 className="h-3.5 w-3.5" /> Snapshot
          </Button>
          <Button type="button" size="sm" variant={activeTab === "explorer" ? "default" : "outline"} onClick={() => setActiveTab("explorer")}>
            <Search className="h-3.5 w-3.5" /> Explorer
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setFormatMode(formatMode === "compact" ? "exact" : "compact")}>
            <Settings2 className="h-3.5 w-3.5" /> {formatMode === "compact" ? "Compact" : "Exact"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          {!readOnly && (
            <ActionButton
              endpoint={`/api/stocks/${ticker}/refresh`}
              body={{ section: "ratios" }}
              label={<><TrendingUp className="h-3.5 w-3.5" /> Refresh</>}
              variant="outline"
              size="sm"
            />
          )}
        </div>
      </div>
      {officialSource ? (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-muted-foreground">
          <a href={officialSource} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline underline-offset-2">
            Source <ExternalLink className="h-3 w-3" />
          </a>
          {metadata.meta.lastUpdated ? <span> · Updated {metadata.meta.lastUpdated.slice(0, 10)}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function KeyRatioCard({
  row,
  formatMode,
}: {
  row: RatioRow;
  formatMode: FormatMode;
}) {
  return (
    <div className="flex w-full flex-col items-start rounded-md border border-slate-200 bg-white p-3 text-left">
      <p className="truncate text-xs font-semibold text-slate-950">{ratioDisplayName(row)}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{formatRatioValue(row, formatMode)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{formattedPeriod(row.source_period)}</p>
    </div>
  );
}

function KeyRatios({
  ratios,
  formatMode,
  onExploreAll,
}: {
  ratios: RatioRow[];
  formatMode: FormatMode;
  onExploreAll: () => void;
}) {
  const byName = new Map(ratios.map((r) => [r.ratio_name, r]));
  const groups = KEY_RATIO_GROUPS.map((group) => ({
    label: group.label,
    rows: group.ratios.map((name) => byName.get(name)).filter((row): row is RatioRow => Boolean(row)),
  })).filter((group) => group.rows.length > 0);
  if (!groups.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Key ratios</p>
          <h3 className="text-lg font-semibold text-slate-950">Summary metrics</h3>
        </div>
        <Button variant="ghost" className="h-auto p-0 text-blue-600 hover:bg-transparent hover:underline text-xs" onClick={onExploreAll}>View all key ratios</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((group) => (
          <div key={group.label} className="rounded-xl bg-slate-50 p-2 border border-slate-100">
            <h4 className="px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</h4>
            <div className="mt-2 space-y-2">
              {group.rows.map((row) => (
                <KeyRatioCard
                  key={row.ratio_name}
                  row={row}
                  formatMode={formatMode}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
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
          <ChartEmpty note="Comparable stored rows are required for this chart." height={height} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Median of a metric across same-sector peers (and this company), so a raw ratio
 * becomes a judgment: "cheap" or "rich" relative to the sector. Neutral by
 * design — we show the delta, not a buy/sell colour.
 */
export type SectorMedian = { median: number; sampleSize: number };

function renderSectorMedian(row: RatioRow, median: SectorMedian | undefined, formatMode: FormatMode): ReactNode {
  if (!median) return <span className="text-muted-foreground">—</span>;
  const value = finiteNumber(row.ratio_value);
  const medianText = formatRatioValue({ ratio_name: row.ratio_name, ratio_value: median.median }, formatMode);
  if (value === null || median.median === 0) {
    return <span className="text-muted-foreground" title={`Median of ${median.sampleSize} sector peers`}>{medianText}</span>;
  }
  const deltaPct = ((value - median.median) / Math.abs(median.median)) * 100;
  const label = Math.abs(deltaPct) < 1 ? "in line" : `${Math.abs(deltaPct).toFixed(0)}% ${deltaPct > 0 ? "above" : "below"}`;
  return (
    <span title={`Median of ${median.sampleSize} sector peers`}>
      <span className="font-medium text-foreground">{medianText}</span>
      <span className="ml-1 text-muted-foreground">({label})</span>
    </span>
  );
}

function buildSectorMedians(ratios: RatioRow[], peers: RatiosPeerRow[]): Map<string, SectorMedian> {
  const out = new Map<string, SectorMedian>();
  const names = new Set<string>();
  for (const peer of peers) for (const r of peer.ratios) if (r.ratio_value !== null) names.add(r.ratio_name);
  for (const name of names) {
    const values: number[] = [];
    const self = finiteNumber(ratios.find((r) => r.ratio_name === name)?.ratio_value);
    if (self !== null) values.push(self);
    for (const peer of peers) {
      const v = finiteNumber(peer.ratios.find((r) => r.ratio_name === name)?.ratio_value);
      if (v !== null) values.push(v);
    }
    if (values.length < 3) continue; // too few peers to be meaningful
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    out.set(name, { median, sampleSize: values.length });
  }
  return out;
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

function RatioExplorer({
  ticker,
  ratios,
  formatMode,
  activeCategory,
  setActiveCategory,
  pinned,
  togglePin,
  exportRows,
  sectorMedians,
}: {
  ticker: string;
  ratios: RatioRow[];
  formatMode: FormatMode;
  activeCategory: ExplorerCategory;
  setActiveCategory: (value: ExplorerCategory) => void;
  pinned: Set<string>;
  togglePin: (name: string) => void;
  exportRows: (rows: RatioRow[]) => void;
  sectorMedians: Map<string, SectorMedian>;
}) {
  const [query, setQuery] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = ratios.filter((row) => {
      const def = defFor(row.ratio_name);
      const matchesQuery = !q || row.ratio_name.toLowerCase().includes(q) || def.displayName.toLowerCase().includes(q) || def.category.includes(q);
      const matchesCategory =
        activeCategory === "all" ||
        (activeCategory === "key" && isImportant(row)) ||
        (activeCategory === "pinned" && pinned.has(row.ratio_name)) ||
        def.category === activeCategory;
      const matchesImportant = !importantOnly || isImportant(row);
      return matchesQuery && matchesCategory && matchesImportant;
    });
    out = out.sort((a, b) => {
      const pinDiff = Number(pinned.has(b.ratio_name)) - Number(pinned.has(a.ratio_name));
      if (pinDiff) return pinDiff;
      const importantDiff = Number(isImportant(b)) - Number(isImportant(a));
      return importantDiff || ratioDisplayName(a).localeCompare(ratioDisplayName(b));
    });
    return out;
  }, [activeCategory, importantOnly, pinned, query, ratios]);

  function saveCurrentView() {
    try {
      window.localStorage.setItem(
        `portfolioos:ratio-view:${ticker}`,
        JSON.stringify({ activeCategory, query, importantOnly })
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
          <p className="mt-1 text-xs text-muted-foreground">{filtered.length} of {ratios.length} ratios shown.</p>
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ratios" className="pl-9 h-9" />
          </div>
          <Select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value as ExplorerCategory)}>
            {EXPLORER_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <button type="button" onClick={() => setImportantOnly(!importantOnly)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium", importantOnly ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
            Key ratios only
          </button>
        </div>
      </div>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Ratio</TH>
                  <TH className="text-right">Current value</TH>
                  <TH className="text-right">Sector median</TH>
                  <TH>Period</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Pin</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((row) => {
                  return (
                    <TR key={row.ratio_name}>
                      <TD className="min-w-[220px]">
                        <div className="flex items-center gap-2">
                          <div>
                            <span className="text-left text-xs font-semibold text-slate-950">{ratioDisplayName(row)}</span>
                          </div>
                        </div>
                      </TD>
                      <TD className="text-right text-xs font-semibold tabular-nums">{formatRatioValue(row, formatMode)}</TD>
                      <TD className="text-right text-xs tabular-nums">{renderSectorMedian(row, sectorMedians.get(row.ratio_name), formatMode)}</TD>
                      <TD className="text-xs text-muted-foreground">{formattedPeriod(row.source_period)}</TD>
                      <TD className="text-xs text-muted-foreground">
                        {row.source ? (
                          <a href={row.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline underline-offset-2">
                            Source <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          "Stored ratio"
                        )}
                      </TD>
                      <TD className="text-right">
                        <button type="button" onClick={() => togglePin(row.ratio_name)} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-slate-50 hover:text-slate-950 ml-1">
                          <Pin className={cn("h-4 w-4", pinned.has(row.ratio_name) && "fill-slate-900 text-slate-900")} />
                        </button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
          {!filtered.length ? <ChartEmpty note="No ratios match the current filters." height={180} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}

export function RatiosWorkspace({
  ticker,
  ratios,
  metadata,
  quote,
  peers,
  readOnly = false,
}: {
  ticker: string;
  ratios: RatioRow[];
  metadata: CompanyMetadata;
  quote: RatiosQuoteRow | null;
  peers: RatiosPeerRow[];
  readOnly?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("snapshot");
  const [activeCategory, setActiveCategory] = useState<ExplorerCategory>("all");
  const [formatMode, setFormatMode] = useState<FormatMode>("compact");
  const storageKey = `portfolioos:pinned-ratios:${ticker}`;
  const [pinned, setPinned] = useState<Set<string>>(() => readPinnedStorage(storageKey));
  const pePeerData = peerMetricData("P/E", ratios, peers);
  const showPePeerChart = pePeerData.some((row) => row.current) && pePeerData.length >= 2;
  const sectorMedians = useMemo(() => buildSectorMedians(ratios, peers), [ratios, peers]);

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
    const header = ["Ratio", "Value", "Period", "Source"];
    const body = rows.map((row) => [
      ratioDisplayName(row),
      row.ratio_value ?? "",
      row.source_period ?? "",
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

  return (
    <div className="space-y-5">
      <RatioHeader
        ticker={ticker}
        ratios={ratios}
        metadata={metadata}
        quote={quote}
        readOnly={readOnly}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        formatMode={formatMode}
        setFormatMode={setFormatMode}
        onExport={() => exportRows(ratios)}
      />

      {activeTab === "snapshot" && (
        <div className="space-y-8 mt-2">
          <KeyRatios
            ratios={ratios}
            formatMode={formatMode}
            onExploreAll={() => { setActiveCategory("key"); setActiveTab("explorer"); }}
          />

          {showPePeerChart ? (
            <BarValueChart
              title={`${ticker} peer P/E`}
              description="Stored same-sector P/E rows from the ratio table."
              data={pePeerData}
              metric="P/E"
            />
          ) : null}
          
          <div className="flex justify-center pt-4">
            <Button variant="outline" onClick={() => setActiveTab("explorer")}>Explore all {ratios.length} ratios</Button>
          </div>
        </div>
      )}

      {activeTab === "explorer" && (
        <div className="space-y-4 mt-2">
          <RatioExplorer
            ticker={ticker}
            ratios={ratios}
            formatMode={formatMode}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            pinned={pinned}
            togglePin={togglePin}
            exportRows={exportRows}
            sectorMedians={sectorMedians}
          />
        </div>
      )}

    </div>
  );
}
