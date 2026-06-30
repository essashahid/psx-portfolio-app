"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Star, Briefcase, Clock, CornerDownLeft } from "lucide-react";
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

export function StockSearch({
  autoFocus = false,
  companyReportsEnabled = false,
}: {
  autoFocus?: boolean;
  companyReportsEnabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [isMac, setIsMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Platform is only knowable on the client after mount.
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  const openPalette = useCallback(() => {
    setRecent(loadRecent());
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setHighlight(0);
  }, []);

  // Global shortcut: ⌘K / Ctrl-K anywhere, or "/" when not typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setRecent(loadRecent());
        setOpen((o) => !o);
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        openPalette();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, openPalette]);

  // Lock body scroll and focus the input while the palette is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      clearTimeout(t);
    };
  }, [open]);

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
      closePalette();
      router.push(`/stocks/${t}`);
    },
    [router, closePalette]
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
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  }

  const showResults = query.trim().length > 0;
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <>
      {/* Slim trigger — looks like a field, behaves like a command launcher. */}
      <button
        type="button"
        onClick={openPalette}
        autoFocus={autoFocus}
        className="group flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 text-left shadow-[var(--shadow-card)] transition-colors hover:border-emerald-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-emerald-600" />
        <span className="text-sm text-muted-foreground">Search PSX by ticker or company</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground sm:inline-flex">
          {modKey}K
        </kbd>
      </button>

      {open && (
        <div
          className="palette-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh] backdrop-blur-[2px]"
          onMouseDown={closePalette}
          role="dialog"
          aria-modal="true"
          aria-label="Search PSX"
        >
          <div
            className="palette-panel w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Input row */}
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search any PSX stock…"
                className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
              {loading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <kbd className="hidden shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground sm:inline-block">
                  esc
                </kbd>
              )}
            </div>

            <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
              {/* Recents — compact chips, distinct from result rows. */}
              {!showResults && recent.length > 0 && (
                <div className="px-2 py-2">
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Clock className="h-3 w-3" /> Recent
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recent.map((t) => (
                      <button
                        key={t}
                        onClick={() => go(t)}
                        className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold transition-colors hover:border-emerald-500/50 hover:bg-accent"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!showResults && recent.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  Start typing a ticker or company name.
                </p>
              )}

              {showResults && results.length === 0 && !loading && (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No PSX matches for “{query.trim()}”.
                </p>
              )}

              {showResults &&
                results.map((r, i) => (
                  <div
                    key={r.ticker}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg pl-2.5 pr-1.5 transition-colors",
                      i === highlight ? "bg-accent" : "hover:bg-accent"
                    )}
                  >
                    <button
                      onClick={() => go(r.ticker)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
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
                    </button>
                    {companyReportsEnabled && (
                      <GenerateReportDialog
                        ticker={r.ticker}
                        companyName={r.companyName}
                        label="Report"
                        triggerVariant="ghost"
                        triggerSize="sm"
                        triggerClassName="h-8 shrink-0 px-2 text-[11px]"
                      />
                    )}
                  </div>
                ))}
            </div>

            {/* Footer hint */}
            <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" /> open
              </span>
              <span className="flex items-center gap-1">
                <span className="font-sans">↑↓</span> navigate
              </span>
              <span className="ml-auto">esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
