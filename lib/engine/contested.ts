import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which filed figures are currently in dispute.
 *
 * Two extractions of the same period can disagree (LUCK FY2025 EPS was read
 * as 22.59 by one pass and 52.53 by another). Migration 0033 records each
 * such disagreement in financial_statement_conflicts and leaves the earlier
 * row published. Until now every reader then served that earlier row as if
 * nothing were wrong, so a P/E built on a contested EPS looked exactly as
 * authoritative as one built on a settled figure.
 *
 * This module answers one question for the ratio engine and the fundamentals
 * grid: is this field, for this period, contested badly enough that a number
 * derived from it should be withheld? "Badly enough" is a difference above
 * CONTESTED_PCT on a headline field. A one percent restatement of EPS is a
 * rounding revision and is not worth blanking a valuation over.
 *
 * Only open conflicts count. Resolving one in the admin queue releases the
 * figure immediately.
 */

export const CONTESTED_PCT = 10;

/** Fields whose disagreement can change a conclusion a user would act on. */
export const HEADLINE_FIELDS = new Set([
  "eps",
  "revenue",
  "profit_after_tax",
  "gross_profit",
  "operating_profit",
  "equity",
  "total_assets",
  "borrowings",
  "operating_cash_flow",
]);

export interface ContestedEntry {
  statementType: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  field: string;
  pctDelta: number;
  existing: number | null;
  incoming: number | null;
}

export class ContestedSet {
  private readonly keys = new Map<string, ContestedEntry>();

  constructor(entries: ContestedEntry[] = []) {
    for (const e of entries) this.keys.set(keyOf(e.statementType, e.fiscalYear, e.fiscalPeriod, e.field), e);
  }

  get size(): number {
    return this.keys.size;
  }

  /** The disagreement for a field on a period, if there is one. */
  get(statementType: string, fiscalYear: number | null, fiscalPeriod: string | null, field: string): ContestedEntry | null {
    return this.keys.get(keyOf(statementType, fiscalYear, fiscalPeriod, field)) ?? null;
  }

  isContested(statementType: string, fiscalYear: number | null, fiscalPeriod: string | null, field: string): boolean {
    return this.keys.has(keyOf(statementType, fiscalYear, fiscalPeriod, field));
  }

  /** Every contested field on a given period row, for a "this row is disputed" caption. */
  fieldsFor(statementType: string, fiscalYear: number | null, fiscalPeriod: string | null): ContestedEntry[] {
    const prefix = keyOf(statementType, fiscalYear, fiscalPeriod, "");
    return [...this.keys.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  }

  entries(): ContestedEntry[] {
    return [...this.keys.values()];
  }
}

function keyOf(statementType: string, fiscalYear: number | null, fiscalPeriod: string | null, field: string): string {
  return `${statementType}|${fiscalYear ?? "?"}|${(fiscalPeriod ?? "").toUpperCase()}|${field}`;
}

interface ConflictRow {
  statement_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  differences: unknown;
}

/** Build the set from the raw conflict rows. Exported for tests. */
export function contestedFromConflicts(rows: ConflictRow[]): ContestedSet {
  const entries: ContestedEntry[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.differences)) continue;
    for (const d of row.differences as { field?: unknown; pct_delta?: unknown; existing?: unknown; incoming?: unknown }[]) {
      const field = typeof d?.field === "string" ? d.field : null;
      const pct = typeof d?.pct_delta === "number" ? Math.abs(d.pct_delta) : null;
      if (!field || pct === null || !HEADLINE_FIELDS.has(field) || pct < CONTESTED_PCT) continue;
      entries.push({
        statementType: row.statement_type,
        fiscalYear: row.fiscal_year,
        fiscalPeriod: row.fiscal_period,
        field,
        pctDelta: pct,
        existing: typeof d.existing === "number" ? d.existing : null,
        incoming: typeof d.incoming === "number" ? d.incoming : null,
      });
    }
  }
  return new ContestedSet(entries);
}

/** Open, material disagreements for one ticker. Never throws; a read failure means "nothing known". */
export async function getContested(supabase: SupabaseClient, ticker: string): Promise<ContestedSet> {
  try {
    const { data } = await supabase
      .from("financial_statement_conflicts")
      .select("statement_type, fiscal_year, fiscal_period, differences")
      .eq("ticker", ticker.toUpperCase())
      .eq("status", "open")
      .limit(500);
    return contestedFromConflicts((data ?? []) as ConflictRow[]);
  } catch {
    return new ContestedSet();
  }
}

/** Plain caption for a withheld figure. */
export function contestedReason(e: ContestedEntry): string {
  const period = `${e.fiscalYear ?? "?"} ${e.fiscalPeriod ?? ""}`.trim();
  const label = e.field.replace(/_/g, " ");
  return `Contested: two readings of the ${period} filing disagree on ${label} by ${Math.round(e.pctDelta)}%. Withheld until reviewed.`;
}
