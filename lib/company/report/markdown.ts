import type { CompanyReportPayload, AiReportInsight, AiReportNarrative } from "./types";

function insights(items: AiReportInsight[]): string[] {
  if (!items.length) return ["- Not available in sourced evidence for this section."];
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
  const portfolio = payload.evidence.portfolio as { held?: boolean; quantity?: number } | undefined;
  const peers = (payload.evidence.peers as { ticker: string; companyName?: string | null; selectionReason?: string }[]) ?? [];

  const lines: string[] = [
    `# ${payload.title}`,
    "",
    `**${payload.ticker}** · ${company?.companyName ?? ""} · ${company?.sector ?? ""} · ${company?.exchange ?? "PSX"}`,
    "",
    `Generated ${payload.generatedAt} · Version ${payload.reportVersion} · Financial values in ${payload.displayUnit}`,
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
      `Unless otherwise stated, values are in ${payload.displayUnit}.`,
      ...insights(payload.narrative.financialPerformance),
      "",
      "### Annual history",
      chartTable(payload.charts.financialsAnnual),
      "",
      "### Quarterly (standalone)",
      chartTable(payload.charts.financialsQuarterly),
      "",
      "### Cumulative interim periods",
      chartTable(payload.charts.financialsCumulative),
      ""
    );
  }

  if (payload.options.include.financialQuality) {
    lines.push("## Financial Quality", ...insights(payload.narrative.financialQuality), "");
  }

  if (payload.options.include.valuation) {
    lines.push("## Valuation", ...insights(payload.narrative.valuation), "");
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
    lines.push("## My Portfolio Position", ...insights(payload.narrative.portfolio), "");
  }

  if (payload.options.include.monitoring) {
    lines.push("## Monitoring Checklist", ...insights(payload.narrative.monitoring), "");
  }

  lines.push(
    "## Recent Developments",
    ...insights(payload.narrative.recentDevelopments),
    "",
    "## Data Gaps",
    ...insights(payload.narrative.dataGaps),
    "",
    "## Sources and Methodology",
    ...payload.sources.map((s) => `- [${s.id}] ${s.label}${s.asOf ? ` (${s.asOf})` : ""}${s.url ? ` — ${s.url}` : ""}`),
    "",
    "_This report uses verified data and cited interpretation. It is not investment advice._"
  );

  return lines.join("\n");
}

function chartTable(rows: { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null }[]): string {
  if (!rows.length) return "- No sourced data for this period view.";
  return rows
    .map(
      (r) =>
        `- ${r.period}: Revenue ${formatVal(r.revenue)} · PAT ${formatVal(r.profitAfterTax)} · EPS ${formatVal(r.eps)}`
    )
    .join("\n");
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
          .slice(0, 6)
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
