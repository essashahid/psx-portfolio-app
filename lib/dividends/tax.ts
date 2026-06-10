import type { SupabaseClient } from "@supabase/supabase-js";

export interface TaxSettings {
  taxpayer_status: string; // filer | non-filer
  country: string;
  tax_year: string;
  dividend_tax_rate: number | null;
  default_payment_window_days: number;
  default_face_value: number;
  source_note: string | null;
  show_forecasts_in_review: boolean;
  auto_create_confirmed: boolean;
  updated_at: string | null;
  /** False when the user has never saved a tax profile — defaults are in use. */
  configured: boolean;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  taxpayer_status: "filer",
  country: "PK",
  tax_year: "2025-26",
  dividend_tax_rate: 0.15,
  default_payment_window_days: 30,
  default_face_value: 10,
  source_note:
    "Default: 15% WHT for ATL filers on listed-company cash dividends (ITO 2001 s.150). Edit if FBR rules change.",
  show_forecasts_in_review: true,
  auto_create_confirmed: true,
  updated_at: null,
  configured: false,
};

export async function getTaxSettings(supabase: SupabaseClient, userId: string): Promise<TaxSettings> {
  const { data } = await supabase
    .from("tax_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return DEFAULT_TAX_SETTINGS;
  return {
    taxpayer_status: String(data.taxpayer_status ?? "filer"),
    country: String(data.country ?? "PK"),
    tax_year: String(data.tax_year ?? "2025-26"),
    dividend_tax_rate:
      data.dividend_tax_rate !== null && data.dividend_tax_rate !== undefined
        ? Number(data.dividend_tax_rate)
        : null,
    default_payment_window_days: Number(data.default_payment_window_days ?? 30),
    default_face_value: Number(data.default_face_value ?? 10),
    source_note: data.source_note ? String(data.source_note) : null,
    show_forecasts_in_review: Boolean(data.show_forecasts_in_review ?? true),
    auto_create_confirmed: Boolean(data.auto_create_confirmed ?? true),
    updated_at: data.updated_at ? String(data.updated_at) : null,
    configured: true,
  };
}
