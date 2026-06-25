import type { CompanyReportPayload, AiReportInsight, AiReportNarrative } from "./types";

function insights(items: AiReportInsight[]): string[] {
  if (!items.length) return [];
  return items.map((item) => `- ${item.text}${item.citations.length ? ` [${item.citations.join(", ")}]` : ""}`);
}

function fmtMetric(value: unknown, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : "n/a";
}

export function buildReportMarkdown(payload: CompanyReportPayload): string {
  const company = payload.evidence.company as { companyName?: string; sector?: string; exchange?: string } | null;
  const quote = payload.evidence.quote as {
    price?: number | null;
    as_of?: string | null;
    last_fetched_at?: string | null;
  } | null;
  const technicals = payload.evidence.technicals as { pricePerformance?: Record<string, number | string | null> | null } | null;
  const portfolio = payload.evidence.portfolio as {
    held?: boolean; quantity?: number; avgCost?: number; marketValue?: number;
    unrealizedPl?: number; unrealizedPlPct?: number; dividendIncome?: number;
    yieldOnCost?: number | null; totalReturn?: number | null; priceReturnPct?: number | null;
    weight?: number;
  } | undefined;
  const peers = (payload.evidence.peers as { ticker: string; companyName?: string | null; selectionReason?: string; ratios?: { ratio_name: string; ratio_value: number | null }[] }[]) ?? [];

  const lines: string[] = [
    `# ${payload.title}`,
    "",
    `**${payload.ticker}** · ${company?.companyName ?? ""} · ${company?.sector ?? ""} · ${company?.exchange ?? "PSX"}`,
    "",
    `Generated ${payload.generatedAt} · Version ${payload.reportVersion}`,
    "",
    `Unless otherwise stated, financial values are in ${payload.displayUnit}.`,
    "",
    `Current price: PKR ${quote?.price ?? "n/a"} · Updated ${quote?.as_of ?? quote?.last_fetched_at ?? "n/a"}`,
    "",
    "## Executive Summary",
    ...insights(payload.narrative.executiveSummary),
    "",
  ];

  if (payload.options.include.businessOverview) {
    lines.push("## Company and Business Overview", ...insights(payload.narrative.businessOverview), "");
  }

  if (payload.options.include.financials) {
    lines.push(
      "## Financial Performance",
      "",
      ...insights(payload.narrative.financialPerformance),
      "",
      "### Annual history",
      chartTable(payload.charts.financialsAnnual, payload.displayUnit),
      "",
      "### Quarterly (standalone)",
      chartTable(payload.charts.financialsQuarterly, payload.displayUnit),
      "",
      "### Cumulative interim periods",
      chartTable(payload.charts.financialsCumulative, payload.displayUnit),
      ""
    );
  }

  if (payload.options.include.financialQuality) {
    lines.push("## Financial Quality", ...insights(payload.narrative.financialQuality), "");
  }

  if (payload.options.include.valuation) {
    lines.push("## Valuation", ...insights(payload.narrative.valuation), "");
    if (payload.charts.valuation.some((v) => v.value !== null)) {
      lines.push("| Metric | Company | Peer Median |");
      lines.push("| --- | --- | --- |");
      for (const v of payload.charts.valuation) {
        lines.push(`| ${v.name} | ${fmtMetric(v.value)} | ${fmtMetric(v.peerMedian)} |`);
      }
      lines.push("");
    }
  }

  if (payload.options.include.dividends) {
    lines.push("## Dividends and Shareholder Returns", ...insights(payload.narrative.dividends), "");
  }

  if (payload.options.include.pricePerformance) {
    lines.push(
      "## Price and Market Performance",
      ...insights(payload.narrative.pricePerformance),
      `- 1Y return: ${fmtMetric(technicals?.pricePerformance?.oneYearReturnPct, "%")}`,
      `- Max drawdown: ${fmtMetric(technicals?.pricePerformance?.maxDrawdownPct, "%")}`,
      ""
    );
  }

  if (payload.options.include.peers && peers.length) {
    lines.push("## Peer Comparison", "");
    for (const p of peers) {
      lines.push(`- **${p.ticker}** ${p.companyName ?? ""}: ${p.selectionReason ?? "sector peer"}`);
    }
    lines.push("");
    // Add peer metrics table
    const metrics = ["P/E", "P/B", "ROE", "Net margin", "Revenue growth", "Debt-to-equity"];
    lines.push("| Metric | " + peers.map((p) => p.ticker).join(" | ") + " |");
    lines.push("| --- | " + peers.map(() => "---").join(" | ") + " |");
    for (const m of metrics) {
      const vals = peers.map((p) => {
        const r = (p.ratios ?? []).find((x) => x.ratio_name === m);
        return r?.ratio_value != null ? r.ratio_value.toFixed(2) : "n/a";
      });
      lines.push(`| ${m} | ${vals.join(" | ")} |`);
    }
    lines.push("");
  }

  if (payload.options.include.filings) {
    const filings = (payload.evidence.officialFilings as { date: string | null; title: string; category: string }[]) ?? [];
    lines.push("## Official Company Disclosures", "");
    if (!filings.length) lines.push("- No official filings in evidence window.");
    else filings.slice(0, 12).forEach((f) => lines.push(`- ${f.date ?? "n/a"} · ${f.category}: ${f.title}`));
    lines.push("");
  }

  if (payload.options.include.news) {
    const news = (payload.evidence.independentNews as { publishedAt: string | null; title: string; source: string | null }[]) ?? [];
    lines.push("## Independent Company News", "");
    if (!news.length) lines.push("- No verified independent news in selected period.");
    else news.slice(0, 10).forEach((n) => lines.push(`- ${n.publishedAt ?? "n/a"} · ${n.source ?? "source"}: ${n.title}`));
    lines.push("");
  }

  if (payload.options.include.catalystsRisks) {
    lines.push("## Catalysts", ...insights(payload.narrative.catalysts), "", "## Risks", ...insights(payload.narrative.risks), "");
  }

  if (payload.options.include.scenarioAnalysis) {
    lines.push("## Scenario Analysis", "");
    lines.push("_These scenarios are analytical illustrations based on deterministic assumptions, not forecasts._", "");
    for (const s of payload.scenarios) {
      lines.push(`### ${s.label.toUpperCase()} case`);
      lines.push(`- Implied EPS: ${s.impliedEps ?? "n/a"} · Multiple: ${s.impliedValuationMultiple ?? "n/a"}`);
      lines.push(`- ${s.notes}`);
      for (const [k, v] of Object.entries(s.assumptions)) {
        lines.push(`  - ${k}: ${v}`);
      }
      lines.push("");
    }
  }

  if (payload.options.include.portfolio && portfolio?.held) {
    lines.push("## My Portfolio Position", "");
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Shares held | ${portfolio.quantity ?? "n/a"} |`);
    lines.push(`| Average cost | PKR ${fmtMetric(portfolio.avgCost)} |`);
    lines.push(`| Market value | PKR ${fmtMetric(portfolio.marketValue)} |`);
    lines.push(`| Unrealized P/L | PKR ${fmtMetric(portfolio.unrealizedPl)} (${fmtMetric(portfolio.unrealizedPlPct, "%")}) |`);
    lines.push(`| Dividend income | PKR ${fmtMetric(portfolio.dividendIncome)} |`);
    lines.push(`| Yield on cost | ${fmtMetric(portfolio.yieldOnCost, "%")} |`);
    lines.push(`| Price return | ${fmtMetric(portfolio.priceReturnPct, "%")} |`);
    lines.push(`| Total return (incl. dividends) | ${fmtMetric(portfolio.totalReturn, "%")} |`);
    lines.push(`| Portfolio weight | ${fmtMetric(portfolio.weight, "%")} |`);
    lines.push("");
    lines.push(...insights(payload.narrative.portfolio), "");
  }

  if (payload.options.include.monitoring) {
    lines.push("## Monitoring Checklist", ...insights(payload.narrative.monitoring), "");
  }

  lines.push(
    "## Recent Developments",
    ...insights(payload.narrative.recentDevelopments),
    "",
    "## Data Gaps and Limitations",
    ...insights(payload.narrative.dataGaps),
    "",
    "## Sources and Methodology",
    ...payload.sources.map((s) => `- [${s.id}] ${s.label}${s.asOf ? ` (${s.asOf})` : ""}${s.url ? ` — ${s.url}` : ""}`),
    "",
    "_This report uses verified data and cited interpretation. It is not investment advice._"
  );

  return lines.join("\n");
}

function chartTable(rows: { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null }[], unit: string): string {
  if (!rows.length) return "- No sourced data for this period view.";

  const lines = [
    `| Period | Revenue (${unit}) | PAT (${unit}) | EPS (PKR) |`,
    "| --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    lines.push(`| ${r.period} | ${formatVal(r.revenue)} | ${formatVal(r.profitAfterTax)} | ${formatVal(r.eps)} |`);
  }
  return lines.join("\n");
}

function formatVal(v: number | null): string {
  if (v === null) return "Not reported";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function normalizeNarrative(input: Partial<AiReportNarrative>): AiReportNarrative {
  const clean = (items: unknown): AiReportInsight[] =>
    Array.isArray(items)
      ? items
          .map((item) => {
            const x = item as Partial<AiReportInsight>;
            return {
              text: String(x.text ?? "").trim(),
              citations: Array.isArray(x.citations) ? x.citations.map(String).filter(Boolean).slice(0, 4) : [],
            };
          })
          .filter((item) => item.text)
          .slice(0, 8) // Allow up to 8 insights per section (was 6)
      : [];

  return {
    businessOverview: clean(input.businessOverview),
    executiveSummary: clean(input.executiveSummary),
    financialPerformance: clean(input.financialPerformance),
    financialQuality: clean(input.financialQuality),
    valuation: clean(input.valuation),
    dividends: clean(input.dividends),
    pricePerformance: clean(input.pricePerformance),
    catalysts: clean(input.catalysts),
    risks: clean(input.risks),
    recentDevelopments: clean(input.recentDevelopments),
    portfolio: clean(input.portfolio),
    monitoring: clean(input.monitoring),
    dataGaps: clean(input.dataGaps),
  };
}
