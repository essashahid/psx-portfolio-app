import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getTaxSettings } from "@/lib/dividends/tax";
import type {
  ExperienceLevel,
  Objective,
  RiskProfile,
  SettingsResponse,
} from "@psx/shared/api/settings";

/** Everything the settings screen shows, in one request. */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const [profileRes, tax, txnRes, holdingsRes, watchRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, experience_level, risk_profile, objective, free_cash")
        .eq("id", user.id)
        .maybeSingle(),
      getTaxSettings(supabase, user.id),
      supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("holdings").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("stock_watchlist").select("ticker", { count: "exact", head: true }).eq("user_id", user.id),
    ]);
    if (profileRes.error) throw profileRes.error;

    const profile = profileRes.data;
    const body: SettingsResponse = {
      profile: {
        email: user.email ?? null,
        fullName: profile?.full_name ?? null,
        experienceLevel: (profile?.experience_level ?? "intermediate") as ExperienceLevel,
        riskProfile: (profile?.risk_profile ?? null) as RiskProfile | null,
        objective: (profile?.objective ?? null) as Objective | null,
        freeCash: profile?.free_cash ?? null,
      },
      tax: {
        taxpayerStatus: tax.taxpayer_status,
        taxYear: tax.tax_year,
        dividendTaxRate: tax.dividend_tax_rate,
        defaultPaymentWindowDays: tax.default_payment_window_days,
        defaultFaceValue: tax.default_face_value,
        showForecastsInReview: tax.show_forecasts_in_review,
        autoCreateConfirmed: tax.auto_create_confirmed,
        configured: tax.configured,
      },
      transactionCount: txnRes.count ?? 0,
      holdingsCount: holdingsRes.count ?? 0,
      watchlistCount: watchRes.count ?? 0,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
