import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import type { CompanyReportPayload } from "@/lib/company/report";

export async function renderCompanyReportDocx(payload: CompanyReportPayload): Promise<Buffer> {
  const company = payload.evidence.company as { companyName?: string; sector?: string } | undefined;
  const children: Paragraph[] = [
    new Paragraph({ text: payload.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({ text: `${payload.ticker} · ${company?.companyName ?? ""} · ${company?.sector ?? ""}`, break: 1 }),
        new TextRun({ text: `Version ${payload.reportVersion} · ${payload.displayUnit}`, break: 1 }),
      ],
    }),
    new Paragraph({ text: "Executive Summary", heading: HeadingLevel.HEADING_1 }),
  ];

  for (const item of payload.narrative.executiveSummary) {
    children.push(new Paragraph({ text: `${item.text} [${item.citations.join(", ")}]` }));
  }

  children.push(new Paragraph({ text: "Financial Performance", heading: HeadingLevel.HEADING_1 }));
  for (const row of payload.charts.financialsAnnual.slice(-6)) {
    children.push(
      new Paragraph({
        text: `${row.period}: Revenue ${row.revenue ?? "N/R"} · PAT ${row.profitAfterTax ?? "N/R"} · EPS ${row.eps ?? "N/R"}`,
      })
    );
  }

  if (payload.narrative.valuation.length) {
    children.push(new Paragraph({ text: "Valuation", heading: HeadingLevel.HEADING_1 }));
    for (const item of payload.narrative.valuation) {
      children.push(new Paragraph({ text: item.text }));
    }
  }

  if (payload.evidence.peers) {
    children.push(new Paragraph({ text: "Peer Comparison", heading: HeadingLevel.HEADING_1 }));
    const peers = payload.evidence.peers as { ticker: string; companyName?: string; selectionReason?: string }[];
    for (const p of peers) {
      children.push(new Paragraph({ text: `${p.ticker} — ${p.selectionReason ?? "sector peer"}` }));
    }
  }

  children.push(new Paragraph({ text: "Sources", heading: HeadingLevel.HEADING_1 }));
  for (const s of payload.sources.slice(0, 30)) {
    children.push(new Paragraph({ text: `[${s.id}] ${s.label}${s.url ? ` — ${s.url}` : ""}` }));
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Disclaimer: Informational only. Not investment advice.", break: 1 })],
    })
  );

  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
