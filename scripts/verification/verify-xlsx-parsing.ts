import * as XLSX from "xlsx";
import { parseFile } from "@/lib/import/parse";
import { suggestMapping, detectStatementType } from "@/lib/import/normalize";

(async () => {
  // simulate a broker export with a title row above the header
  const aoa = [
    ["AKD Securities - Holdings Statement", null, null, null, null],
    ["Symbol", "Security Name", "Quantity", "Avg Rate", "Closing Rate"],
    ["MEBL", "Meezan Bank Limited", 500, 215.5, 248.0],
    ["FFC", "Fauji Fertilizer Company Limited", 800, 142.25, 158.4],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Holdings");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const parsed = await parseFile(buf, "statement.xlsx");
  console.log("headers:", parsed.headers);
  console.log("rows:", parsed.rows.length, JSON.stringify(parsed.rows[0]));
  console.log("warnings:", parsed.meta.warnings);
  const mapping = suggestMapping(parsed.headers);
  console.log("mapping:", JSON.stringify(mapping));
  console.log("detected:", detectStatementType(mapping));
})();
