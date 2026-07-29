// Parser for the AKD Securities daily "Trade Confirmation" PDF that arrives
// by email from confirmation@akdsl.com (subject: "Trade Confirmation for
// Account No. COAF... dated DD-MMM-YYYY", one PDF attachment per day).
//
// This document is different from the Statement Of Account handled by
// akd-statement.ts. It is a one-page per-day table (PURCHASE and/or SALE
// section) but pdf-parse renders it as scattered column blocks, not rows:
//   "SYS 0.00"            <- scrip plus one stray charge column
//   "133.6100"            <- rate, always 4 decimals
//   "70 9,369.18"         <- quantity + amount on one line (amount is NET of
//                            charges: qty*rate + comm + SST + CDC for buys)
//   "70 9,369.18  Total : 14.03 2.10 0.00 0.00 0.35 0.00 0.00 0.00"
// So rows are reassembled by reconciliation instead of position: each scrip is
// paired with a rate and a (qty, amount) line such that qty*rate matches the
// amount within 1% (the charge margin). Anything that does not reconcile is
// reported in `warnings`, never guessed at, because the output is committed
// to the transactions ledger automatically.

import { parseDateLoose } from "@/lib/shared/format";

export interface AkdConfirmationTrade {
  side: "BUY" | "SELL";
  ticker: string;
  quantity: number;
  rate: number;
  gross: number; // quantity * rate
  commission: number | null;
  tax: number | null; // sales tax (SST)
  cdc: number | null;
  net: number | null; // the document's amount column (gross +/- charges)
  raw: string; // reconstruction summary, kept for audit/debugging
}

export interface AkdConfirmation {
  account: string | null;
  tradeDate: string | null; // ISO yyyy-mm-dd
  trades: AkdConfirmationTrade[];
  warnings: string[];
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parses "29-Jul-2026" / "29 Jul 2026" style dates, falling back to parseDateLoose. */
export function parseDayMonthNameYear(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
  }
  return parseDateLoose(s);
}

/** Parses "July 29, 2026" style dates. */
function parseMonthNameDayYear(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  return month ? `${m[3]}-${month}-${m[2].padStart(2, "0")}` : null;
}

// Tokens that look like symbols but never are (labels, address/name fragments).
const SYMBOL_STOPWORDS = new Set([
  "PURCHASE", "SALE", "SALES", "TOTAL", "GRAND", "NET", "GROSS", "AMOUNT",
  "QTY", "RATE", "COMM", "COMMISSION", "SST", "FED", "CDC", "WHT", "CVT",
  "CGT", "BUY", "SELL", "DATE", "SYMBOL", "SCRIP", "FLAG", "ACCOUNT",
  "CLIENT", "KARACHI", "LAHORE", "STOCK", "EXCHANGE", "LIMITED", "SECURITIES",
  "AKD", "TRADE", "TRADES", "CONFIRMATION", "CONFIRMATIONS", "SETTLEMENT",
  "VALUE", "PAGE", "COAF", "UIN", "CNIC", "PSX", "SECP", "NCCPL", "LAGA",
  "READY", "MARKET", "ORDER", "TICKET", "BROKER", "HOUSE", "SUB", "TOTALS",
  "MEMO", "SUMMARY", "ADVANCE", "TAX", "CHARGES", "CONTACT", "ADDRESS",
  "ODL", "NO", "TO", "FOR",
]);

const SYMBOL_RE = /^[A-Z]{2,8}$/;

// A scrip row in the pdf-parse stream: a symbol followed only by numbers,
// e.g. "SYS 0.00". Name/address lines carry extra words and never match.
const SCRIP_LINE_RE = /^([A-Z]{2,8})((?:\s+-?[\d,]+(?:\.\d+)?)+)$/;
// Rates are printed with 4 decimals ("133.6100") and appear alone.
const RATE_RE = /^\d[\d,]*\.\d{4}$/;
// Quantity + amount pairs share a line: "70 9,369.18".
const QTY_AMOUNT_RE = /^(\d[\d,]*)\s+([\d,]+\.\d{2})$/;

const ACCOUNT_RE = /\b(COAF[-\s]?\w+)\b/i;
const DOC_DATE_RE = /([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/;

function parseNum(tok: string): number {
  return Number(tok.replace(/,/g, ""));
}

/** Collapses "P U R C H A S E" style letter-spaced headings. */
function sectionMarker(line: string): "BUY" | "SELL" | null {
  if (line.trim().length > 40) return null;
  const compact = line.toUpperCase().replace(/[^A-Z]/g, "");
  if (/^PURCHASES?$/.test(compact)) return "BUY";
  if (/^SALES?$/.test(compact)) return "SELL";
  return null;
}

/**
 * Finds the subset of `candidates` that sums to `target` (within 2 paisa).
 * Used to attribute the gap between net amount and qty*rate to the individual
 * charge columns on a row without assuming column order.
 */
function chargeSubset(candidates: number[], target: number): number[] | null {
  const nums = candidates.filter((n) => n > 0 && n <= target + 0.02).slice(0, 12);
  let best: number[] | null = null;
  for (let mask = 1; mask < 1 << nums.length; mask++) {
    let sum = 0;
    const subset: number[] = [];
    for (let i = 0; i < nums.length; i++) {
      if (mask & (1 << i)) {
        sum += nums[i];
        subset.push(nums[i]);
      }
    }
    if (Math.abs(sum - target) <= 0.02 && (!best || subset.length < best.length)) {
      best = subset;
    }
  }
  return best;
}

/**
 * Primary pass for layout-extracted text (lib/import/pdf-layout.ts), where
 * each table row arrives as one line in visual column order under its
 * PURCHASE / SALE heading. A row is accepted only when an integer quantity
 * and a 4-decimal rate reconcile with an amount on the same line within 1%.
 */
function parseRowLines(lines: string[], warnings: string[]): AkdConfirmationTrade[] {
  const trades: AkdConfirmationTrade[] = [];
  let side: "BUY" | "SELL" | null = null;

  for (const line of lines) {
    const marker = sectionMarker(line);
    if (marker) {
      side = marker;
      continue;
    }
    if (!side) continue;
    if (/\bTotal\s*:/.test(line) || /^(client|grand)?\s*total\b/i.test(line)) continue;

    const tokens = line.split(/\s+/);
    const ticker = tokens.find((t) => SYMBOL_RE.test(t) && !SYMBOL_STOPWORDS.has(t));
    if (!ticker) continue;

    const rateTokens = tokens.filter((t) => RATE_RE.test(t)).map(parseNum);
    const numbers = tokens
      .filter((t) => /^-?[\d,]+(?:\.\d+)?$/.test(t))
      .map(parseNum)
      .filter((n) => Number.isFinite(n));
    if (!rateTokens.length || numbers.length < 3) continue;

    const ints = numbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= 10_000_000);
    let best: { qty: number; rate: number; net: number; diff: number } | null = null;
    for (const rate of rateTokens) {
      for (const qty of ints) {
        const product = qty * rate;
        for (const m of numbers) {
          if (m === qty || m === rate || m <= 0) continue;
          const diff = Math.abs(product - m);
          if (diff <= Math.max(1, m * 0.01) && (!best || diff / m < best.diff / best.net)) {
            best = { qty, rate, net: m, diff };
          }
        }
      }
    }
    if (!best) {
      warnings.push(`Unreconciled ${side} row skipped: "${line.slice(0, 120)}"`);
      continue;
    }

    const gross = Math.round(best.qty * best.rate * 100) / 100;
    const residual = Math.round(Math.abs(best.net - gross) * 100) / 100;
    let commission: number | null = null;
    let tax: number | null = null;
    let cdc: number | null = null;
    if (residual > 0) {
      const others = numbers.filter((n) => n !== best!.qty && n !== best!.rate && n !== best!.net);
      const subset = chargeSubset(others, residual);
      if (subset) {
        const sorted = [...subset].sort((a, b) => b - a);
        commission = sorted[0] ?? null;
        tax = sorted[1] ?? null;
        cdc = sorted.length > 2
          ? Math.round(sorted.slice(2).reduce((s, n) => s + n, 0) * 100) / 100
          : null;
      }
    }

    trades.push({
      side,
      ticker,
      quantity: best.qty,
      rate: best.rate,
      gross,
      commission,
      tax,
      cdc,
      net: best.net,
      raw: line.slice(0, 160),
    });
  }
  return trades;
}

/**
 * Parses the text layer of an AKD trade-confirmation PDF. Prefers text from
 * extractPdfLayoutText (real rows, handles mixed purchase/sale documents);
 * falls back to reassembling pdf-parse's scrambled column blocks. `fallbackDate`
 * (ISO) is used when the document itself does not yield a trade date; the
 * caller usually extracts it from the email subject. Returns null when the
 * text does not look like an AKD trade confirmation at all.
 */
export function parseAkdConfirmation(
  text: string,
  fallbackDate?: string | null
): AkdConfirmation | null {
  if (!text || !/trade\s*confirmation/i.test(text.replace(/\s+/g, " "))) return null;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const account = text.match(ACCOUNT_RE)?.[1]?.replace(/\s+/g, "") ?? null;
  const tradeDate =
    parseMonthNameDayYear(text.match(DOC_DATE_RE)?.[1] ?? null) ?? fallbackDate ?? null;

  const warnings: string[] = [];

  const rowTrades = parseRowLines(lines, warnings);
  if (rowTrades.length > 0) {
    return { account, tradeDate, trades: rowTrades, warnings };
  }
  warnings.length = 0; // row-pass warnings are noise once we fall back

  // The single-letter section headings tell us which sides the document
  // contains. When both appear, per-trade side attribution from the scrambled
  // text stream would be a guess, so the document is left for manual review.
  let hasBuy = false;
  let hasSell = false;
  for (const line of lines) {
    const s = sectionMarker(line);
    if (s === "BUY") hasBuy = true;
    if (s === "SELL") hasSell = true;
  }
  if (!hasBuy && !hasSell) {
    return { account, tradeDate, trades: [], warnings: ["No PURCHASE or SALE section found"] };
  }
  if (hasBuy && hasSell) {
    return {
      account,
      tradeDate,
      trades: [],
      warnings: [
        "Document contains both PURCHASE and SALE sections; side attribution from the scrambled text layer would be unreliable. Needs manual review (and a real mixed sample to extend the parser).",
      ],
    };
  }
  const side: "BUY" | "SELL" = hasBuy ? "BUY" : "SELL";

  // Column blocks, in document order.
  const scrips: string[] = [];
  const rates: number[] = [];
  const qtyAmountPairs: { qty: number; amount: number; used: boolean }[] = [];
  for (const line of lines) {
    const scrip = line.match(SCRIP_LINE_RE);
    if (scrip && !SYMBOL_STOPWORDS.has(scrip[1])) {
      scrips.push(scrip[1]);
      continue;
    }
    if (RATE_RE.test(line)) {
      rates.push(parseNum(line));
      continue;
    }
    const pair = line.match(QTY_AMOUNT_RE);
    if (pair) {
      qtyAmountPairs.push({ qty: parseNum(pair[1]), amount: parseNum(pair[2]), used: false });
    }
  }

  if (scrips.length !== rates.length) {
    warnings.push(
      `Found ${scrips.length} scrip(s) but ${rates.length} rate(s); pairing by order may be wrong.`
    );
  }

  // Charge totals: "... Total : <comm> <sales tax> <secp> <cvt/wht> <cdc> ...".
  // Only trusted for single-trade documents, where totals equal the row.
  // "Client Total :" has nothing after the colon, so take the first totals
  // line that actually carries numbers.
  let totalNums: number[] = [];
  for (const l of lines) {
    if (!/\bTotal\s*:/.test(l)) continue;
    const nums = (l.split(/Total\s*:/)[1].match(/[\d,]+\.\d{2}/g) ?? []).map(parseNum);
    if (nums.length >= 2) {
      totalNums = nums;
      break;
    }
  }

  const trades: AkdConfirmationTrade[] = [];
  const n = Math.min(scrips.length, rates.length);
  for (let i = 0; i < n; i++) {
    const ticker = scrips[i];
    const rate = rates[i];
    // The amount column is net of charges, so allow a 1% margin over qty*rate.
    const pair = qtyAmountPairs.find(
      (p) => !p.used && Math.abs(p.qty * rate - p.amount) <= Math.max(1, p.amount * 0.01)
    );
    if (!pair) {
      warnings.push(`No quantity/amount line reconciles with ${ticker} @ ${rate}; row skipped.`);
      continue;
    }
    pair.used = true;
    const gross = Math.round(pair.qty * rate * 100) / 100;

    let commission: number | null = null;
    let tax: number | null = null;
    let cdc: number | null = null;
    if (n === 1 && totalNums.length >= 2) {
      commission = totalNums[0];
      tax = totalNums[1];
      const residual = Math.round((pair.amount - gross - commission - tax) * 100) / 100;
      // For buys the amount exceeds gross by the charges; the leftover after
      // commission and sales tax is the CDC charge.
      if (side === "BUY" && residual >= 0 && residual < Math.max(5, gross * 0.005)) {
        cdc = residual;
      }
    }

    trades.push({
      side,
      ticker,
      quantity: pair.qty,
      rate,
      gross,
      commission,
      tax,
      cdc,
      net: pair.amount,
      raw: `${ticker} qty ${pair.qty} @ ${rate} amount ${pair.amount}`,
    });
  }

  return { account, tradeDate, trades, warnings };
}
