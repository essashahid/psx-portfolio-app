// Layout-aware PDF text extraction.
//
// pdf-parse's getText() emits text in the PDF's internal reading order, which
// for AKD documents scatters a table into separate column blocks (all
// quantities, then all rates, ...). pdfjs-dist (already a dependency of
// pdf-parse) exposes each text fragment's x/y position, so the true visual
// rows can be rebuilt: cluster fragments by y, sort each cluster by x, and a
// table row comes back as one line in column order. Parsers get real rows
// like "SYS 70 133.6100 9,369.18 14.03 ..." instead of the scrambled stream.

import { ensurePdfGlobals } from "@/lib/import/pdf-globals";

interface TextFragment {
  x: number;
  y: number;
  str: string;
}

// Fragments whose baselines differ by no more than this are the same row.
const ROW_Y_TOLERANCE = 2.5;

export async function extractPdfLayoutText(buffer: Buffer | Uint8Array): Promise<string> {
  await ensurePdfGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;

  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const fragments: TextFragment[] = [];
      for (const item of content.items) {
        if ("str" in item && item.str.trim()) {
          fragments.push({ x: item.transform[4], y: item.transform[5], str: item.str.trim() });
        }
      }

      const rows: { y: number; items: TextFragment[] }[] = [];
      for (const frag of fragments.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const row = rows.find((r) => Math.abs(r.y - frag.y) <= ROW_Y_TOLERANCE);
        if (row) row.items.push(frag);
        else rows.push({ y: frag.y, items: [frag] });
      }
      rows.sort((a, b) => b.y - a.y);

      pages.push(
        rows
          .map((r) =>
            r.items
              .sort((a, b) => a.x - b.x)
              .map((i) => i.str)
              .join(" ")
          )
          .join("\n")
      );
    }
  } finally {
    await doc.destroy();
  }
  return pages.join("\n\n");
}
