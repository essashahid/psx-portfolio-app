/**
 * What the alert engine watches for, in the user's words.
 *
 * An empty alerts screen is only reassuring if you know what would have fired.
 * The keys are the alert_type values lib/alerts/refresh.ts writes; a test keeps
 * the two in step, so a rule added there cannot go unexplained here.
 */

export type AlertKind =
  | "missing_thesis"
  | "review_due"
  | "price_above_target"
  | "price_below_review"
  | "allocation_above_target"
  | "allocation_below_target"
  | "concentration_risk"
  | "negative_news"
  | "dividend_news"
  | "result_news"
  | "import_issue";

export const ALERT_KINDS: { kind: AlertKind; label: string }[] = [
  { kind: "price_above_target", label: "A holding passes the price target you set" },
  { kind: "price_below_review", label: "A holding falls to the level you said you would review" },
  { kind: "concentration_risk", label: "One position grows past a quarter of the book" },
  { kind: "allocation_above_target", label: "A sector drifts above the weight you planned" },
  { kind: "allocation_below_target", label: "A sector drifts below the weight you planned" },
  { kind: "result_news", label: "A company you hold posts results" },
  { kind: "dividend_news", label: "A payout is announced on something you hold" },
  { kind: "negative_news", label: "Something you hold takes a bad headline" },
  { kind: "review_due", label: "A thesis you wrote falls due for review" },
  { kind: "missing_thesis", label: "A position has no thesis written against it" },
  { kind: "import_issue", label: "An import leaves the ledger inconsistent" },
];
