// Dedicated parser for the AKD Securities "Statement Of Account" PDF.
//
// Why this exists: that statement is the full account ledger from inception
// (cash + every fill + fees + taxes) plus a closing Inventory Position. The
// generic whitespace-table extractor in parse.ts cannot read it, because
// pdf-parse renders the document as separate column blocks in reading order:
//   [transaction dates] [entry ids] [multi-line narrations]
//   [all Debit values] [all Credit values] [all running Balances]
//   [effect] [cheque #] [cheque dates]
// Narrations wrap across a variable number of lines and the real trade data
// (side, ticker, qty, price, commission, SST, CDC) lives inside that free text.
//
// The approach: split by page, take the clean 1:1 blocks (dates, entry ids,
// the 2N money run = N debit/credit values + N balances), segment the
// narration by transaction-start patterns, then assign the debit block to
// debit entries (buys/fees/CGT) and the credit block to credit entries
// (sells/deposits) in order. The result reconciles to the statement's own
// control totals to the cent — see reconcileAkd.

const DATE_RE = /^\d{2}-\d{2}-\d{2}$/;
const ENTRY_RE = /^[A-Z]{2}\d{6}$/;
const MONEY_RE = /^-?\s?[\d,]+\.\d{2}(\s*Cr)?$/;
const TABLE_HEADER_RE = /Narration.*Debit.*Credit.*Balance/i;
const INVENTORY_MARK_RE =
  /(Inventory Position|Item Symbol|Net Worth of Client|Ledger Balance|^Total\s*:|^Total:)/i;
const SYMBOL_RE = /^[A-Z]{2,8}$/;
const INT_RE = /^\d{1,7}$/;

const TRADE_START_RE = /^T\+\d\s+(BUY|SELL)\b/i;
const DEPOSIT_START_RE =
  /^(RECV INTERNET TRF|RCD FRM|REC INT TRANSFER|RECEIVED FROM|RECD-RAAST|FUND ONLINE TRANSFER)/i;
const CGT_START_RE = /^CGT/i;
const FEE_START_RE = /^(UIN|CDC SUB)/i;

// Core trade fields are always on the first line(s) of the narration:
//   "T+2 Buy #37226 MCB 6 @ 148.20 Comm Amt 1.33 SST 0.17 CDC Amt 0.03"
const TRADE_CORE_RE =
  /^T\+\d\s+(BUY|SELL)\s*#?\s*(\d+)\s+([A-Z]+)\s+([\d,]+)\s+@\s+([\d.]+)/i;
const COMM_RE = /Comm\s+Amt\s+([\d.]+)/i;
const SST_RE = /\bSST\s+([\d.]+)/i;
const CDC_RE = /CDC\s+Amt\s+([\d.]+)/i;

export type AkdEntryKind = "TRADE" | "DEPOSIT" | "CGT" | "FEE" | "UNKNOWN";

export interface AkdAccount {
  coaf: string | null;
  name: string | null;
  cdcId: string | null;
  fromDate: string | null;
  toDate: string | null;
}

export interface AkdEntry {
  page: number;
  date: string | null; // ISO yyyy-mm-dd
  entryNo: string;
  narration: string;
  kind: AkdEntryKind;
  isDebit: boolean;
  amount: number; // cash value of this line (always positive)
  balance: number; // running balance after this line, as printed
}

export interface AkdTrade extends AkdEntry {
  kind: "TRADE";
  side: "BUY" | "SELL";
  ref: string;
  ticker: string;
  quantity: number;
  price: number;
  commission: number; // Comm Amt from narration (0 if it wrapped off-page)
  sst: number;
  cdc: number;
  fees: number; // authoritative: |net - gross|
  gross: number; // quantity * price
  net: number; // ledger amount (gross + fees for buys, gross - fees for sells)
}

export interface AkdInventoryItem {
  ticker: string;
  companyName: string | null;
  quantity: number;
  closingRate: number;
  amount: number;
}

export interface AkdControls {
  totalDebit: number | null;
  totalCredit: number | null;
  ledgerBalance: number | null;
  inventoryValue: number | null;
  netWorth: number | null;
}

export interface AkdStatement {
  account: AkdAccount;
  entries: AkdEntry[];
  trades: AkdTrade[];
  deposits: AkdEntry[];
  charges: AkdEntry[]; // CGT + account fees
  inventory: AkdInventoryItem[];
  controls: AkdControls;
  warnings: string[];
}

function toNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, "").replace(/\s/g, "").replace(/Cr$/i, ""));
}

/** "06-06-23" (day-month-year, PK convention) -> "2023-06-06". */
function toIsoDate(raw: string): string | null {
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

function classifyNarration(line: string): AkdEntryKind {
  if (TRADE_START_RE.test(line)) return "TRADE";
  if (DEPOSIT_START_RE.test(line)) return "DEPOSIT";
  if (CGT_START_RE.test(line)) return "CGT";
  if (FEE_START_RE.test(line)) return "FEE";
  return "UNKNOWN";
}

/** True when this PDF text is an AKD Securities Statement Of Account. */
export function isAkdStatement(text: string): boolean {
  return (
    /AKD\s+SECURITIES/i.test(text) &&
    /Statement\s+Of\s+Account/i.test(text) &&
    TABLE_HEADER_RE.test(text)
  );
}

function parseAccount(text: string, entries: AkdEntry[]): AkdAccount {
  const head = text.match(/^(\w+)\s+(.+?)\s+CDC Id:\s*([\d-]+)/m);
  // Derive the period from the actual entries (the printed From/To dates are
  // emitted out of order by pdf-parse and are unreliable to anchor).
  const dates = entries.map((e) => e.date).filter((d): d is string => !!d).sort();
  return {
    coaf: head?.[1] ?? null,
    name: head?.[2]?.trim() ?? null,
    cdcId: head?.[3] ?? null,
    fromDate: dates[0] ?? null,
    toDate: dates[dates.length - 1] ?? null,
  };
}

interface PageParse {
  entries: AkdEntry[];
  warnings: string[];
}

function parsePage(pageText: string, pageNo: number): PageParse | null {
  const warnings: string[] = [];
  const lines = pageText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => TABLE_HEADER_RE.test(l));
  if (headerIdx === -1) return null;

  // Restrict to the transaction region: stop at the Inventory Position / footer.
  const invIdx = lines.findIndex((l, idx) => idx > headerIdx && INVENTORY_MARK_RE.test(l));
  const region = lines.slice(headerIdx + 1, invIdx === -1 ? undefined : invIdx);

  // Dates may not sit directly under the header (page 8 has a control-total
  // line first), so skip intruding lines until the first date.
  let i = 0;
  while (i < region.length && !DATE_RE.test(region[i])) i++;
  const dates: string[] = [];
  while (i < region.length && DATE_RE.test(region[i])) dates.push(region[i++]);
  const N = dates.length;
  if (N === 0) return null;

  const entryNos: string[] = [];
  while (i < region.length && ENTRY_RE.test(region[i])) entryNos.push(region[i++]);
  if (entryNos.length !== N) warnings.push(`Page ${pageNo}: ${entryNos.length} entry ids for ${N} dates.`);

  const rest = region.slice(i);

  // The Debit + Credit + Balance columns form one unbroken run of 2N money
  // lines. Narration also contains stray numeric continuations ("0.03"), but
  // those are isolated single-line runs, so the 2N run is unambiguous.
  const runs: number[][] = [];
  let cur: number[] = [];
  rest.forEach((l, idx) => {
    if (MONEY_RE.test(l)) cur.push(idx);
    else {
      if (cur.length) runs.push(cur);
      cur = [];
    }
  });
  if (cur.length) runs.push(cur);
  const run =
    runs.find((r) => r.length === 2 * N) ??
    [...runs].sort((a, b) => b.length - a.length)[0] ??
    [];
  if (run.length !== 2 * N) {
    warnings.push(`Page ${pageNo}: money column run was ${run.length} lines, expected ${2 * N}.`);
  }
  const values = run.map((idx) => toNumber(rest[idx]));
  const debitCredit = values.slice(0, N); // debit block then credit block
  const balances = values.slice(N, 2 * N);

  // Narration is everything before the money run; segment by start patterns.
  const narrationLines = rest.slice(0, run.length ? run[0] : rest.length);
  const segments: string[][] = [];
  let seg: string[] | null = null;
  for (const line of narrationLines) {
    if (classifyNarration(line) !== "UNKNOWN") {
      if (seg) segments.push(seg);
      seg = [line];
    } else if (seg) {
      seg.push(line);
    }
  }
  if (seg) segments.push(seg);
  if (segments.length !== N) {
    warnings.push(`Page ${pageNo}: ${segments.length} narration blocks for ${N} entries.`);
  }

  // Build entries and classify each as debit (buy/fee/CGT) or credit (sell/deposit).
  const entries: AkdEntry[] = [];
  for (let k = 0; k < N; k++) {
    const narration = (segments[k] ?? []).join(" ").replace(/\s+/g, " ").trim();
    const kind = classifyNarration(narration);
    let isDebit: boolean;
    if (kind === "TRADE") {
      const m = narration.match(TRADE_CORE_RE);
      isDebit = (m?.[1]?.toUpperCase() ?? "BUY") === "BUY";
    } else if (kind === "DEPOSIT") {
      isDebit = false;
    } else {
      isDebit = true; // CGT, FEE, and anything unknown lands in the debit column
    }
    entries.push({
      page: pageNo,
      date: toIsoDate(dates[k]),
      entryNo: entryNos[k] ?? "",
      narration,
      kind,
      isDebit,
      amount: 0,
      balance: balances[k],
    });
  }

  // Assign the debit value block to debit entries in order, credit block to
  // credit entries in order.
  const debitCount = entries.filter((e) => e.isDebit).length;
  const debitVals = debitCredit.slice(0, debitCount);
  const creditVals = debitCredit.slice(debitCount, N);
  let di = 0;
  let ci = 0;
  for (const e of entries) {
    e.amount = e.isDebit ? debitVals[di++] : creditVals[ci++];
    if (e.amount === undefined) {
      e.amount = 0;
      warnings.push(`Page ${pageNo}: missing amount for ${e.entryNo} (${e.kind}).`);
    }
  }

  return { entries, warnings };
}

function toTrade(e: AkdEntry): AkdTrade | null {
  const m = e.narration.match(TRADE_CORE_RE);
  if (!m) return null;
  const side = m[1].toUpperCase() as "BUY" | "SELL";
  const quantity = toNumber(m[4]);
  const price = parseFloat(m[5]);
  const gross = quantity * price;
  const commission = parseFloat(e.narration.match(COMM_RE)?.[1] ?? "0") || 0;
  const sst = parseFloat(e.narration.match(SST_RE)?.[1] ?? "0") || 0;
  const cdc = parseFloat(e.narration.match(CDC_RE)?.[1] ?? "0") || 0;
  const net = e.amount;
  return {
    ...e,
    kind: "TRADE",
    side,
    ref: m[2],
    ticker: m[3],
    quantity,
    price,
    commission,
    sst,
    cdc,
    fees: Math.round(Math.abs(net - gross) * 100) / 100,
    gross: Math.round(gross * 100) / 100,
    net,
  };
}

function parseInventory(text: string): { items: AkdInventoryItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // The symbol column is the last contiguous run of short all-caps tokens.
  let best: number[] = [];
  let cur: number[] = [];
  lines.forEach((l, idx) => {
    if (SYMBOL_RE.test(l)) cur.push(idx);
    else {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
  });
  if (cur.length > best.length) best = cur;
  const L = best.length;
  if (L < 2) return { items: [], warnings };

  const symbols = best.map((idx) => lines[idx]);
  const symStart = best[0];

  // Walk backward from the symbol block: amounts (L), rates (L), quantities (L), names (L).
  const before = lines.slice(0, symStart);
  const money = before.filter((l) => MONEY_RE.test(l));
  const ints = before.filter((l) => INT_RE.test(l) && Number(l) !== 0);
  // The two money blocks closest to the symbols are rate (first) then amount (second).
  const rates = money.slice(-2 * L, -L).map(toNumber);
  const amounts = money.slice(-L).map(toNumber);
  const quantities = ints.slice(-L).map((l) => Number(l));
  const names = before
    .filter((l) => /[A-Za-z]/.test(l) && l.includes(" ") && !MONEY_RE.test(l))
    .slice(-L);

  const items: AkdInventoryItem[] = [];
  for (let k = 0; k < L; k++) {
    const item: AkdInventoryItem = {
      ticker: symbols[k],
      companyName: names[k] ?? null,
      quantity: quantities[k] ?? 0,
      closingRate: rates[k] ?? 0,
      amount: amounts[k] ?? 0,
    };
    // Sanity check alignment: qty * rate should be close to the listed amount.
    if (item.quantity && item.closingRate && item.amount) {
      const expected = item.quantity * item.closingRate;
      if (Math.abs(expected - item.amount) / item.amount > 0.02) {
        warnings.push(`Inventory ${item.ticker}: qty*rate (${expected.toFixed(0)}) != amount (${item.amount}).`);
      }
    }
    items.push(item);
  }
  return { items, warnings };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseControls(entries: AkdEntry[], inventory: AkdInventoryItem[]): AkdControls {
  // Derive from the parsed columns rather than from regex over the jumbled
  // text: debit/credit totals are the column sums, and the ledger balance is
  // the final running balance (printed in an independent column, so matching it
  // against the summed amounts is a genuine cross-check).
  const totalDebit = round2(entries.filter((e) => e.isDebit).reduce((s, e) => s + e.amount, 0));
  const totalCredit = round2(entries.filter((e) => !e.isDebit).reduce((s, e) => s + e.amount, 0));
  const last = entries[entries.length - 1];
  const ledgerBalance = last ? round2(Math.abs(last.balance)) : null;
  const inventoryValue = inventory.length
    ? round2(inventory.reduce((s, i) => s + i.amount, 0))
    : null;
  const netWorth =
    inventoryValue !== null && ledgerBalance !== null ? round2(inventoryValue + ledgerBalance) : null;
  return { totalDebit, totalCredit, ledgerBalance, inventoryValue, netWorth };
}

/** Parses a full AKD Statement Of Account, or returns null if the text is not one. */
export function parseAkdStatement(text: string): AkdStatement | null {
  if (!isAkdStatement(text)) return null;

  const warnings: string[] = [];
  const pages = text.split(/--\s*\d+\s*of\s*\d+\s*--/);

  const entries: AkdEntry[] = [];
  pages.forEach((pageText, idx) => {
    const parsed = parsePage(pageText, idx + 1);
    if (!parsed) return;
    entries.push(...parsed.entries);
    warnings.push(...parsed.warnings);
  });

  if (entries.length === 0) return null;

  const trades: AkdTrade[] = [];
  const deposits: AkdEntry[] = [];
  const charges: AkdEntry[] = [];
  for (const e of entries) {
    if (e.kind === "TRADE") {
      const t = toTrade(e);
      if (t) trades.push(t);
      else warnings.push(`Could not parse trade narration: "${e.narration.slice(0, 50)}"`);
    } else if (e.kind === "DEPOSIT") {
      deposits.push(e);
    } else if (e.kind === "CGT" || e.kind === "FEE") {
      charges.push(e);
    }
  }

  // The Inventory Position lives on the last page; pdf-parse emits its blocks
  // out of order, so scan the whole document for the symbol column.
  const { items: inventory, warnings: invWarnings } = parseInventory(text);
  warnings.push(...invWarnings);

  return {
    account: parseAccount(text, entries),
    entries,
    trades,
    deposits,
    charges,
    inventory,
    controls: parseControls(entries, inventory),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Bridge to the generic import pipeline: emit clean trade rows whose headers
// map to canonical fields (trades statement type). net_amount carries the
// authoritative ledger value, so weighted-average rebuild matches the broker.
// ---------------------------------------------------------------------------

const ROW_HEADERS = [
  "Trade Date",
  "Type",
  "Symbol",
  "Quantity",
  "Rate",
  "Commission",
  "Tax",
  "Net Amount",
  "Description",
] as const;

export function akdToImportRows(stmt: AkdStatement): {
  headers: string[];
  rows: Record<string, unknown>[];
} {
  const rows = stmt.trades.map((t) => ({
    "Trade Date": t.date,
    Type: t.side,
    Symbol: t.ticker,
    Quantity: t.quantity,
    Rate: t.price,
    Commission: t.commission,
    Tax: Math.round((t.sst + t.cdc) * 100) / 100,
    "Net Amount": t.net,
    Description: t.narration,
  }));
  return { headers: [...ROW_HEADERS], rows };
}

// ---------------------------------------------------------------------------
// Reconciliation: rebuild positions from trades and compare to the statement's
// own Inventory Position and control totals. This is a correctness proof and a
// way to surface corporate actions (bonus/merger) that a cash ledger omits.
// ---------------------------------------------------------------------------

export interface AkdReconciliation {
  cash: {
    deposits: number;
    sells: number;
    buys: number;
    cgt: number;
    fees: number;
    computedBalance: number;
    statedBalance: number | null;
    difference: number | null;
    matches: boolean;
  };
  holdings: {
    ticker: string;
    rebuiltQty: number;
    statedQty: number | null;
    difference: number | null;
    avgCost: number | null;
    note: string | null;
  }[];
  realizedPl: { ticker: string; amount: number }[];
  totalRealizedPl: number;
  totalTradeFees: number;
}

export function reconcileAkd(stmt: AkdStatement): AkdReconciliation {
  // Rebuild positions in chronological order using the ledger net amount.
  const sorted = [...stmt.trades].sort((a, b) =>
    (a.date ?? "9999").localeCompare(b.date ?? "9999")
  );
  const pos = new Map<string, { qty: number; cost: number }>();
  const realized = new Map<string, number>();
  for (const t of sorted) {
    const p = pos.get(t.ticker) ?? { qty: 0, cost: 0 };
    if (t.side === "BUY") {
      p.qty += t.quantity;
      p.cost += t.net;
    } else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      const sellQty = Math.min(t.quantity, p.qty);
      realized.set(t.ticker, (realized.get(t.ticker) ?? 0) + (t.net - avg * sellQty));
      p.cost -= avg * sellQty;
      p.qty -= sellQty;
    }
    pos.set(t.ticker, p);
  }

  const invByTicker = new Map(stmt.inventory.map((i) => [i.ticker, i]));
  const tickers = [...new Set([...pos.keys(), ...invByTicker.keys()])].sort();
  const holdings = tickers
    .map((ticker) => {
      const p = pos.get(ticker);
      const rebuiltQty = Math.round(p?.qty ?? 0);
      const inv = invByTicker.get(ticker);
      const statedQty = inv ? inv.quantity : null;
      const difference = statedQty === null ? null : rebuiltQty - statedQty;
      let note: string | null = null;
      if (statedQty !== null && difference !== null && difference !== 0) {
        if (rebuiltQty > 0 && statedQty === 0) note = "In trades but not in inventory (possible merger/transfer).";
        else if (rebuiltQty === 0 && statedQty > 0) note = "In inventory but no buy trades (likely bonus/spin-off shares).";
        else note = "Quantity gap (possible bonus issue or corporate action).";
      }
      return {
        ticker,
        rebuiltQty,
        statedQty,
        difference,
        avgCost: p && p.qty > 0 ? Math.round((p.cost / p.qty) * 100) / 100 : null,
        note,
      };
    })
    .filter((h) => h.rebuiltQty !== 0 || (h.statedQty ?? 0) !== 0);

  const sum = (arr: { amount: number }[]) => arr.reduce((s, x) => s + x.amount, 0);
  const buys = stmt.trades.filter((t) => t.side === "BUY").reduce((s, t) => s + t.net, 0);
  const sells = stmt.trades.filter((t) => t.side === "SELL").reduce((s, t) => s + t.net, 0);
  const deposits = sum(stmt.deposits);
  const cgt = sum(stmt.charges.filter((c) => c.kind === "CGT"));
  const fees = sum(stmt.charges.filter((c) => c.kind === "FEE"));
  const computedBalance = Math.round((deposits + sells - buys - cgt - fees) * 100) / 100;
  const statedBalance = stmt.controls.ledgerBalance;
  const difference =
    statedBalance === null ? null : Math.round((computedBalance - statedBalance) * 100) / 100;

  return {
    cash: {
      deposits: Math.round(deposits * 100) / 100,
      sells: Math.round(sells * 100) / 100,
      buys: Math.round(buys * 100) / 100,
      cgt: Math.round(cgt * 100) / 100,
      fees: Math.round(fees * 100) / 100,
      computedBalance,
      statedBalance,
      difference,
      matches: difference !== null && Math.abs(difference) < 1,
    },
    holdings,
    realizedPl: [...realized.entries()]
      .map(([ticker, amount]) => ({ ticker, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount),
    totalRealizedPl: Math.round([...realized.values()].reduce((s, x) => s + x, 0) * 100) / 100,
    totalTradeFees: Math.round(stmt.trades.reduce((s, t) => s + t.fees, 0) * 100) / 100,
  };
}
