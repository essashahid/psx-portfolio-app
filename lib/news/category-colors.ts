import type { NewsCategory } from "@/lib/news/types";

/**
 * Curated per-category colour + label, so the News Centre reads as an
 * editorial page (a coloured section eyebrow above the headline, the way
 * Bloomberg/Reuters/NYT tag "Technology", "Markets", "Opinion") instead of the
 * plain grey meta line it used to be. Deliberately hand-picked rather than
 * hashed — a small fixed set of categories reads better with intentional
 * colour than an arbitrary generated one.
 */
export type CategoryStyle = {
  label: string;
  color: string;
  background: string;
};

const STYLES: Record<string, CategoryStyle> = {
  market: { label: "Markets", color: "#9a3412", background: "rgba(234,88,12,0.12)" },
  company: { label: "Company", color: "#1d4ed8", background: "rgba(37,99,235,0.10)" },
  earnings: { label: "Earnings", color: "#1d4ed8", background: "rgba(37,99,235,0.10)" },
  result: { label: "Results", color: "#1d4ed8", background: "rgba(37,99,235,0.10)" },
  dividend: { label: "Dividend", color: "#0f766e", background: "rgba(13,148,136,0.12)" },
  corporate_announcement: { label: "Filing", color: "#334155", background: "rgba(51,65,85,0.10)" },
  policy: { label: "Policy", color: "#7c2d92", background: "rgba(147,51,234,0.10)" },
  regulatory: { label: "Regulatory", color: "#7c2d92", background: "rgba(147,51,234,0.10)" },
  economy: { label: "Economy", color: "#b45309", background: "rgba(217,119,6,0.12)" },
  commodity: { label: "Commodities", color: "#854d0e", background: "rgba(202,138,4,0.12)" },
  forex: { label: "Currency", color: "#0e7490", background: "rgba(8,145,178,0.12)" },
  crypto: { label: "Crypto", color: "#a16207", background: "rgba(217,119,6,0.10)" },
  funds: { label: "Funds", color: "#0f766e", background: "rgba(13,148,136,0.10)" },
  international: { label: "Global", color: "#4338ca", background: "rgba(79,70,229,0.10)" },
  geopolitics: { label: "Geopolitics", color: "#be123c", background: "rgba(225,29,72,0.10)" },
  general: { label: "News", color: "#475569", background: "rgba(71,85,105,0.10)" },
};

export function categoryStyle(category: string | null | undefined): CategoryStyle {
  const key = (category ?? "general") as NewsCategory;
  return STYLES[key] ?? STYLES.general;
}
