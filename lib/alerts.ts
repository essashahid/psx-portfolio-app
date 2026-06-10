import type { SupabaseClient } from "@supabase/supabase-js";
import { getPortfolio } from "@/lib/portfolio";
import { formatMoney } from "@/lib/utils";

const DRIFT_THRESHOLD_PP = 5; // percentage points off target allocation
const TARGET_PROXIMITY_PCT = 5; // within 5% of target price
const CONCENTRATION_STOCK_PCT = 25;
const CONCENTRATION_SECTOR_PCT = 40;

interface NewAlert {
  ticker: string | null;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  dedupe_key: string;
}

/**
 * Rule engine: recomputes the full alert set from current portfolio state.
 * Idempotent — alerts are upserted on (user_id, dedupe_key), and rule-based
 * alerts whose condition has cleared are resolved.
 */
export async function refreshAlerts(
  supabase: SupabaseClient,
  userId: string
): Promise<{ created: number; total: number }> {
  const summary = await getPortfolio(supabase, userId);
  const alerts: NewAlert[] = [];
  const today = new Date().toISOString().slice(0, 10);
  // Only nag about missing theses once the user has written at least one —
  // otherwise a fresh import floods Alerts with a warning per holding.
  const usesTheses = summary.holdings.some((h) => h.has_thesis);

  for (const h of summary.holdings) {
    // missing thesis
    if (usesTheses && !h.has_thesis) {
      alerts.push({
        ticker: h.ticker,
        alert_type: "missing_thesis",
        severity: "warning",
        title: `${h.ticker} has no investment thesis`,
        message: `You hold ${h.quantity} shares of ${h.ticker} but haven't recorded why. Add a thesis so future news can be checked against it.`,
        dedupe_key: `missing_thesis:${h.ticker}`,
      });
    }
    // review date due
    if (h.review_date && h.review_date <= today) {
      alerts.push({
        ticker: h.ticker,
        alert_type: "review_due",
        severity: "warning",
        title: `${h.ticker} review date is due`,
        message: `The review date you set (${h.review_date}) has arrived. Consider re-checking the thesis.`,
        dedupe_key: `review_due:${h.ticker}:${h.review_date}`,
      });
    }
    if (h.latest_price !== null) {
      // price above target
      if (h.target_price !== null && h.latest_price >= h.target_price) {
        alerts.push({
          ticker: h.ticker,
          alert_type: "price_above_target",
          severity: "info",
          title: `${h.ticker} is at/above your target price`,
          message: `Latest price ${formatMoney(h.latest_price)} vs target ${formatMoney(h.target_price)}. This may be a moment to review the position.`,
          dedupe_key: `price_above_target:${h.ticker}`,
        });
      } else if (
        h.target_price !== null &&
        ((h.target_price - h.latest_price) / h.latest_price) * 100 <= TARGET_PROXIMITY_PCT
      ) {
        alerts.push({
          ticker: h.ticker,
          alert_type: "price_above_target",
          severity: "info",
          title: `${h.ticker} is within ${TARGET_PROXIMITY_PCT}% of your target price`,
          message: `Latest price ${formatMoney(h.latest_price)} vs target ${formatMoney(h.target_price)}.`,
          dedupe_key: `price_near_target:${h.ticker}`,
        });
      }
      // price below review level
      if (h.review_level !== null && h.latest_price <= h.review_level) {
        alerts.push({
          ticker: h.ticker,
          alert_type: "price_below_review",
          severity: "critical",
          title: `${h.ticker} is at/below your review level`,
          message: `Latest price ${formatMoney(h.latest_price)} vs review level ${formatMoney(h.review_level)}. This requires attention.`,
          dedupe_key: `price_below_review:${h.ticker}`,
        });
      }
    }
    // allocation drift
    if (h.target_allocation !== null && h.weight !== null) {
      const drift = h.weight - h.target_allocation;
      if (drift >= DRIFT_THRESHOLD_PP) {
        alerts.push({
          ticker: h.ticker,
          alert_type: "allocation_above_target",
          severity: "warning",
          title: `${h.ticker} is ${drift.toFixed(1)}pp above target allocation`,
          message: `Actual ${h.weight.toFixed(1)}% vs target ${h.target_allocation.toFixed(1)}%. Consider reviewing position sizing.`,
          dedupe_key: `allocation_above_target:${h.ticker}`,
        });
      } else if (drift <= -DRIFT_THRESHOLD_PP) {
        alerts.push({
          ticker: h.ticker,
          alert_type: "allocation_below_target",
          severity: "info",
          title: `${h.ticker} is ${Math.abs(drift).toFixed(1)}pp below target allocation`,
          message: `Actual ${h.weight.toFixed(1)}% vs target ${h.target_allocation.toFixed(1)}%.`,
          dedupe_key: `allocation_below_target:${h.ticker}`,
        });
      }
    }
    // single-stock concentration
    if (h.weight !== null && h.weight >= CONCENTRATION_STOCK_PCT) {
      alerts.push({
        ticker: h.ticker,
        alert_type: "concentration_risk",
        severity: "warning",
        title: `${h.ticker} is ${h.weight.toFixed(1)}% of the portfolio`,
        message: `A single position above ${CONCENTRATION_STOCK_PCT}% concentrates risk. This may deserve a review.`,
        dedupe_key: `concentration_stock:${h.ticker}`,
      });
    }
  }

  for (const s of summary.sectorWeights) {
    if (s.weight >= CONCENTRATION_SECTOR_PCT && summary.holdingsCount > 1) {
      alerts.push({
        ticker: null,
        alert_type: "concentration_risk",
        severity: "warning",
        title: `${s.sector} is ${s.weight.toFixed(1)}% of the portfolio`,
        message: `Sector exposure above ${CONCENTRATION_SECTOR_PCT}% concentrates risk in one industry.`,
        dedupe_key: `concentration_sector:${s.sector}`,
      });
    }
  }

  // negative / dividend / result news (last 7 days, relevance >= 6)
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: news } = await supabase
    .from("news_articles")
    .select("id, ticker, title, url, sentiment, relevance_score, category")
    .eq("user_id", userId)
    .eq("ignored", false)
    .gte("created_at", since)
    .gte("relevance_score", 6);
  for (const n of news ?? []) {
    if (n.sentiment === "negative") {
      alerts.push({
        ticker: n.ticker,
        alert_type: "negative_news",
        severity: "warning",
        title: `Negative news: ${n.ticker ?? "portfolio"}`,
        message: `${n.title} — ${n.url}`,
        dedupe_key: `negative_news:${n.id}`,
      });
    }
    if (n.category === "dividend") {
      alerts.push({
        ticker: n.ticker,
        alert_type: "dividend_news",
        severity: "info",
        title: `Dividend announcement found: ${n.ticker ?? ""}`,
        message: `${n.title} — ${n.url}`,
        dedupe_key: `dividend_news:${n.id}`,
      });
    }
    if (n.category === "result") {
      alerts.push({
        ticker: n.ticker,
        alert_type: "result_news",
        severity: "info",
        title: `Financial result found: ${n.ticker ?? ""}`,
        message: `${n.title} — ${n.url}`,
        dedupe_key: `result_news:${n.id}`,
      });
    }
  }

  // import issues
  const { data: batches } = await supabase
    .from("import_batches")
    .select("id, rejected_rows, created_at")
    .eq("user_id", userId)
    .eq("status", "committed")
    .gt("rejected_rows", 0)
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString());
  for (const b of batches ?? []) {
    alerts.push({
      ticker: null,
      alert_type: "import_issue",
      severity: "warning",
      title: `Import had ${b.rejected_rows} rejected row(s)`,
      message: `An import on ${b.created_at.slice(0, 10)} had rows that could not be applied. Review them in the Import Center.`,
      dedupe_key: `import_issue:${b.id}`,
    });
  }

  // Upsert new alerts in one batch (re-opens nothing the user dismissed:
  // dedupe_key conflict ignores)
  let created = 0;
  if (alerts.length > 0) {
    const { error, data } = await supabase
      .from("alerts")
      .upsert(
        alerts.map((a) => ({ user_id: userId, ...a })),
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }
      )
      .select("id");
    if (!error && data) created = data.length;
  }

  // Resolve open rule-based alerts whose condition cleared
  const activeKeys = new Set(alerts.map((a) => a.dedupe_key));
  const RULE_TYPES = [
    "missing_thesis",
    "price_above_target",
    "price_below_review",
    "allocation_above_target",
    "allocation_below_target",
    "concentration_risk",
    "review_due",
  ];
  const { data: open } = await supabase
    .from("alerts")
    .select("id, dedupe_key, alert_type")
    .eq("user_id", userId)
    .eq("status", "open")
    .in("alert_type", RULE_TYPES);
  const clearedIds = (open ?? []).filter((o) => !activeKeys.has(o.dedupe_key)).map((o) => o.id);
  if (clearedIds.length > 0) {
    await supabase.from("alerts").update({ status: "resolved" }).in("id", clearedIds);
  }

  const { count } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "open");

  return { created, total: count ?? 0 };
}
