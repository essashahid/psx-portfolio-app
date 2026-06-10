import { createHash } from "crypto";
import { z } from "zod";
import { parseDateLoose, parseNumberLoose } from "@/lib/utils";
import type { NormalizedRow, StatementType, TxnType } from "@/lib/types";

// ---------------------------------------------------------------------------
// Canonical fields and header synonyms (AKD / CDC / generic broker exports)
// ---------------------------------------------------------------------------

import { CANONICAL_FIELDS, type CanonicalField } from "@/lib/import/fields";

export { CANONICAL_FIELDS, type CanonicalField };

const HEADER_SYNONYMS: Record<CanonicalField, string[]> = {
  ticker: ["ticker", "symbol", "scrip", "scrip code", "scrip symbol", "code", "security symbol", "stock", "share code", "kse code"],
  company_name: ["company", "company name", "name", "security", "security name", "scrip name", "share name", "name of security"],
  sector: ["sector", "industry", "sector name"],
  quantity: ["quantity", "qty", "volume", "shares", "no of shares", "number of shares", "holding", "current holding", "balance qty", "qty balance", "share balance", "free volume", "physical volume", "total volume", "position owned", "position", "owned", "total position", "net position"],
  avg_cost: ["avg cost", "average cost", "avg rate", "average rate", "avg price", "average price", "cost rate", "cost price", "unit cost", "purchase rate", "wac", "weighted average cost"],
  market_price: ["market price", "market rate", "closing rate", "closing price", "close", "last price", "last rate", "current price", "current rate", "price", "ltp", "rate per share"],
  market_value: ["market value", "current value", "value", "valuation", "market val", "value at market"],
  total_cost: ["total cost", "cost value", "cost amount", "investment", "invested amount", "total investment", "cost"],
  trade_date: ["trade date", "transaction date", "txn date", "deal date", "order date"],
  settlement_date: ["settlement date", "settle date", "value date", "clearing date"],
  type: ["type", "transaction type", "txn type", "trade type", "nature", "buy/sell", "b/s", "side", "activity", "transaction nature"],
  price: ["rate", "trade rate", "deal rate", "execution price", "trade price", "price per share"],
  gross_amount: ["gross amount", "gross", "gross value", "amount", "trade value"],
  commission: ["commission", "comm", "brokerage", "broker commission", "comm amount", "charges"],
  tax: ["tax", "wht", "cvt", "fed", "sst", "cgt", "tax amount", "withholding tax", "advance tax"],
  net_amount: ["net amount", "net", "net value", "net payable", "net receivable", "total amount", "payable/receivable"],
  dividend_amount: ["dividend", "dividend amount", "cash dividend", "div amount", "dividend paid", "net dividend"],
  cash_balance: ["cash balance", "running balance", "ledger balance", "available balance"],
  description: ["description", "narration", "details", "particulars", "remarks", "memo"],
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();
}

// Synonyms pass through the same normalization as headers so entries like
// "buy/sell" still match the header "Buy/Sell".
const NORMALIZED_SYNONYMS: Record<CanonicalField, string[]> = Object.fromEntries(
  Object.entries(HEADER_SYNONYMS).map(([field, syns]) => [field, syns.map(normHeader)])
) as Record<CanonicalField, string[]>;

/** Suggests a header -> canonical field mapping. User can override in the UI. */
export function suggestMapping(headers: string[]): Record<string, CanonicalField | null> {
  const mapping: Record<string, CanonicalField | null> = {};
  const used = new Set<CanonicalField>();
  // exact synonym matches first, then substring matches
  for (const pass of ["exact", "fuzzy"] as const) {
    for (const header of headers) {
      if (mapping[header] !== undefined && mapping[header] !== null) continue;
      const n = normHeader(header);
      let found: CanonicalField | null = null;
      for (const field of CANONICAL_FIELDS) {
        if (used.has(field)) continue;
        const syns = NORMALIZED_SYNONYMS[field];
        const hit =
          pass === "exact"
            ? syns.includes(n)
            : syns.some((s) => n.includes(s) || (s.length > 4 && s.includes(n) && n.length > 3));
        if (hit) {
          found = field;
          break;
        }
      }
      if (found) {
        mapping[header] = found;
        used.add(found);
      } else if (pass === "fuzzy") {
        mapping[header] = mapping[header] ?? null;
      }
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Statement type detection
// ---------------------------------------------------------------------------

export function detectStatementType(
  mapping: Record<string, CanonicalField | null>
): StatementType {
  const fields = new Set(Object.values(mapping).filter(Boolean));
  const hasTxn = fields.has("type") && (fields.has("trade_date") || fields.has("settlement_date"));
  if (hasTxn && (fields.has("price") || fields.has("quantity") || fields.has("net_amount"))) {
    return "trades";
  }
  if (fields.has("dividend_amount") || (fields.has("cash_balance") && !fields.has("quantity"))) {
    return "dividends";
  }
  if (
    fields.has("ticker") &&
    fields.has("quantity") &&
    !fields.has("type") &&
    !fields.has("settlement_date") &&
    (!fields.has("trade_date") || fields.has("market_price") || fields.has("market_value") || fields.has("avg_cost"))
  ) {
    return "holdings";
  }
  if (fields.has("ticker") || fields.has("company_name")) return "generic";
  return "generic";
}

// ---------------------------------------------------------------------------
// Transaction type normalization
// ---------------------------------------------------------------------------

const TXN_PATTERNS: [RegExp, TxnType][] = [
  [/\b(buy|bought|purchase|pur|b)\b/i, "BUY"],
  [/\b(sell|sold|sale|sl|s)\b/i, "SELL"],
  [/\b(dividend|div|cash div)\b/i, "DIVIDEND"],
  [/\b(deposit|cash in|credit|funds? received|cr)\b/i, "CASH_IN"],
  [/\b(withdraw|withdrawal|cash out|debit|payment|dr)\b/i, "CASH_OUT"],
  [/\b(fee|charge|cdc charge|annual fee|service charge)\b/i, "FEE"],
  [/\b(tax|wht|cvt|cgt|fed)\b/i, "TAX"],
  [/\b(bonus)\b/i, "BONUS"],
  [/\b(right|rights)\b/i, "RIGHT"],
  [/\b(split|sub-?division)\b/i, "SPLIT"],
];

export function normalizeTxnType(raw: unknown): TxnType {
  if (raw === null || raw === undefined) return "UNKNOWN";
  const s = String(raw).trim();
  if (!s) return "UNKNOWN";
  if (/^b$/i.test(s)) return "BUY";
  if (/^s$/i.test(s)) return "SELL";
  for (const [re, type] of TXN_PATTERNS) {
    if (re.test(s)) return type;
  }
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Row normalization + validation
// ---------------------------------------------------------------------------

const TICKER_RE = /^[A-Z0-9]{2,10}$/;

export function normalizeRow(
  raw: Record<string, unknown>,
  mapping: Record<string, CanonicalField | null>
): NormalizedRow {
  const out: NormalizedRow = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (!field) continue;
    const value = raw[header];
    switch (field) {
      case "ticker": {
        const t = value ? String(value).trim().toUpperCase().replace(/\s+/g, "") : null;
        out.ticker = t && TICKER_RE.test(t) ? t : t || null;
        break;
      }
      case "company_name":
      case "sector":
      case "description":
        out[field] = value ? String(value).trim() : null;
        break;
      case "trade_date":
      case "settlement_date":
        out[field] = parseDateLoose(value);
        break;
      case "type":
        out.type = normalizeTxnType(value);
        break;
      default:
        out[field] = parseNumberLoose(value);
    }
  }
  // If no explicit type column, infer from description
  if (!out.type && out.description) out.type = normalizeTxnType(out.description);
  // Derive missing numbers where safe
  if (out.quantity != null && out.avg_cost != null && out.total_cost == null) {
    out.total_cost = out.quantity * out.avg_cost;
  }
  if (out.quantity != null && out.total_cost != null && out.avg_cost == null && out.quantity > 0) {
    out.avg_cost = out.total_cost / out.quantity;
  }
  if (out.quantity != null && out.market_price != null && out.market_value == null) {
    out.market_value = out.quantity * out.market_price;
  }
  return out;
}

export interface ValidatedRow {
  normalized: NormalizedRow;
  status: "valid" | "warning" | "invalid";
  issues: string[];
  rowHash: string;
}

const holdingsRowSchema = z.object({
  ticker: z.string().regex(TICKER_RE, "Ticker should be 2-10 uppercase letters/digits"),
  quantity: z.number().positive("Quantity must be positive"),
});

const tradeRowSchema = z.object({
  ticker: z.string().regex(TICKER_RE),
  type: z.string(),
  quantity: z.number().positive().nullable().optional(),
});

export function validateRow(
  normalized: NormalizedRow,
  statementType: StatementType
): ValidatedRow {
  const issues: string[] = [];
  let status: ValidatedRow["status"] = "valid";

  const hashSource = JSON.stringify({
    t: normalized.ticker ?? null,
    q: normalized.quantity ?? null,
    ac: normalized.avg_cost ?? null,
    d: normalized.trade_date ?? null,
    ty: normalized.type ?? null,
    p: normalized.price ?? null,
    na: normalized.net_amount ?? null,
    da: normalized.dividend_amount ?? null,
    desc: normalized.description ?? null,
  });
  const rowHash = createHash("sha256").update(hashSource).digest("hex");

  // Skip obvious total/footer rows
  if (
    !normalized.ticker &&
    !normalized.company_name &&
    (normalized.market_value != null || normalized.total_cost != null)
  ) {
    return { normalized, status: "invalid", issues: ["Looks like a totals/footer row"], rowHash };
  }

  if (statementType === "holdings") {
    const r = holdingsRowSchema.safeParse(normalized);
    if (!r.success) {
      for (const issue of r.error.issues) issues.push(`${issue.path.join(".")}: ${issue.message}`);
      status = "invalid";
    } else {
      if (normalized.avg_cost == null && normalized.total_cost == null) {
        issues.push("No average cost found — cost basis will be 0 until you edit it");
        status = "warning";
      }
      if (normalized.avg_cost != null && normalized.avg_cost < 0) {
        issues.push("Negative average cost");
        status = "invalid";
      }
    }
  } else if (statementType === "trades") {
    const r = tradeRowSchema.safeParse(normalized);
    if (!r.success) {
      for (const issue of r.error.issues) issues.push(`${issue.path.join(".")}: ${issue.message}`);
      status = "invalid";
    } else {
      if (normalized.type === "UNKNOWN") {
        issues.push("Could not classify transaction type — review and exclude if wrong");
        status = "warning";
      }
      if (!normalized.trade_date) {
        issues.push("Missing trade date — weighted-average ordering may be off");
        if (status === "valid") status = "warning";
      }
      if ((normalized.type === "BUY" || normalized.type === "SELL") && normalized.quantity == null) {
        issues.push("Buy/sell row without quantity");
        status = "invalid";
      }
      if ((normalized.type === "BUY" || normalized.type === "SELL") && normalized.price == null && normalized.net_amount == null && normalized.gross_amount == null) {
        issues.push("No price or amount on this trade");
        status = "invalid";
      }
    }
  } else if (statementType === "dividends") {
    const amount = normalized.dividend_amount ?? normalized.net_amount ?? normalized.gross_amount;
    if (amount == null) {
      issues.push("No amount found on this row");
      status = "invalid";
    }
    if (!normalized.ticker && !normalized.description) {
      issues.push("No ticker or description — cannot link to a holding");
      if (status === "valid") status = "warning";
    }
  } else {
    // generic: keep anything with a ticker or an amount, warn the user
    if (!normalized.ticker && normalized.net_amount == null && normalized.dividend_amount == null && normalized.quantity == null) {
      issues.push("Row has no recognizable portfolio data");
      status = "invalid";
    } else {
      issues.push("Generic statement — verify field mapping before committing");
      status = "warning";
    }
  }

  return { normalized, status, issues, rowHash };
}

export function hashFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
