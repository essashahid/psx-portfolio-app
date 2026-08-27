/**
 * The contract for GET /api/portfolio/settings and PATCH /api/settings/profile.
 *
 * The profile fields decide how the Copilot pitches an answer, so they are not
 * decoration: an experience level set to "beginner" changes what every
 * explanation in the app sounds like.
 */

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type Objective = "growth" | "income" | "preservation" | "learning";

export const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string; detail: string }[] = [
  { value: "beginner", label: "New to investing", detail: "Plain-language analysis" },
  { value: "intermediate", label: "Comfortable", detail: "Balanced analysis" },
  { value: "advanced", label: "Experienced", detail: "Denser analysis" },
];

export const RISK_OPTIONS: { value: RiskProfile; label: string }[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Growth seeking" },
];

export const OBJECTIVE_OPTIONS: { value: Objective; label: string }[] = [
  { value: "growth", label: "Long-term growth" },
  { value: "income", label: "Dividend income" },
  { value: "preservation", label: "Preserve capital" },
  { value: "learning", label: "Learn as I go" },
];

export interface SettingsProfile {
  email: string | null;
  fullName: string | null;
  experienceLevel: ExperienceLevel;
  riskProfile: RiskProfile | null;
  objective: Objective | null;
  /**
   * Cash sitting with the broker that no transaction accounts for. Never null
   * in practice: the column is NOT NULL, and clearing the field means zero
   * rather than unknown.
   */
  freeCash: number | null;
}

export interface SettingsTax {
  taxpayerStatus: string;
  taxYear: string;
  /** Stored as a fraction; shown as a percentage. */
  dividendTaxRate: number | null;
  defaultPaymentWindowDays: number;
  defaultFaceValue: number;
  showForecastsInReview: boolean;
  autoCreateConfirmed: boolean;
  /** False until the user has saved once, so defaults are not passed off as settings. */
  configured: boolean;
}

export interface SettingsResponse {
  profile: SettingsProfile;
  tax: SettingsTax;
  /** Counts, so the data-management section can say what it would remove. */
  transactionCount: number;
  holdingsCount: number;
  watchlistCount: number;
}
