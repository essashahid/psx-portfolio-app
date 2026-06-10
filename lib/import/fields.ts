// Canonical import fields. Kept free of Node-only imports so client components
// (the import wizard's mapping UI) can use the list too.

export const CANONICAL_FIELDS = [
  "ticker",
  "company_name",
  "sector",
  "quantity",
  "avg_cost",
  "market_price",
  "market_value",
  "total_cost",
  "trade_date",
  "settlement_date",
  "type",
  "price",
  "gross_amount",
  "commission",
  "tax",
  "net_amount",
  "dividend_amount",
  "cash_balance",
  "description",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
