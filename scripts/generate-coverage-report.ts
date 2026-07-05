import { loadEnvLocal } from './load-env';
loadEnvLocal();

/**
 * Full per-stock data coverage + freshness + correctness report.
 * Outputs both JSON (machine-readable, full detail) and CSV (spreadsheet-friendly).
 * Read-only, no LLM calls, no cost.
 */

interface FinRow {
  ticker: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  reported_date: string | null;
  source_type: string | null;
  updated_at: string;
  data: Record<string, unknown>;
}

interface HoldingRow { ticker: string; }
interface RatioCoverageRow { ticker: string; ratio_name: string; ratio_value: number | null; computed_at: string; source_period: string | null; }
interface QuoteCoverageRow { ticker: string; as_of: string | null; last_fetched_at: string | null; }
interface TechnicalCoverageRow { ticker: string; last_fetched_at: string | null; updated_at: string | null; source: string | null; }
interface PayoutCoverageRow { ticker: string; announcement_date: string | null; updated_at: string; }

const num = (d: Record<string, unknown>, k: string): number | null => {
  const v = d[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const pctOff = (actual: number, expected: number): number =>
  expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected);

async function main() {
  const { createAdminClient } = await import('../lib/supabase/admin');
  const { activeUniverseTickers } = await import('../lib/engine/universe');
  const db = createAdminClient();

  const companies = await activeUniverseTickers(db, 'companies');
  const { data: holdingRows } = await db.from('holdings').select('ticker').gt('quantity', 0);
  const holdings = new Set(((holdingRows ?? []) as HoldingRow[]).map((r) => r.ticker.toUpperCase()));

  // Page all financials
  const rows: FinRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('company_financials')
      .select('ticker, fiscal_year, fiscal_period, statement_type, reported_date, source_type, updated_at, data')
      .eq('review_status', 'published')
      .range(from, from + 999);
    if (!data?.length) break;
    rows.push(...(data as FinRow[]));
    if (data.length < 1000) break;
  }

  // Page all ratios (for ratio-coverage count and last-computed timestamp)
  const ratioRows: RatioCoverageRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('company_ratios').select('ticker, ratio_name, ratio_value, computed_at, source_period').range(from, from + 999);
    if (!data?.length) break;
    ratioRows.push(...(data as RatioCoverageRow[]));
    if (data.length < 1000) break;
  }

  // Quotes for last-price-refresh freshness
  const { data: quoteRows } = await db.from('market_quotes').select('ticker, as_of, last_fetched_at');
  const quoteByTicker = new Map(((quoteRows ?? []) as QuoteCoverageRow[]).map((q) => [q.ticker.toUpperCase(), q]));

  // Technicals — RSI/moving-average freshness (own pipeline, not part of the
  // financials/ratios chain, but still "data we have for a stock").
  const { data: techRows } = await db.from('company_technicals').select('ticker, last_fetched_at, updated_at, source');
  const techByTicker = new Map(((techRows ?? []) as TechnicalCoverageRow[]).map((r) => [r.ticker.toUpperCase(), r]));

  // Dividends/payouts — most recent announcement per ticker.
  const payoutRows: PayoutCoverageRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('company_payouts').select('ticker, announcement_date, updated_at').range(from, from + 999);
    if (!data?.length) break;
    payoutRows.push(...(data as PayoutCoverageRow[]));
    if (data.length < 1000) break;
  }
  const payoutByTicker = new Map<string, { announcement_date: string | null; updated_at: string }>();
  for (const p of payoutRows) {
    const t = p.ticker.toUpperCase();
    const cur = payoutByTicker.get(t);
    if (!cur || (p.announcement_date ?? '') > (cur.announcement_date ?? '')) payoutByTicker.set(t, p);
  }

  const byTicker = new Map<string, FinRow[]>();
  for (const r of rows) (byTicker.get(r.ticker) ?? byTicker.set(r.ticker, []).get(r.ticker)!).push(r);

  const ratiosByTicker = new Map<string, typeof ratioRows>();
  for (const r of ratioRows) (ratiosByTicker.get(r.ticker) ?? ratiosByTicker.set(r.ticker, []).get(r.ticker)!).push(r);

  const CURRENT_FY = 2026;

  interface StockReport {
    ticker: string;
    isHolding: boolean;
    incomeStatement: { latestFiscalYear: number | null; latestPeriod: string | null; source: string | null; extractor: string | null; lastUpdated: string | null };
    balanceSheet: { latestFiscalYear: number | null; latestPeriod: string | null; source: string | null; extractor: string | null; lastUpdated: string | null };
    cashFlow: { latestFiscalYear: number | null; latestPeriod: string | null; source: string | null; extractor: string | null; lastUpdated: string | null };
    freshnessStatus: 'current' | 'lagging_deep' | 'stale' | 'no_data';
    ratiosAvailable: number;
    ratiosTotal: number;
    ratiosLastComputed: string | null;
    priceLastFetched: string | null;
    priceAsOf: string | null;
    technicalsLastUpdated: string | null;
    technicalsSource: string | null;
    lastDividendDate: string | null;
    lastDividendRecorded: string | null;
    identityIssues: string[];
  }

  const reports: StockReport[] = [];

  for (const t of companies.sort()) {
    const trs = byTicker.get(t) ?? [];
    const latestOf = (type: string) => {
      const matching = trs.filter((r) => r.statement_type === type);
      if (!matching.length) return { latestFiscalYear: null, latestPeriod: null, source: null, extractor: null, lastUpdated: null };
      matching.sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      const best = matching[0];
      return {
        latestFiscalYear: best.fiscal_year,
        latestPeriod: best.fiscal_period,
        source: best.source_type,
        extractor: typeof best.data._extractor === 'string' ? best.data._extractor : null,
        lastUpdated: best.updated_at,
      };
    };

    const income = latestOf('income_statement');
    const balance = latestOf('balance_sheet');
    const cash = latestOf('cash_flow');

    let freshnessStatus: StockReport['freshnessStatus'] = 'no_data';
    if (trs.length === 0) freshnessStatus = 'no_data';
    else if ((income.latestFiscalYear ?? 0) < CURRENT_FY - 1) freshnessStatus = 'stale';
    else if ((balance.latestFiscalYear ?? 0) < (income.latestFiscalYear ?? 0) || (cash.latestFiscalYear ?? 0) < (income.latestFiscalYear ?? 0) || !balance.latestFiscalYear || !cash.latestFiscalYear) freshnessStatus = 'lagging_deep';
    else freshnessStatus = 'current';

    const ratios = ratiosByTicker.get(t) ?? [];
    const available = ratios.filter((r) => r.ratio_value !== null).length;
    const lastComputed = ratios.length ? ratios.map((r) => r.computed_at).sort().reverse()[0] : null;

    const quote = quoteByTicker.get(t);
    const tech = techByTicker.get(t);
    const payout = payoutByTicker.get(t);

    // Quick identity checks (same logic as the freshness audit, summarized per ticker)
    const issues: string[] = [];
    for (const r of trs) {
      const d = r.data ?? {};
      const label = `${r.fiscal_year} ${r.fiscal_period}`;
      if (r.statement_type === 'balance_sheet') {
        const a = num(d, 'total_assets'), l = num(d, 'total_liabilities'), e = num(d, 'equity');
        if (a !== null && l !== null && e !== null && pctOff(a, l + e) > 0.02) issues.push(`${label}: BS imbalance`);
      }
      if (r.statement_type === 'income_statement') {
        const rev = num(d, 'revenue'), cogs = num(d, 'cost_of_sales'), gp = num(d, 'gross_profit');
        if (rev !== null && cogs !== null && gp !== null && pctOff(gp, rev - Math.abs(cogs)) > 0.02) issues.push(`${label}: gross profit mismatch`);
        const pbt = num(d, 'profit_before_tax'), tax = num(d, 'tax'), pat = num(d, 'profit_after_tax');
        if (pbt !== null && tax !== null && pat !== null) {
          const cands = [pbt - Math.abs(tax), pbt + Math.abs(tax)];
          if (cands.every((c) => pctOff(pat, c) > 0.02)) issues.push(`${label}: PAT irreconcilable`);
        }
      }
    }

    reports.push({
      ticker: t,
      isHolding: holdings.has(t),
      incomeStatement: income,
      balanceSheet: balance,
      cashFlow: cash,
      freshnessStatus,
      ratiosAvailable: available,
      ratiosTotal: ratios.length,
      ratiosLastComputed: lastComputed,
      priceLastFetched: quote?.last_fetched_at ?? null,
      priceAsOf: quote?.as_of ?? null,
      technicalsLastUpdated: tech?.last_fetched_at ?? tech?.updated_at ?? null,
      technicalsSource: tech?.source ?? null,
      lastDividendDate: payout?.announcement_date ?? null,
      lastDividendRecorded: payout?.updated_at ?? null,
      identityIssues: issues,
    });
  }

  // Summary
  const summary = {
    generatedAt: new Date().toISOString(),
    totalLiveCompanies: companies.length,
    byFreshness: {
      current: reports.filter((r) => r.freshnessStatus === 'current').length,
      lagging_deep: reports.filter((r) => r.freshnessStatus === 'lagging_deep').length,
      stale: reports.filter((r) => r.freshnessStatus === 'stale').length,
      no_data: reports.filter((r) => r.freshnessStatus === 'no_data').length,
    },
    withIdentityIssues: reports.filter((r) => r.identityIssues.length > 0).length,
    holdingsWithIssues: reports.filter((r) => r.isHolding && (r.freshnessStatus !== 'current' || r.identityIssues.length > 0)).length,
    withTechnicals: reports.filter((r) => r.technicalsLastUpdated !== null).length,
    withDividendHistory: reports.filter((r) => r.lastDividendDate !== null).length,
  };

  const outDir = '/private/tmp/claude-501/-Users-essaarshad-Downloads-psx-portfolio-app/e9ed7223-9ad4-4958-bb0f-de06f255a8ae/scratchpad';
  const fs = await import('fs');

  fs.writeFileSync(`${outDir}/data-coverage-report.json`, JSON.stringify({ summary, stocks: reports }, null, 2));

  const csvHeader = [
    'ticker', 'is_holding', 'freshness_status',
    'income_fy', 'income_period', 'income_source', 'income_extractor', 'income_last_updated',
    'balance_fy', 'balance_period', 'balance_source', 'balance_extractor', 'balance_last_updated',
    'cashflow_fy', 'cashflow_period', 'cashflow_source', 'cashflow_extractor', 'cashflow_last_updated',
    'ratios_available', 'ratios_total', 'ratios_last_computed',
    'price_as_of', 'price_last_fetched',
    'technicals_last_updated', 'technicals_source',
    'last_dividend_date', 'last_dividend_recorded',
    'identity_issue_count', 'identity_issues',
  ].join(',');
  const csvRows = reports.map((r) => [
    r.ticker, r.isHolding, r.freshnessStatus,
    r.incomeStatement.latestFiscalYear ?? '', r.incomeStatement.latestPeriod ?? '', r.incomeStatement.source ?? '', r.incomeStatement.extractor ?? '', r.incomeStatement.lastUpdated ?? '',
    r.balanceSheet.latestFiscalYear ?? '', r.balanceSheet.latestPeriod ?? '', r.balanceSheet.source ?? '', r.balanceSheet.extractor ?? '', r.balanceSheet.lastUpdated ?? '',
    r.cashFlow.latestFiscalYear ?? '', r.cashFlow.latestPeriod ?? '', r.cashFlow.source ?? '', r.cashFlow.extractor ?? '', r.cashFlow.lastUpdated ?? '',
    r.ratiosAvailable, r.ratiosTotal, r.ratiosLastComputed ?? '',
    r.priceAsOf ?? '', r.priceLastFetched ?? '',
    r.technicalsLastUpdated ?? '', r.technicalsSource ?? '',
    r.lastDividendDate ?? '', r.lastDividendRecorded ?? '',
    r.identityIssues.length, `"${r.identityIssues.join(' | ').replace(/"/g, '""')}"`,
  ].join(','));
  fs.writeFileSync(`${outDir}/data-coverage-report.csv`, [csvHeader, ...csvRows].join('\n'));

  console.log('Wrote:');
  console.log(`  ${outDir}/data-coverage-report.json`);
  console.log(`  ${outDir}/data-coverage-report.csv`);
  console.log('\nSummary:', JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
