"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

/**
 * Replaces the old wall of per-ticker filter pills with a single dropdown.
 * Navigates to the same /news route with the chosen ticker in the query
 * string so the page stays a server component.
 */
export function NewsTickerSelect({
  tickers,
  active,
  tab,
  window,
}: {
  tickers: string[];
  active?: string;
  tab?: string;
  window?: string;
}) {
  const router = useRouter();
  return (
    <Select
      aria-label="Filter by holding"
      value={active ?? ""}
      onChange={(e) => {
        const params = new URLSearchParams();
        if (tab) params.set("tab", tab);
        if (window) params.set("window", window);
        if (e.target.value) params.set("ticker", e.target.value);
        const qs = params.toString();
        router.push(qs ? `/news?${qs}` : "/news");
      }}
      className="h-9 w-auto min-w-34 text-sm"
    >
      <option value="">All holdings</option>
      {tickers.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </Select>
  );
}
