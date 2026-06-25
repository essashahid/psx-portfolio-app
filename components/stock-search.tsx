"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Star, Briefcase, Clock } from "lucide-react";
import { GenerateReportDialog } from "@/components/stock/generate-report-dialog";
import { cn, formatNumber, formatSignedPct } from "@/lib/utils";

interface Result {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  owned: boolean;
  watched: boolean;
  price: number | null;
  dayChangePct: number | null;
}

const RECENT_KEY = "psx.recentSearches";

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 8);
  } catch {
    return [];
  }
}

export function StockSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [recent] = useState<string[]>(() => loadRecent());
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- Debounced remote search is intentionally synchronized from query text. */
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setHighlight(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const go = useCallback(
    (ticker: string) => {
      const t = ticker.toUpperCase();
      const next = [t, ...loadRecent().filter((r) => r !== t)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      setOpen(false);
      setQuery("");
      router.push(`/stocks/${t}`);
    },
    [router]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlight]) go(results[highlight].ticker);
      else if (query.trim()) go(query.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showRecent = open && query.trim().length === 0 && recent.length > 0;
  const showResults = open && query.trim().length > 0;

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 shadow-[var(--shadow-card)] focus-within:ring-2 focus-within:ring-emerald-500/40">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search any PSX stock — ticker or company (MEBL, UBL, FFC, Lucky…)"
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      {(showResults || showRecent) && (
        <div className="absolute z-30 mt-1.5 max-h-96 w-full overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg">
          {showRecent && (
            <>
              <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recent
              </p>
              {recent.map((t) => (
                <button
                  key={t}
                  onClick={() => go(t)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
                >
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-semibold">{t}</span>
                </button>
              ))}
            </>
          )}

          {showResults && results.length === 0 && !loading && (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
              No PSX matches for “{query}”. Press Enter to open it anyway.
            </p>
          )}

          {showResults &&
            results.map((r, i) => (
              <button
                key={r.ticker}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(r.ticker)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                  i === highlight ? "bg-accent" : "hover:bg-accent"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{r.ticker}</span>
                    {r.owned && <Briefcase className="h-3 w-3 text-emerald-600" />}
                    {r.watched && <Star className="h-3 w-3 fill-amber-400 text-amber-500" />}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.companyName ?? "—"}
                    {r.sector ? ` · ${r.sector}` : ""}
                  </p>
                </div>
                {r.price !== null && (
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold tabular-nums">{formatNumber(r.price)}</p>
                    {r.dayChangePct !== null && (
                      <p
                        className={cn(
                          "text-[11px] tabular-nums",
                          r.dayChangePct > 0 ? "text-emerald-600" : r.dayChangePct < 0 ? "text-red-600" : "text-muted-foreground"
                        )}
                      >
                        {formatSignedPct(r.dayChangePct)}
                      </p>
                    )}
                  </div>
                )}
                <GenerateReportDialog
                  ticker={r.ticker}
                  companyName={r.companyName}
                  label="Report"
                  triggerVariant="ghost"
                  triggerSize="sm"
                  triggerClassName="h-8 shrink-0 px-2 text-[11px]"
                />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
