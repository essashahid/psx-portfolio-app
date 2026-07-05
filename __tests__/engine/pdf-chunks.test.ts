import { PDFDocument } from "pdf-lib";
import { pdfPageCount, splitPdfPages } from "@/lib/engine/pdf-chunks";

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe("splitPdfPages", () => {
  it("returns the original buffer when it fits in one chunk", async () => {
    const pdf = await makePdf(10);
    const chunks = await splitPdfPages(pdf, 25);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].buf).toBe(pdf);
    expect(chunks[0].firstPage).toBe(1);
    expect(chunks[0].lastPage).toBe(10);
  });

  it("splits into consecutive page ranges with a correct remainder", async () => {
    const pdf = await makePdf(60);
    const chunks = await splitPdfPages(pdf, 25);
    expect(chunks.map((c) => [c.firstPage, c.lastPage])).toEqual([
      [1, 25],
      [26, 50],
      [51, 60],
    ]);
    // every chunk must be a loadable PDF with the right page count
    for (const c of chunks) {
      expect(await pdfPageCount(c.buf)).toBe(c.lastPage - c.firstPage + 1);
    }
  });
});
