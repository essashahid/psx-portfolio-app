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
};

const PAGE_BOTTOM = 780;

export async function renderCompanyReportPdf(payload: CompanyReportPayload): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: payload.title, Author: "PortfolioOS PK" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    cover(doc, payload);
    snapshot(doc, payload);
    chartsPage(doc, payload);
    tablesPage(doc, payload);
    if (payload.options.include.peers && payload.evidence.peers) peersPage(doc, payload);
    if (payload.options.include.portfolio) portfolioPage(doc, payload);
    sourcesPage(doc, payload);
    trimTrailingBlankPages(doc);
    addPageNumbers(doc);
    doc.end();
  });
}

function cover(doc: Doc, payload: CompanyReportPayload) {
  const company = payload.evidence.company as { companyName?: string; sector?: string; exchange?: string } | null;
  const quote = payload.evidence.quote as { price?: number | null; as_of?: string | null; last_fetched_at?: string | null; provider?: string | null } | null;
  doc.rect(0, 0, doc.page.width, 170).fill(COLORS.navy);
  doc.fillColor("#FFFFFF").fontSize(11).font("Helvetica-Bold").text("PORTFOLIOOS PK EQUITY RESEARCH", 36, 34);
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
    `Financial values in ${payload.displayUnit}. DeepSeek provides cited interpretation only.`,
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
  doc.addPage();
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
}

function chartsPage(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
  pageHeader(doc, payload, "Visual Analysis");
  section(doc, "Price History", 36, 78);
  lineChart(doc, payload.charts.price, 36, 104, 505, 200);

  section(doc, "Annual Financial Trend", 36, 320);
  groupedBarChart(doc, payload.charts.financialsAnnual, 36, 348, 505, 160);
}

function tablesPage(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
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

  section(doc, "Quarterly (standalone)", 36, 280);
  simpleTable(
    doc,
    ["Period", "Revenue", "PAT", "EPS"],
    payload.charts.financialsQuarterly.slice(-6).map((r) => [r.period, formatFin(r.revenue), formatFin(r.profitAfterTax), formatFin(r.eps)]),
    36,
    306,
    [128, 128, 128, 92]
  );

  section(doc, "Dividends / Payouts", 36, 500);
  simpleTable(
    doc,
    ["Date", "Kind", "DPS"],
    payload.charts.dividends.slice(-8).map((r) => [r.date ?? "n/a", r.kind, num(r.dps)]),
    36,
    526,
    [180, 150, 120]
  );
}

function peersPage(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
  pageHeader(doc, payload, "Peer Comparison");
  const peers = (payload.evidence.peers as { ticker: string; companyName?: string | null; selectionReason?: string; quote?: { price?: number | null } | null }[]) ?? [];
  let y = 78;
  section(doc, "Selected Peers", 36, y);
  y += 22;
  for (const p of peers.slice(0, 5)) {
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(`${p.ticker} — ${p.companyName ?? ""}`, 36, y);
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(p.selectionReason ?? "sector peer", 36, y + 12, { width: 505 });
    y += 32;
  }

  section(doc, "Peer Valuation Table", 36, y + 8);
  const metrics = ["P/E", "P/B", "ROE", "Net margin"];
  const rows: string[][] = [];
  for (const m of metrics) {
    const cells = peers.map((p) => {
      const peer = payload.charts.peers.find((x) => x.ticker === p.ticker && x.metric === m);
      return peer?.value !== null && peer?.value !== undefined ? num(peer.value) : "n/a";
    });
    rows.push([m, ...cells]);
  }
  const widths = [80, ...peers.map(() => 100)].slice(0, 6);
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
    yieldOnCost?: number | null;
  };
  if (!portfolio?.held) return;

  doc.addPage();
  pageHeader(doc, payload, "Portfolio Position");
  section(doc, "Your Position", 36, 78);
  const cards = [
    ["Shares", num(portfolio.quantity), "held"],
    ["Avg cost", num(portfolio.avgCost), "PKR"],
    ["Market value", num(portfolio.marketValue), "current"],
    ["Unrealized P/L", num(portfolio.unrealizedPl), pct(portfolio.unrealizedPlPct)],
    ["Dividend income", num(portfolio.dividendIncome), "recorded"],
    ["Portfolio weight", pct(portfolio.weight), "of portfolio"],
    ["Total return", pct(portfolio.totalReturn), "incl. dividends"],
    ["Yield on cost", pct(portfolio.yieldOnCost), "dividends / cost"],
  ];
  cards.forEach((card, i) => metricCard(doc, 36 + (i % 4) * 128, 104 + Math.floor(i / 4) * 82, 116, 62, card[0], card[1], card[2]));

  section(doc, "Portfolio Analysis", 36, 300);
  insightList(doc, payload.narrative.portfolio, 36, 325, 510);
}

function sourcesPage(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
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
  doc.fillColor(COLORS.muted).fontSize(8).text(
    "Disclaimer: This report is for informational purposes only and is not investment advice.",
    36,
    PAGE_BOTTOM - 10,
    { width: 505 }
  );
}

function trimTrailingBlankPages(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start + range.count - 1; i >= range.start; i--) {
    doc.switchToPage(i);
    const content = (doc as unknown as { _pageBuffer?: unknown[] })._pageBuffer;
    if (i > range.start && content && Array.isArray(content) && content.length === 0) {
      // PDFKit doesn't expose easy page delete; avoid drawing on trailing pages instead
    }
  }
}

function pageHeader(doc: Doc, payload: CompanyReportPayload, label: string) {
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(payload.ticker, 36, 30);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(label, 92, 31);
  doc.moveTo(36, 56).lineTo(559, 56).strokeColor(COLORS.line).lineWidth(1).stroke();
}

function addPageNumbers(doc: Doc) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    doc.fillColor(COLORS.muted).fontSize(8).text(`Page ${i - range.start + 1} of ${total}`, 470, 810, { width: 80, align: "right" });
  }
}

function section(doc: Doc, title: string, x: number, y: number) {
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(11).text(title.toUpperCase(), x, y);
}

function insightList(doc: Doc, items: AiReportInsight[], x: number, y: number, width: number) {
  let cursor = y;
  for (const item of items.slice(0, 5)) {
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
  for (const item of items.slice(0, 3)) {
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

function lineChart(doc: Doc, data: { date: string; close: number }[], x: number, y: number, w: number, h: number) {
  chartFrame(doc, x, y, w, h);
  if (data.length < 2) return noData(doc, x, y, w, h);
  const values = data.map((d) => d.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scaleY = (v: number) => y + h - ((v - min) / Math.max(1e-9, max - min)) * h;
  const scaleX = (i: number) => x + (i / (data.length - 1)) * w;
  doc.moveTo(scaleX(0), scaleY(data[0].close));
  data.forEach((d, i) => doc.lineTo(scaleX(i), scaleY(d.close)));
  doc.strokeColor(COLORS.primary).lineWidth(2).stroke();
}

function groupedBarChart(doc: Doc, data: FinRow[], x: number, y: number, w: number, h: number) {
  chartFrame(doc, x, y, w, h);
  if (!data.length) return noData(doc, x, y, w, h);
  const values = data.flatMap((d) => [d.revenue, d.profitAfterTax].filter((v): v is number => v !== null));
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  const groupW = w / data.length;
  data.forEach((d, i) => {
    const gx = x + i * groupW + 8;
    const revH = d.revenue !== null ? (Math.abs(d.revenue) / max) * (h - 24) : 0;
    const patH = d.profitAfterTax !== null ? (Math.abs(d.profitAfterTax) / max) * (h - 24) : 0;
    if (d.revenue !== null) doc.rect(gx, y + h - revH, Math.max(6, groupW * 0.28), revH).fill(COLORS.primary);
    if (d.profitAfterTax !== null) doc.rect(gx + Math.max(9, groupW * 0.34), y + h - patH, Math.max(6, groupW * 0.28), patH).fill(COLORS.accent);
    doc.fillColor(COLORS.muted).fontSize(6.5).text(d.period, gx - 4, y + h + 4, { width: groupW, align: "center" });
  });
  legend(doc, x + w - 140, y - 16, [["Revenue", COLORS.primary], ["PAT", COLORS.accent]]);
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
