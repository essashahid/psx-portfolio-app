/**
 * Provider configuration with env-key aliases. Users configure keys under
 * slightly different names (ALPHA_VINTAGE_API vs ALPHA_VANTAGE_API_KEY…);
 * the engine accepts all spellings and never crashes because one provider
 * is missing — it just drops out of the fallback chain.
 */

function firstEnv(...names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return null;
}

export type ProviderName =
  | "psx-terminal"
  | "psx-dps"
  | "twelve-data"
  | "finnhub"
  | "alpha-vantage"
  | "tavily"
  | "gemini";

export function alphaVantageKey(): string | null {
  return firstEnv("ALPHA_VANTAGE_API_KEY", "ALPHA_VINTAGE_API", "ALPHA_VANTAGE_API", "ALPHA_VINTAGE_API_KEY");
}

export function finnhubKey(): string | null {
  return firstEnv("FINNHUB_API_KEY", "FINNHUB_API");
}

export function twelveDataKey(): string | null {
  return firstEnv("TWELVE_DATA_API_KEY", "TWELVE_DATA_API", "MARKET_DATA_API_KEY");
}

export function psxTerminalConfig(): { enabled: boolean; baseUrl: string; apiKey: string | null } {
  const enabled = (process.env.PSX_TERMINAL_ENABLED ?? "").toLowerCase() === "true";
  return {
    enabled,
    baseUrl: (process.env.PSX_TERMINAL_BASE_URL ?? "https://psxterminal.com").replace(/\/$/, ""),
    apiKey: firstEnv("PSX_TERMINAL_API_KEY"),
  };
}

export interface ProviderConfig {
  name: ProviderName;
  label: string;
  configured: boolean;
  detail: string;
}

/** Static configuration status of every provider (no network calls). */
export function providerConfigs(): ProviderConfig[] {
  const pt = psxTerminalConfig();
  return [
    {
      name: "psx-dps",
      label: "PSX Data Portal (official)",
      configured: true, // public endpoint, no key needed
      detail: "dps.psx.com.pk — quotes, EOD history, symbol directory, announcements",
    },
    {
      name: "psx-terminal",
      label: "PSX Terminal",
      configured: pt.enabled,
      detail: pt.enabled ? `${pt.baseUrl}${pt.apiKey ? " (key set)" : ""}` : "Set PSX_TERMINAL_ENABLED=true to enable",
    },
    {
      name: "twelve-data",
      label: "Twelve Data",
      configured: !!twelveDataKey(),
      detail: twelveDataKey() ? "Key configured (TWELVE_DATA_API)" : "No key (TWELVE_DATA_API / TWELVE_DATA_API_KEY)",
    },
    {
      name: "finnhub",
      label: "Finnhub",
      configured: !!finnhubKey(),
      detail: finnhubKey() ? "Key configured (FINNHUB_API)" : "No key (FINNHUB_API / FINNHUB_API_KEY)",
    },
    {
      name: "alpha-vantage",
      label: "Alpha Vantage",
      configured: !!alphaVantageKey(),
      detail: alphaVantageKey() ? "Key configured (ALPHA_VINTAGE_API)" : "No key (ALPHA_VINTAGE_API / ALPHA_VANTAGE_API_KEY)",
    },
    {
      name: "tavily",
      label: "Tavily (news discovery)",
      configured: !!process.env.TAVILY_API_KEY,
      detail: process.env.TAVILY_API_KEY ? "Key configured" : "No key (TAVILY_API_KEY)",
    },
    {
      name: "gemini",
      label: "Gemini (extraction & summaries only)",
      configured: !!process.env.GEMINI_API_KEY,
      detail: process.env.GEMINI_API_KEY ? "Key configured — used to parse documents, never to invent numbers" : "No key (GEMINI_API_KEY)",
    },
  ];
}
