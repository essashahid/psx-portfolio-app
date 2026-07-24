import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { checkUpcomingDividends } = await import("@/lib/dividends/detect");
  const { generateDividendForecasts } = await import("@/lib/dividends/forecast");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const userId = "25d76e66-8126-4849-9754-855d045d7ab8";

  console.log("— detection —");
  const det = await checkUpcomingDividends(admin, userId);
  console.log(JSON.stringify(det, null, 2).slice(0, 600));

  console.log("— forecast —");
  const fc = await generateDividendForecasts(admin, userId);
  console.log(JSON.stringify(fc));

  const { data: events } = await admin
    .from("dividend_events")
    .select("ticker, status, dividend_type, dividend_per_share, gross_expected, estimated_tax, net_expected, net_low, net_high, confidence_level, is_forecast, estimated_payment_start, estimated_payment_end, eligibility_status")
    .eq("user_id", userId)
    .order("ticker");
  console.log("— events in DB —");
  for (const e of events ?? []) {
    console.log(
      `${e.ticker.padEnd(8)} ${String(e.status).padEnd(12)} ${e.is_forecast ? "FORECAST" : (e.dividend_type ?? "").padEnd(8)} dps=${e.dividend_per_share ?? "-"} gross=${e.gross_expected ?? `${e.net_low ?? "?"}–${e.net_high ?? "?"}(net rng)`} net=${e.net_expected ?? "-"} conf=${e.confidence_level} elig=${e.eligibility_status} window=${e.estimated_payment_start ?? "?"}→${e.estimated_payment_end ?? "?"}`
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
