import PDFDocument from "pdfkit";
import type { CompanyReportPayload, AiReportInsight } from "@/lib/company/report";

type Doc = InstanceType<typeof PDFDocument>;

const COLORS = {
  ink: "#17202A",
  muted: "#667085",
  line: "#D9DEE7",
  panel: "#F5F7FA",
  primary: "#0B5FFF",
  accent: "#00A676",
  amber: "#D97706",
  red: "#D92D20",
  navy: "#102A43",
};

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
    sourcesPage(doc, payload);
    addPageNumbers(doc);
    doc.end();
  });
}

function cover(doc: Doc, payload: CompanyReportPayload) {
  const company = payload.evidence.company as { companyName?: string | null; sector?: string | null; exchange?: string | null } | null;
  const quote = payload.evidence.quote as { price?: number | null; as_of?: string | null; last_fetched_at?: string | null; provider?: string | null } | null;
  doc.rect(0, 0, doc.page.width, 170).fill(COLORS.navy);
  doc.fillColor("#FFFFFF").fontSize(11).font("Helvetica-Bold").text("PORTFOLIOOS PK EQUITY RESEARCH", 36, 34);
  doc.fontSize(30).text(payload.ticker, 36, 66);
  doc.font("Helvetica").fontSize(15).fillColor("#DCE8FF").text(company?.companyName ?? "Company name unavailable", 36, 103, { width: 420 });
  doc.fontSize(10).fillColor("#AFC4E8").text(`${company?.sector ?? "Sector unavailable"} · ${company?.exchange ?? "PSX"} · Generated ${formatDateTime(payload.generatedAt)}`, 36, 132);

  doc.roundedRect(370, 42, 170, 88, 8).fill("#FFFFFF");
  doc.fillColor(COLORS.muted).fontSize(9).font("Helvetica-Bold").text("CURRENT PRICE", 388, 58);
  doc.fillColor(COLORS.ink).fontSize(24).text(num(quote?.price), 388, 76);
  doc.fillColor(COLORS.muted).fontSize(8).font("Helvetica").text(`As of ${quote?.as_of ?? quote?.last_fetched_at ?? "n/a"} via ${quote?.provider ?? "provider n/a"}`, 388, 107, { width: 130 });

  doc.fillColor(COLORS.ink).fontSize(12).font("Helvetica-Bold").text("Fact Standard", 36, 214);
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text(
    "Generated using verified market data, financial statements, official filings and recent news available as of the timestamp above. DeepSeek is used only for cited interpretation; all figures, charts and tables are deterministic.",
    36,
    235,
    { width: 500, lineGap: 3 }
  );

  section(doc, "Executive Summary", 36, 305);
  insightList(doc, payload.narrative.executiveSummary, 36, 330, 510);

  const y = 455;
  section(doc, "Key Observations", 36, y);
  twoColumnInsights(doc, "Supported positives", payload.narrative.positives, "Risks / constraints", payload.narrative.risks, y + 25);
}

function snapshot(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
  pageHeader(doc, payload, "Evidence Snapshot");
  const quote = payload.evidence.quote as { price?: number | null; day_change_pct?: number | null; volume?: number | null; as_of?: string | null } | null;
  const technicals = payload.evidence.technicals as { volatility?: number | null; pricePerformance?: Record<string, number | string | null> | null; fiftyTwoWeekHigh?: number | null; fiftyTwoWeekLow?: number | null; rsi?: number | null } | null;
  const ratios = payload.charts.ratios;
  const ratio = (name: string) => ratios.find((r) => r.name === name)?.value ?? null;

  const cards = [
    ["Price", num(quote?.price), quote?.as_of ?? "latest provider timestamp"],
    ["Day move", pct(quote?.day_change_pct), "provider quote"],
    ["1Y return", pct(technicals?.pricePerformance?.oneYearReturnPct as number | null), "price history"],
    ["Max drawdown", pct(technicals?.pricePerformance?.maxDrawdownPct as number | null), "selected period"],
    ["P/E", num(ratio("P/E")), "deterministic ratio"],
    ["P/B", num(ratio("P/B")), "deterministic ratio"],
    ["Div yield", pct(ratio("Dividend yield (TTM)")), "TTM cash DPS"],
    ["Volatility", pct(technicals?.volatility), "annualized"],
  ];
  cards.forEach((card, i) => metricCard(doc, 36 + (i % 4) * 128, 86 + Math.floor(i / 4) * 82, 116, 62, card[0], card[1], card[2]));

  section(doc, "DeepSeek Insights, Cited", 36, 265);
  twoColumnInsights(doc, "Recent developments", payload.narrative.recentDevelopments, "Data gaps", payload.narrative.dataGaps, 292);

  section(doc, "Price Range", 36, 485);
  metricCard(doc, 36, 512, 160, 56, "52-week high", num(technicals?.fiftyTwoWeekHigh), "PSX price history");
  metricCard(doc, 212, 512, 160, 56, "52-week low", num(technicals?.fiftyTwoWeekLow), "PSX price history");
  metricCard(doc, 388, 512, 152, 56, "RSI", num(technicals?.rsi), "14-day");
}

function chartsPage(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
  pageHeader(doc, payload, "Visual Analysis");
  section(doc, "Price History", 36, 78);
  lineChart(doc, payload.charts.price, 36, 104, 505, 185);

  section(doc, "Financial Trend", 36, 330);
  groupedBarChart(doc, payload.charts.financials, 36, 358, 505, 170);

  section(doc, "Valuation and Quality Ratios", 36, 568);
  ratioBars(doc, payload.charts.ratios.slice(0, 8), 36, 592, 505, 150);
}

function tablesPage(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
  pageHeader(doc, payload, "Detailed Tables");
  section(doc, "Latest Financials", 36, 78);
  simpleTable(
    doc,
    ["Period", "Revenue", "PAT", "EPS"],
    payload.charts.financials.slice(-6).map((r) => [r.period, num(r.revenue), num(r.profitAfterTax), num(r.eps)]),
    36,
    104,
    [128, 128, 128, 92]
  );

  section(doc, "Dividends / Payouts", 36, 310);
  simpleTable(
    doc,
    ["Date", "Kind", "DPS"],
    payload.charts.dividends.slice(-8).map((r) => [r.date ?? "n/a", r.kind, num(r.dps)]),
    36,
    336,
    [180, 150, 120]
  );

  section(doc, "Recent News and Filings", 36, 525);
  const evidence = payload.evidence as { news?: { title: string; source: string | null; publishedAt: string | null }[]; filings?: { title: string; date: string | null; category: string }[] };
  simpleTable(
    doc,
    ["Date", "Type", "Headline"],
    [
      ...(evidence.filings ?? []).slice(0, 5).map((f) => [f.date ?? "n/a", f.category ?? "filing", f.title]),
      ...(evidence.news ?? []).slice(0, 5).map((n) => [n.publishedAt ?? "n/a", n.source ?? "news", n.title]),
    ],
    36,
    552,
    [78, 88, 338],
    9
  );
}

function sourcesPage(doc: Doc, payload: CompanyReportPayload) {
  doc.addPage();
  pageHeader(doc, payload, "Source Register");
  let y = 80;
  for (const source of payload.sources) {
    if (y > 745) {
      doc.addPage();
      pageHeader(doc, payload, "Source Register");
      y = 80;
    }
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(`[${source.id}] ${source.label}`, 36, y, { width: 505 });
    y += doc.heightOfString(`[${source.id}] ${source.label}`, { width: 505 }) + 2;
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text([source.asOf ? `As of ${source.asOf}` : null, source.url].filter(Boolean).join(" · "), 36, y, { width: 505 });
    y += 24;
  }
}

function pageHeader(doc: Doc, payload: CompanyReportPayload, label: string) {
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(payload.ticker, 36, 30);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(label, 92, 31);
  doc.moveTo(36, 56).lineTo(559, 56).strokeColor(COLORS.line).lineWidth(1).stroke();
}

function addPageNumbers(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(COLORS.muted).fontSize(8).text(`Page ${i + 1} of ${range.count}`, 470, 810, { width: 80, align: "right" });
  }
}

function section(doc: Doc, title: string, x: number, y: number) {
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(11).text(title.toUpperCase(), x, y);
}

function insightList(doc: Doc, items: AiReportInsight[], x: number, y: number, width: number) {
  let cursor = y;
  for (const item of items.slice(0, 6)) {
    doc.circle(x + 4, cursor + 5, 2).fill(COLORS.primary);
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(10).text(`${item.text} ${cite(item)}`, x + 14, cursor, { width, lineGap: 2 });
    cursor += doc.heightOfString(`${item.text} ${cite(item)}`, { width }) + 10;
  }
}

function twoColumnInsights(doc: Doc, leftTitle: string, left: AiReportInsight[], rightTitle: string, right: AiReportInsight[], y: number) {
  insightPanel(doc, leftTitle, left, 36, y, 245, 170);
  insightPanel(doc, rightTitle, right, 296, y, 245, 170);
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

function lineChart(doc: Doc, data: { date: string; close: number; volume: number }[], x: number, y: number, w: number, h: number) {
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
  doc.fillColor(COLORS.muted).fontSize(8).text(num(max), x, y - 12);
  doc.text(num(min), x, y + h + 4);
  doc.text(`${data[0].date} to ${data[data.length - 1].date}`, x + 130, y + h + 4, { width: 220, align: "center" });
}

function groupedBarChart(doc: Doc, data: CompanyReportPayload["charts"]["financials"], x: number, y: number, w: number, h: number) {
  chartFrame(doc, x, y, w, h);
  if (!data.length) return noData(doc, x, y, w, h);
  const max = Math.max(...data.flatMap((d) => [Math.abs(d.revenue ?? 0), Math.abs(d.profitAfterTax ?? 0)]), 1);
  const groupW = w / data.length;
  data.forEach((d, i) => {
    const gx = x + i * groupW + 8;
    const revH = ((d.revenue ?? 0) / max) * (h - 24);
    const patH = ((d.profitAfterTax ?? 0) / max) * (h - 24);
    doc.rect(gx, y + h - revH, Math.max(6, groupW * 0.28), revH).fill(COLORS.primary);
    doc.rect(gx + Math.max(9, groupW * 0.34), y + h - patH, Math.max(6, groupW * 0.28), patH).fill(COLORS.accent);
    doc.fillColor(COLORS.muted).fontSize(6.5).text(d.period, gx - 4, y + h + 4, { width: groupW, align: "center" });
  });
  legend(doc, x + w - 140, y - 16, [["Revenue", COLORS.primary], ["PAT", COLORS.accent]]);
}

function ratioBars(doc: Doc, data: CompanyReportPayload["charts"]["ratios"], x: number, y: number, w: number, h: number) {
  if (!data.length) return noData(doc, x, y, w, h);
  const rowH = h / data.length;
  const max = Math.max(...data.map((d) => Math.abs(d.value ?? 0)), 1);
  data.forEach((d, i) => {
    const yy = y + i * rowH;
    doc.fillColor(COLORS.ink).fontSize(7.5).text(d.name, x, yy + 2, { width: 110 });
    doc.rect(x + 118, yy + 3, w - 180, 8).fill("#E8EDF5");
    if (d.value !== null) doc.rect(x + 118, yy + 3, ((w - 180) * Math.abs(d.value)) / max, 8).fill(d.value >= 0 ? COLORS.primary : COLORS.red);
    doc.fillColor(COLORS.muted).fontSize(7.5).text(d.value !== null ? num(d.value) : "n/a", x + w - 54, yy + 1, { width: 50, align: "right" });
  });
}

function simpleTable(doc: Doc, headers: string[], rows: string[][], x: number, y: number, widths: number[], fontSize = 8.5) {
  let cursor = y;
  doc.rect(x, cursor, widths.reduce((a, b) => a + b, 0), 20).fill(COLORS.navy);
  let cx = x;
  headers.forEach((h, i) => {
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(fontSize).text(h, cx + 6, cursor + 6, { width: widths[i] - 12 });
    cx += widths[i];
  });
  cursor += 20;
  rows.forEach((row, ri) => {
    const height = 24;
    doc.rect(x, cursor, widths.reduce((a, b) => a + b, 0), height).fill(ri % 2 ? "#FFFFFF" : COLORS.panel);
    cx = x;
    row.forEach((cell, i) => {
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(fontSize).text(cell, cx + 6, cursor + 7, { width: widths[i] - 12, height: height - 8, ellipsis: true });
      cx += widths[i];
    });
    cursor += height;
  });
}

function chartFrame(doc: Doc, x: number, y: number, w: number, h: number) {
  doc.roundedRect(x, y, w, h, 8).fill("#FFFFFF").strokeColor(COLORS.line).stroke();
  for (let i = 1; i < 4; i++) {
    const yy = y + (h * i) / 4;
    doc.moveTo(x, yy).lineTo(x + w, yy).strokeColor("#EEF1F6").lineWidth(0.5).stroke();
  }
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
