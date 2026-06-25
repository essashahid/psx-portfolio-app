import PDFDocument from "pdfkit/js/pdfkit.standalone";
import type { CompanyReportPayload, AiReportInsight } from "@/lib/company/report";

type Doc = InstanceType<typeof PDFDocument>;
type FinRow = { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null };

const COLORS = {
  ink: "#17202A",
  muted: "#667085",
  line: "#D9DEE7",
  panel: "#F5F7FA",
  primary: "#0B5FFF",
  accent: "#00A676",
  red: "#D92D20",
  navy: "#102A43",
  kse: "#E67E22",
};

const PAGE_BOTTOM = 780;

export async function renderCompanyReportPdf(payload: CompanyReportPayload): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: payload.title, Author: "PortfolioOS PK" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  // Track which pages have real content
  const contentPages = new Set<number>();
  let currentPageIndex = 0;

  function markPage() {
    contentPages.add(currentPageIndex);
  }

  function addContentPage() {
    doc.addPage();
    currentPageIndex++;
    markPage();
  }

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Cover page
    markPage();
    cover(doc, payload);

    // Snapshot page
    addContentPage();
    snapshot(doc, payload);

    // Charts page — only if we have data
    if (payload.charts.price.length > 0 || payload.charts.financialsAnnual.length > 0) {
      addContentPage();
      chartsPage(doc, payload);
    }

    // Tables page — only if we have data
    if (payload.charts.financialsAnnual.length > 0 || payload.charts.financialsQuarterly.length > 0 || payload.charts.dividends.length > 0) {
      addContentPage();
      tablesPage(doc, payload);
    }

    // Filings and news page — only if we have content
    const officialFilings = (payload.evidence.officialFilings as { date: string | null; title: string; category: string }[]) ?? [];
    const independentNews = (payload.evidence.independentNews as { publishedAt: string | null; title: string; source: string | null }[]) ?? [];
    if (officialFilings.length > 0 || independentNews.length > 0) {
      addContentPage();
      filingsAndNewsPage(doc, payload, officialFilings, independentNews);
    }

    // Scenario analysis page — only if we have scenarios
    if (payload.options.include.scenarioAnalysis && payload.scenarios.length >= 3) {
      addContentPage();
      scenarioPage(doc, payload);
    }

    // Peers page — only if we have peer data
    const peers = (payload.evidence.peers as { ticker: string; companyName?: string | null; selectionReason?: string; quote?: { price?: number | null } | null }[]) ?? [];
    if (payload.options.include.peers && peers.length > 0) {
      addContentPage();
      peersPage(doc, payload);
    }

    // Portfolio page — only if held
    const portfolio = payload.evidence.portfolio as { held?: boolean } | undefined;
    if (payload.options.include.portfolio && portfolio?.held) {
      addContentPage();
      portfolioPage(doc, payload);
    }

    // Sources page
    addContentPage();
    sourcesPage(doc, payload);

    // Add page numbers ONLY to content pages
    addPageNumbers(doc, contentPages);

    doc.end();
  });
}

function cover(doc: Doc, payload: CompanyReportPayload) {
  const company = payload.evidence.company as { companyName?: string; sector?: string; exchange?: string } | null;
  const quote = payload.evidence.quote as { price?: number | null; as_of?: string | null; last_fetched_at?: string | null; provider?: string | null } | null;
  doc.rect(0, 0, doc.page.width, 170).fill(COLORS.navy);
  doc.fillColor("#FFFFFF").fontSize(11).font("Helvetica-Bold").text("PortfolioOS PK · Equity Research", 36, 34);
  doc.fontSize(30).text(payload.ticker, 36, 66);
  doc.font("Helvetica").fontSize(15).fillColor("#DCE8FF").text(company?.companyName ?? payload.ticker, 36, 103, { width: 420 });
  doc.fontSize(10).fillColor("#AFC4E8").text(
    `${company?.sector ?? ""} · ${company?.exchange ?? "PSX"} · v${payload.reportVersion} · ${formatDateTime(payload.generatedAt)}`,
    36,
    132
  );

  doc.roundedRect(370, 42, 170, 88, 8).fill("#FFFFFF");
  doc.fillColor(COLORS.muted).fontSize(9).font("Helvetica-Bold").text("CURRENT PRICE", 388, 58);
  doc.fillColor(COLORS.ink).fontSize(24).text(num(quote?.price), 388, 76);
  doc.fillColor(COLORS.muted).fontSize(8).font("Helvetica").text(
    `As of ${quote?.as_of ?? quote?.last_fetched_at ?? "n/a"}`,
    388,
    107,
    { width: 130 }
  );

  doc.fillColor(COLORS.muted).fontSize(9).font("Helvetica").text(
    `Financial values in ${payload.displayUnit}. Sourced interpretation provided by AI model.`,
    36,
    214,
    { width: 500, lineGap: 3 }
  );

  section(doc, "Executive Summary", 36, 250);
  insightList(doc, payload.narrative.executiveSummary, 36, 275, 510);

  section(doc, "Catalysts and Risks", 36, 430);
  twoColumnInsights(doc, "Catalysts", payload.narrative.catalysts, "Risks", payload.narrative.risks, 455);
}

function snapshot(doc: Doc, payload: CompanyReportPayload) {
  pageHeader(doc, payload, "Evidence Snapshot");
  const quote = payload.evidence.quote as { price?: number | null; day_change_pct?: number | null; as_of?: string | null } | null;
  const technicals = payload.evidence.technicals as {
    volatility?: number | null;
    pricePerformance?: Record<string, number | string | null> | null;
    fiftyTwoWeekHigh?: number | null;
    fiftyTwoWeekLow?: number | null;
    rsi?: number | null;
  } | null;
  const valuation = payload.charts.valuation;
  const val = (name: string) => valuation.find((r) => r.name === name)?.value ?? null;

  const cards = [
    ["Price", num(quote?.price), quote?.as_of ?? "latest"],
    ["Day move", pct(quote?.day_change_pct), "provider quote"],
    ["1Y return", pct(technicals?.pricePerformance?.oneYearReturnPct as number | null), "price history"],
    ["Max drawdown", pct(technicals?.pricePerformance?.maxDrawdownPct as number | null), "selected period"],
    ["P/E", num(val("P/E")), "vs peer " + num(valuation.find((r) => r.name === "P/E")?.peerMedian)],
    ["P/B", num(val("P/B")), "deterministic"],
    ["Div yield", pct(val("Dividend yield (TTM)")), "TTM"],
    ["Volatility", pct(technicals?.volatility), "annualized"],
  ];
  cards.forEach((card, i) => metricCard(doc, 36 + (i % 4) * 128, 86 + Math.floor(i / 4) * 82, 116, 62, card[0], card[1], card[2]));

  section(doc, "Recent Developments", 36, 265);
  insightList(doc, payload.narrative.recentDevelopments, 36, 290, 510);

  section(doc, "Data Gaps", 36, 420);
  insightList(doc, payload.narrative.dataGaps, 36, 445, 510);

  // Business overview
  section(doc, "Business Overview", 36, 560);
  insightList(doc, payload.narrative.businessOverview, 36, 585, 510);
}

function chartsPage(doc: Doc, payload: CompanyReportPayload) {
  pageHeader(doc, payload, "Visual Analysis");
  section(doc, "Price History", 36, 78);

  if (payload.charts.price.length >= 2) {
    lineChartWithAxes(doc, payload.charts.price, 36, 104, 505, 200);
  } else {
    noData(doc, 36, 104, 505, 200);
  }

  section(doc, "Annual Financial Trend", 36, 330);
  if (payload.charts.financialsAnnual.length > 0) {
    groupedBarChartWithLabels(doc, payload.charts.financialsAnnual, 36, 358, 505, 170, payload.displayUnit);
  } else {
    noData(doc, 36, 358, 505, 170);
  }
}

function tablesPage(doc: Doc, payload: CompanyReportPayload) {
  pageHeader(doc, payload, "Detailed Tables");
  section(doc, "Annual Financials (" + payload.displayUnit + ")", 36, 78);
  simpleTable(
    doc,
    ["Period", "Revenue", "PAT", "EPS"],
    payload.charts.financialsAnnual.slice(-6).map((r) => [r.period, formatFin(r.revenue), formatFin(r.profitAfterTax), formatFin(r.eps)]),
    36,
    104,
    [128, 128, 128, 92]
  );

  const qTableY = 104 + 20 + payload.charts.financialsAnnual.slice(-6).length * 22 + 30;
  section(doc, "Quarterly (standalone)", 36, qTableY);
  simpleTable(
    doc,
    ["Period", "Revenue", "PAT", "EPS"],
    payload.charts.financialsQuarterly.slice(-6).map((r) => [r.period, formatFin(r.revenue), formatFin(r.profitAfterTax), formatFin(r.eps)]),
    36,
    qTableY + 26,
    [128, 128, 128, 92]
  );

  const dTableY = qTableY + 26 + 20 + payload.charts.financialsQuarterly.slice(-6).length * 22 + 30;
  if (dTableY < PAGE_BOTTOM - 100) {
    section(doc, "Dividends / Payouts", 36, dTableY);
    simpleTable(
      doc,
      ["Date", "Kind", "DPS"],
      payload.charts.dividends.slice(-8).map((r) => [r.date ?? "n/a", r.kind, num(r.dps)]),
      36,
      dTableY + 26,
      [180, 150, 120]
    );
  }
}

function filingsAndNewsPage(
  doc: Doc,
  payload: CompanyReportPayload,
  filings: { date: string | null; title: string; category: string }[],
  news: { publishedAt: string | null; title: string; source: string | null }[]
) {
  pageHeader(doc, payload, "Filings and News");
  let y = 78;

  if (filings.length > 0) {
    section(doc, "Official Company Disclosures", 36, y);
    y += 22;

    // Group filings by category
    const categories = new Map<string, typeof filings>();
    for (const f of filings.slice(0, 12)) {
      const cat = f.category || "other";
      const list = categories.get(cat) ?? [];
      list.push(f);
      categories.set(cat, list);
    }

    for (const [cat, items] of categories) {
      doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(9).text(cat.toUpperCase(), 36, y);
      y += 14;
      for (const f of items) {
        if (y > PAGE_BOTTOM - 30) break;
        doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(
          `${f.date ?? "n/a"} · ${f.title}`,
          48, y, { width: 490 }
        );
        y += doc.heightOfString(`${f.date ?? "n/a"} · ${f.title}`, { width: 490 }) + 6;
      }
      y += 6;
    }
  }

  if (news.length > 0 && y < PAGE_BOTTOM - 80) {
    y += 10;
    section(doc, "Independent Company News", 36, y);
    y += 22;
    for (const n of news.slice(0, 8)) {
      if (y > PAGE_BOTTOM - 30) break;
      const text = `${n.publishedAt?.slice(0, 10) ?? "n/a"} · ${n.source ?? "source"}: ${n.title}`;
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(text, 48, y, { width: 490 });
      y += doc.heightOfString(text, { width: 490 }) + 6;
    }
  }
}

function scenarioPage(doc: Doc, payload: CompanyReportPayload) {
  pageHeader(doc, payload, "Scenario Analysis");
  let y = 78;
  section(doc, "Deterministic Scenario Analysis", 36, y);
  y += 22;

  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(
    "These scenarios are analytical illustrations based on deterministic assumptions, not forecasts or recommendations.",
    36, y, { width: 505 }
  );
  y += 20;

  for (const s of payload.scenarios) {
    if (y > PAGE_BOTTOM - 120) break;

    doc.roundedRect(36, y, 505, 120, 8).fill(COLORS.panel).strokeColor(COLORS.line).stroke();

    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(11).text(
      `${s.label.toUpperCase()} CASE`, 48, y + 10
    );
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(s.notes, 48, y + 26, { width: 480 });

    let ay = y + 44;
    for (const [k, v] of Object.entries(s.assumptions)) {
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8).text(`${k}: ${v}`, 60, ay);
      ay += 14;
      if (ay > y + 100) break;
    }

    doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(9).text(
      `Implied EPS: ${s.impliedEps !== null ? s.impliedEps.toFixed(2) : "n/a"} · Multiple: ${s.impliedValuationMultiple !== null ? s.impliedValuationMultiple.toFixed(1) + "x" : "n/a"}`,
      48, y + 104, { width: 480 }
    );

    y += 130;
  }
}

function peersPage(doc: Doc, payload: CompanyReportPayload) {
  pageHeader(doc, payload, "Peer Comparison");
  const peers = (payload.evidence.peers as { ticker: string; companyName?: string | null; selectionReason?: string; quote?: { price?: number | null } | null; ratios?: { ratio_name: string; ratio_value: number | null }[] }[]) ?? [];
  let y = 78;
  section(doc, "Selected Peers", 36, y);
  y += 22;
  for (const p of peers.slice(0, 5)) {
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(`${p.ticker} — ${p.companyName ?? ""}`, 36, y);
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(p.selectionReason ?? "sector peer", 36, y + 12, { width: 505 });
    y += 32;
  }

  section(doc, "Peer Valuation Table", 36, y + 8);
  const metrics = ["P/E", "P/B", "ROE", "Net margin", "Revenue growth", "Debt-to-equity"];
  const rows: string[][] = [];
  for (const m of metrics) {
    const cells = peers.map((p) => {
      const ratio = (p.ratios ?? []).find((x) => x.ratio_name === m);
      if (ratio?.ratio_value !== null && ratio?.ratio_value !== undefined) {
        return ratio.ratio_value.toFixed(2);
      }
      // Also check chart data
      const chartVal = payload.charts.peers.find((x) => x.ticker === p.ticker && x.metric === m);
      return chartVal?.value !== null && chartVal?.value !== undefined ? chartVal.value.toFixed(2) : "n/a";
    });
    rows.push([m, ...cells]);
  }
  const widths = [80, ...peers.map(() => Math.min(100, Math.floor(440 / peers.length)))].slice(0, 6);
  simpleTable(doc, ["Metric", ...peers.map((p) => p.ticker)], rows, 36, y + 36, widths);
}

function portfolioPage(doc: Doc, payload: CompanyReportPayload) {
  const portfolio = payload.evidence.portfolio as {
    held?: boolean;
    quantity?: number;
    avgCost?: number;
    marketValue?: number;
    unrealizedPl?: number;
    unrealizedPlPct?: number;
    dividendIncome?: number;
    weight?: number;
    totalReturn?: number | null;
    totalReturnAmount?: number | null;
    yieldOnCost?: number | null;
    priceReturnPct?: number | null;
  };
  if (!portfolio?.held) return;

  pageHeader(doc, payload, "Portfolio Position");
  section(doc, "Your Position", 36, 78);
  const cards = [
    ["Shares", num(portfolio.quantity), "held"],
    ["Avg cost", num(portfolio.avgCost), "PKR"],
    ["Market value", num(portfolio.marketValue), "current"],
    ["Unrealized P/L", num(portfolio.unrealizedPl), pct(portfolio.unrealizedPlPct)],
    ["Dividend income", num(portfolio.dividendIncome), "recorded"],
    ["Portfolio weight", pct(portfolio.weight), "of portfolio"],
    ["Price return", pct(portfolio.priceReturnPct), "excl. dividends"],
    ["Total return", pct(portfolio.totalReturn), "incl. dividends"],
    ["Yield on cost", pct(portfolio.yieldOnCost), "dividends / cost"],
  ];
  cards.forEach((card, i) => metricCard(doc, 36 + (i % 3) * 172, 104 + Math.floor(i / 3) * 82, 160, 62, card[0], card[1], card[2]));

  section(doc, "Portfolio Analysis", 36, 370);
  insightList(doc, payload.narrative.portfolio, 36, 395, 510);
}

function sourcesPage(doc: Doc, payload: CompanyReportPayload) {
  pageHeader(doc, payload, "Source Register");
  let y = 80;
  for (const source of payload.sources) {
    if (y > PAGE_BOTTOM - 40) {
      doc.addPage();
      pageHeader(doc, payload, "Source Register");
      y = 80;
    }
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(`[${source.id}] ${source.label}`, 36, y, { width: 505 });
    y += doc.heightOfString(`[${source.id}] ${source.label}`, { width: 505 }) + 2;
    const meta = [source.asOf ? `As of ${source.asOf}` : null, source.url].filter(Boolean).join(" · ");
    if (meta) {
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(meta, 36, y, { width: 505, link: source.url ?? undefined });
      y += 14;
    }
    y += 10;
  }

  // Monitoring checklist
  if (payload.narrative.monitoring.length > 0 && y < PAGE_BOTTOM - 120) {
    y += 10;
    section(doc, "Monitoring Checklist", 36, y);
    y += 22;
    insightList(doc, payload.narrative.monitoring, 36, y, 510);
  }

  doc.fillColor(COLORS.muted).fontSize(8).text(
    "Disclaimer: This report is for informational purposes only and is not investment advice. All financial values and calculations are sourced from official filings and verified market data.",
    36,
    PAGE_BOTTOM - 10,
    { width: 505 }
  );
}

function pageHeader(doc: Doc, payload: CompanyReportPayload, label: string) {
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(payload.ticker, 36, 30);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(label, 92, 31);
  doc.moveTo(36, 56).lineTo(559, 56).strokeColor(COLORS.line).lineWidth(1).stroke();
}

function addPageNumbers(doc: Doc, contentPages: Set<number>) {
  const range = doc.bufferedPageRange();
  const total = contentPages.size;
  let pageNum = 0;
  for (let i = range.start; i < range.start + range.count; i++) {
    if (!contentPages.has(i)) continue;
    pageNum++;
    doc.switchToPage(i);
    doc.fillColor(COLORS.muted).fontSize(8).text(`Page ${pageNum} of ${total}`, 470, 810, { width: 80, align: "right" });
  }
}

function section(doc: Doc, title: string, x: number, y: number) {
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(11).text(title.toUpperCase(), x, y);
}

function insightList(doc: Doc, items: AiReportInsight[], x: number, y: number, width: number) {
  let cursor = y;
  for (const item of items.slice(0, 6)) {
    if (cursor > PAGE_BOTTOM - 30) break;
    doc.circle(x + 4, cursor + 5, 2).fill(COLORS.primary);
    const text = `${item.text} ${cite(item)}`;
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(10).text(text, x + 14, cursor, { width, lineGap: 2 });
    cursor += doc.heightOfString(text, { width }) + 8;
  }
}

function twoColumnInsights(doc: Doc, leftTitle: string, left: AiReportInsight[], rightTitle: string, right: AiReportInsight[], y: number) {
  insightPanel(doc, leftTitle, left, 36, y, 245, 150);
  insightPanel(doc, rightTitle, right, 296, y, 245, 150);
}

function insightPanel(doc: Doc, title: string, items: AiReportInsight[], x: number, y: number, w: number, h: number) {
  doc.roundedRect(x, y, w, h, 8).fill(COLORS.panel).strokeColor(COLORS.line).stroke();
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(title, x + 12, y + 12);
  let cursor = y + 34;
  for (const item of items.slice(0, 4)) {
    const text = `${item.text} ${cite(item)}`;
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.6).text(text, x + 12, cursor, { width: w - 24, lineGap: 1 });
    cursor += doc.heightOfString(text, { width: w - 24 }) + 7;
    if (cursor > y + h - 16) break;
  }
}

function metricCard(doc: Doc, x: number, y: number, w: number, h: number, label: string, value: string, sub: string) {
  doc.roundedRect(x, y, w, h, 7).fill("#FFFFFF").strokeColor(COLORS.line).stroke();
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), x + 10, y + 10, { width: w - 20 });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(16).text(value, x + 10, y + 25, { width: w - 20 });
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(sub, x + 10, y + h - 14, { width: w - 20 });
}

/** Enhanced line chart with Y-axis labels, X-axis dates, and KSE-100 comparison line. */
function lineChartWithAxes(doc: Doc, data: { date: string; close: number; kse100Indexed?: number | null }[], x: number, y: number, w: number, h: number) {
  const chartX = x + 50; // Space for Y-axis labels
  const chartW = w - 60;
  const chartH = h - 30; // Space for X-axis labels

  chartFrame(doc, x, y, w, h);

  if (data.length < 2) return noData(doc, x, y, w, h);

  const values = data.map((d) => d.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-9, max - min);

  const scaleY = (v: number) => y + 10 + chartH - ((v - min) / range) * chartH;
  const scaleX = (i: number) => chartX + (i / (data.length - 1)) * chartW;

  // Y-axis labels
  const yLabels = [min, min + range * 0.5, max];
  for (const val of yLabels) {
    const ly = scaleY(val);
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(
      val.toFixed(0), x + 4, ly - 4, { width: 44, align: "right" }
    );
    // Grid line
    doc.moveTo(chartX, ly).lineTo(chartX + chartW, ly).strokeColor("#E5E7EB").lineWidth(0.5).stroke();
  }

  // X-axis dates
  const xLabels = [0, Math.floor(data.length / 2), data.length - 1];
  for (const idx of xLabels) {
    const d = data[idx];
    if (d) {
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(
        d.date.slice(0, 10), scaleX(idx) - 25, y + chartH + 16, { width: 50, align: "center" }
      );
    }
  }

  // KSE-100 indexed line (draw first so stock line is on top)
  const kseData = data.filter((d) => d.kse100Indexed != null);
  if (kseData.length >= 2) {
    doc.moveTo(scaleX(data.indexOf(kseData[0])), scaleY(kseData[0].kse100Indexed!));
    for (const d of kseData) {
      const i = data.indexOf(d);
      doc.lineTo(scaleX(i), scaleY(d.kse100Indexed!));
    }
    doc.strokeColor(COLORS.kse).lineWidth(1.5).opacity(0.7).stroke();
    doc.opacity(1);
  }

  // Stock price line
  doc.moveTo(scaleX(0), scaleY(data[0].close));
  data.forEach((d, i) => doc.lineTo(scaleX(i), scaleY(d.close)));
  doc.strokeColor(COLORS.primary).lineWidth(2).stroke();

  // Legend
  const legendY = y + 4;
  doc.rect(chartX, legendY, 8, 8).fill(COLORS.primary);
  doc.fillColor(COLORS.muted).fontSize(7).text("Stock Price", chartX + 12, legendY - 1);
  if (kseData.length >= 2) {
    doc.rect(chartX + 80, legendY, 8, 8).fill(COLORS.kse);
    doc.fillColor(COLORS.muted).fontSize(7).text("KSE-100 (indexed)", chartX + 92, legendY - 1);
  }
}

/** Enhanced bar chart with Y-axis scale and growth annotations. */
function groupedBarChartWithLabels(doc: Doc, data: FinRow[], x: number, y: number, w: number, h: number, unit: string) {
  const chartX = x + 50;
  const chartW = w - 60;
  const chartH = h - 30;

  chartFrame(doc, x, y, w, h);
  if (!data.length) return noData(doc, x, y, w, h);

  const values = data.flatMap((d) => [d.revenue, d.profitAfterTax].filter((v): v is number => v !== null));
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);

  // Y-axis labels
  const yLabels = [0, max * 0.5, max];
  for (const val of yLabels) {
    const ly = y + 10 + chartH - (val / max) * chartH;
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(
      formatCompact(val), x + 2, ly - 4, { width: 46, align: "right" }
    );
    doc.moveTo(chartX, ly).lineTo(chartX + chartW, ly).strokeColor("#E5E7EB").lineWidth(0.5).stroke();
  }

  const groupW = chartW / data.length;
  data.forEach((d, i) => {
    const gx = chartX + i * groupW + 8;
    const barBottom = y + 10 + chartH;
    const revH = d.revenue !== null ? (Math.abs(d.revenue) / max) * chartH : 0;
    const patH = d.profitAfterTax !== null ? (Math.abs(d.profitAfterTax) / max) * chartH : 0;
    if (d.revenue !== null) doc.rect(gx, barBottom - revH, Math.max(6, groupW * 0.28), revH).fill(COLORS.primary);
    if (d.profitAfterTax !== null) doc.rect(gx + Math.max(9, groupW * 0.34), barBottom - patH, Math.max(6, groupW * 0.28), patH).fill(COLORS.accent);
    doc.fillColor(COLORS.muted).fontSize(6.5).text(d.period, gx - 4, barBottom + 4, { width: groupW, align: "center" });
  });

  // Unit label
  doc.fillColor(COLORS.muted).fontSize(7).text(unit, x + 2, y + 4, { width: 46 });
  legend(doc, chartX + chartW - 140, y + 4, [["Revenue", COLORS.primary], ["PAT", COLORS.accent]]);
}

function simpleTable(doc: Doc, headers: string[], rows: string[][], x: number, y: number, widths: number[], fontSize = 8.5) {
  let cursor = y;
  const totalW = widths.reduce((a, b) => a + b, 0);
  doc.rect(x, cursor, totalW, 20).fill(COLORS.navy);
  let cx = x;
  headers.forEach((h, i) => {
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(fontSize).text(h, cx + 6, cursor + 6, { width: widths[i] - 12 });
    cx += widths[i];
  });
  cursor += 20;
  rows.forEach((row, ri) => {
    if (cursor > PAGE_BOTTOM - 20) return; // Prevent overflow
    const height = 22;
    doc.rect(x, cursor, totalW, height).fill(ri % 2 ? "#FFFFFF" : COLORS.panel);
    cx = x;
    row.forEach((cell, i) => {
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(fontSize).text(cell, cx + 6, cursor + 6, { width: widths[i] - 12, height: height - 8, ellipsis: true });
      cx += widths[i];
    });
    cursor += height;
  });
}

function chartFrame(doc: Doc, x: number, y: number, w: number, h: number) {
  doc.roundedRect(x, y, w, h, 8).fill("#FFFFFF").strokeColor(COLORS.line).stroke();
}

function noData(doc: Doc, x: number, y: number, w: number, h: number) {
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(10).text("No sourced data available", x, y + h / 2 - 6, { width: w, align: "center" });
}

function legend(doc: Doc, x: number, y: number, items: [string, string][]) {
  let cx = x;
  for (const [label, color] of items) {
    doc.rect(cx, y + 2, 8, 8).fill(color);
    doc.fillColor(COLORS.muted).fontSize(7).text(label, cx + 12, y, { width: 52 });
    cx += 70;
  }
}

function cite(item: AiReportInsight): string {
  return item.citations.length ? `[${item.citations.join(", ")}]` : "";
}

function formatFin(value: number | null): string {
  if (value === null) return "Not reported";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "n/a";
}

function pct(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "n/a";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 16).replace("T", " ");
}
