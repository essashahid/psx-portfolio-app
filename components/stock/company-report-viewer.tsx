"use client";

import { useState } from "react";
import { Download, ChevronDown, ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";
import type { CompanyReportPayload, AiReportInsight } from "@/lib/company/report";
import { formatNumber } from "@/lib/utils";
import { ReportPriceChart } from "@/components/stock/report-price-chart";
import { SectionRefreshButton } from "@/components/stock/section-refresh-button";

function InsightBlock({ title, items }: { title: string; items: AiReportInsight[] }) {
  if (!items.length) return null;
  return (
    <section className="border-b border-border pb-3">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
        {items.map((item, i) => (
          <li key={i}>
            {item.text}
            {item.citations.length > 0 && (
              <span className="text-[10px] text-primary"> [{item.citations.join(", ")}]</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FinTable({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null }[];
  unit: string;
}) {
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold">{title} <span className="text-muted-foreground">({unit})</span></h4>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2">Period</th>
              <th className="py-1 pr-2">Revenue</th>
              <th className="py-1 pr-2">PAT</th>
              <th className="py-1">EPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period} className="border-b border-border/50">
                <td className="py-1 pr-2 font-medium">{r.period}</td>
                <td className="py-1 pr-2 tabular-nums">{fmt(r.revenue)}</td>
                <td className="py-1 pr-2 tabular-nums">{fmt(r.profitAfterTax)}</td>
                <td className="py-1 tabular-nums">{fmt(r.eps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-md border border-border/60 bg-muted/15 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">{m.label}</p>
          <p className="text-base font-bold tabular-nums">{m.value}</p>
          {m.sub && <p className="text-[10px] text-muted-foreground">{m.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function fmt(v: number | null): string {
  if (v === null) return "Not reported";
  return formatNumber(v);
}

function pctFmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(2)}%`;
}

export function CompanyReportViewer({
  payload: initialPayload,
  reportId,
}: {
  payload: CompanyReportPayload;
  reportId: string;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["executive", "financials", "peers", "price", "portfolio"]));

  function toggle(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const company = payload.evidence.company as { companyName?: string; sector?: string } | undefined;
  const peers = (payload.evidence.peers as { ticker: string; companyName?: string | null; selectionReason?: string; ratios?: { ratio_name: string; ratio_value: number | null }[] }[]) ?? [];
  const portfolio = payload.evidence.portfolio as {
    held?: boolean; quantity?: number; avgCost?: number; marketValue?: number;
    unrealizedPl?: number; unrealizedPlPct?: number; dividendIncome?: number;
    weight?: number; yieldOnCost?: number | null; totalReturn?: number | null;
    priceReturnPct?: number | null; totalReturnAmount?: number | null;
  } | undefined;
  const officialFilings = (payload.evidence.officialFilings as { date: string | null; title: string; category: string }[]) ?? [];
  const independentNews = (payload.evidence.independentNews as { title: string; publishedAt?: string | null; source?: string | null }[]) ?? [];

  const allSections = [
    "price", "executive", "business", "financials", "quality", "valuation",
    "dividends", "peers", "filings", "news", "catalysts", "scenarios", "portfolio", "monitoring", "sources"
  ];

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{payload.title}</p>
          <p className="text-[11px] text-muted-foreground">
            v{payload.reportVersion} · {payload.ticker} · {company?.companyName} · {payload.displayUnit}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Validation badge */}
          {payload.validation.passed ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700">
              <AlertCircle className="h-3 w-3" /> Issues
            </span>
          )}
          <a
            href={`/api/reports/company/${reportId}/docx`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
          >
            DOCX
          </a>
          <a
            href={`/api/reports/company/${reportId}/pdf`}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </a>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {allSections.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {id}
          </button>
        ))}
      </nav>

      {/* Validation warnings */}
      {payload.validation.warnings.length > 0 && (
        <div className="border-b border-yellow-200 bg-yellow-50 px-3 py-1.5">
          {payload.validation.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-yellow-700">⚠ {w}</p>
          ))}
        </div>
      )}

      <div className="max-h-[32rem] overflow-y-auto p-3 space-y-1">
        <CollapsibleSection
          id="price"
          title="Price and Benchmark Performance"
          open={openSections.has("price")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="price" onUpdated={setPayload} />}
        >
          <InsightBlock title="" items={payload.narrative.pricePerformance} />
          <ReportPriceChart payload={payload} />
        </CollapsibleSection>

        <CollapsibleSection
          id="executive"
          title="Executive Summary"
          open={openSections.has("executive")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="executive" onUpdated={setPayload} />}
        >
          <InsightBlock title="" items={payload.narrative.executiveSummary} />
        </CollapsibleSection>

        <CollapsibleSection
          id="business"
          title="Company and Business Overview"
          open={openSections.has("business")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="businessOverview" onUpdated={setPayload} />}
        >
          <InsightBlock title="" items={payload.narrative.businessOverview} />
        </CollapsibleSection>

        <CollapsibleSection
          id="financials"
          title="Financial Performance"
          open={openSections.has("financials")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="financials" onUpdated={setPayload} />}
        >
          <InsightBlock title="" items={payload.narrative.financialPerformance} />
          <FinTable title="Annual" rows={payload.charts.financialsAnnual} unit={payload.displayUnit} />
          <FinTable title="Quarterly (standalone)" rows={payload.charts.financialsQuarterly} unit={payload.displayUnit} />
          <FinTable title="Cumulative interim" rows={payload.charts.financialsCumulative} unit={payload.displayUnit} />
        </CollapsibleSection>

        <CollapsibleSection
          id="quality"
          title="Financial Quality"
          open={openSections.has("quality")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="financialQuality" onUpdated={setPayload} />}
        >
          <InsightBlock title="" items={payload.narrative.financialQuality} />
        </CollapsibleSection>

        <CollapsibleSection
          id="valuation"
          title="Valuation"
          open={openSections.has("valuation")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="valuation" onUpdated={setPayload} />}
        >
          <InsightBlock title="" items={payload.narrative.valuation} />
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Metric</th>
                  <th className="py-1">Company</th>
                  <th className="py-1">Peer median</th>
                </tr>
              </thead>
              <tbody>
                {payload.charts.valuation.map((v) => (
                  <tr key={v.name} className="border-t border-border/50">
                    <td className="py-1">{v.name}</td>
                    <td className="py-1 tabular-nums">{v.value ?? "n/a"}</td>
                    <td className="py-1 tabular-nums">{v.peerMedian ?? "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="dividends"
          title="Dividends and Shareholder Returns"
          open={openSections.has("dividends")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="dividends" onUpdated={setPayload} />}
        >
          <InsightBlock title="" items={payload.narrative.dividends} />
          {payload.charts.dividends.length > 0 && (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1">Date</th>
                    <th className="py-1">Kind</th>
                    <th className="py-1">DPS</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.charts.dividends.slice(0, 10).map((d, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1">{d.date ?? "n/a"}</td>
                      <td className="py-1">{d.kind}</td>
                      <td className="py-1 tabular-nums">{d.dps != null ? formatNumber(d.dps) : "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleSection>

        {peers.length > 0 && (
          <CollapsibleSection
            id="peers"
            title="Peer Comparison"
            open={openSections.has("peers")}
            onToggle={toggle}
            refresh={<SectionRefreshButton reportId={reportId} sectionId="peers" onUpdated={setPayload} />}
          >
            <ul className="space-y-2 text-sm">
              {peers.map((p) => (
                <li key={p.ticker}>
                  <span className="font-semibold">{p.ticker}</span> {p.companyName}
                  <p className="text-xs text-muted-foreground">{p.selectionReason}</p>
                </li>
              ))}
            </ul>
            {/* Peer metrics table */}
            {peers.some((p) => (p.ratios ?? []).some((r) => r.ratio_value !== null)) && (
              <div className="overflow-x-auto">
                <table className="mt-3 w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1">Metric</th>
                      {peers.map((p) => <th key={p.ticker} className="py-1">{p.ticker}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {["P/E", "P/B", "ROE", "Net margin", "Revenue growth", "Debt-to-equity"].map((m) => (
                      <tr key={m} className="border-b border-border/50">
                        <td className="py-1 font-medium">{m}</td>
                        {peers.map((p) => {
                          const r = (p.ratios ?? []).find((x) => x.ratio_name === m);
                          return (
                            <td key={p.ticker} className="py-1 tabular-nums">
                              {r?.ratio_value != null ? r.ratio_value.toFixed(2) : "n/a"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleSection>
        )}

        {officialFilings.length > 0 && (
          <CollapsibleSection id="filings" title="Official Disclosures" open={openSections.has("filings")} onToggle={toggle}>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {officialFilings.slice(0, 10).map((f, i) => (
                <li key={i}>{f.date ?? "—"} · <span className="text-primary">{f.category}</span>: {f.title}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          id="catalysts"
          title="Catalysts and Risks"
          open={openSections.has("catalysts")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="catalystsRisks" onUpdated={setPayload} />}
        >
          <InsightBlock title="Catalysts" items={payload.narrative.catalysts} />
          <InsightBlock title="Risks" items={payload.narrative.risks} />
        </CollapsibleSection>

        <CollapsibleSection id="news" title="News and Developments" open={openSections.has("news")} onToggle={toggle} refresh={<SectionRefreshButton reportId={reportId} sectionId="news" onUpdated={setPayload} />}>
          <InsightBlock title="Recent developments" items={payload.narrative.recentDevelopments} />
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {independentNews.slice(0, 8).map((n, i) => (
              <li key={i}>{n.publishedAt?.slice(0, 10) ?? "—"} · {n.source ?? ""}: {n.title}</li>
            ))}
          </ul>
        </CollapsibleSection>

        <CollapsibleSection id="scenarios" title="Scenario Analysis" open={openSections.has("scenarios")} onToggle={toggle}>
          {payload.scenarios.map((s) => (
            <div key={s.label} className="mb-3 text-sm">
              <p className="font-semibold capitalize">{s.label} case</p>
              <p className="text-xs text-muted-foreground">{s.notes}</p>
              <ul className="mt-1 text-xs">
                {Object.entries(s.assumptions).map(([k, v]) => (
                  <li key={k}>{k}: {v}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-primary">
                Implied EPS: {s.impliedEps ?? "n/a"} · Multiple: {s.impliedValuationMultiple ?? "n/a"}
              </p>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection
          id="portfolio"
          title="Portfolio Position"
          open={openSections.has("portfolio")}
          onToggle={toggle}
          refresh={<SectionRefreshButton reportId={reportId} sectionId="portfolio" onUpdated={setPayload} />}
        >
          {portfolio?.held && (
            <MetricGrid metrics={[
              { label: "Shares", value: portfolio.quantity?.toLocaleString() ?? "n/a" },
              { label: "Avg cost", value: `PKR ${portfolio.avgCost?.toFixed(2) ?? "n/a"}` },
              { label: "Market value", value: `PKR ${portfolio.marketValue?.toLocaleString() ?? "n/a"}` },
              { label: "Unrealized P/L", value: `PKR ${portfolio.unrealizedPl?.toLocaleString() ?? "n/a"}`, sub: pctFmt(portfolio.unrealizedPlPct) },
              { label: "Dividends", value: `PKR ${portfolio.dividendIncome?.toLocaleString() ?? "n/a"}` },
              { label: "Price return", value: pctFmt(portfolio.priceReturnPct), sub: "excl. dividends" },
              { label: "Total return", value: pctFmt(portfolio.totalReturn), sub: "incl. dividends" },
              { label: "Yield on cost", value: pctFmt(portfolio.yieldOnCost) },
              { label: "Portfolio weight", value: pctFmt(portfolio.weight) },
            ]} />
          )}
          <div className="mt-3">
            <InsightBlock title="" items={payload.narrative.portfolio} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="monitoring" title="Monitoring Checklist" open={openSections.has("monitoring")} onToggle={toggle}>
          <InsightBlock title="" items={payload.narrative.monitoring} />
        </CollapsibleSection>

        <CollapsibleSection id="sources" title="Sources and Methodology" open={openSections.has("sources")} onToggle={toggle}>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {payload.sources.map((s) => (
              <li key={s.id}>
                <span className="font-semibold text-primary">[{s.id}]</span> {s.label}
                {s.asOf && <span className="text-[10px]"> · {s.asOf}</span>}
              </li>
            ))}
          </ul>
        </CollapsibleSection>

        {/* Data gaps */}
        {payload.narrative.dataGaps.length > 0 && (
          <CollapsibleSection id="datagaps" title="Data Gaps" open={openSections.has("datagaps")} onToggle={toggle}>
            <InsightBlock title="" items={payload.narrative.dataGaps} />
          </CollapsibleSection>
        )}

        <div className="pt-2 text-xs text-muted-foreground">
          <p>Price data: {payload.dataTimestamps.marketPrice?.slice(0, 16) ?? "—"}</p>
          <p>Financials: {payload.dataTimestamps.financialFilings?.slice(0, 16) ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
  refresh,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  refresh?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/60">
      <div className="flex items-center justify-between gap-2 py-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left text-sm font-semibold hover:text-primary"
          onClick={() => onToggle(id)}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {title}
        </button>
        {refresh}
      </div>
      {open && <div className="pb-3 pl-5">{children}</div>}
    </div>
  );
}
