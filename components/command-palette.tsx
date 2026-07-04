"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Star, Briefcase, CornerDownLeft, Sparkles, ArrowRight, Clock } from "lucide-react";
import { cn, formatNumber, formatSignedPct } from "@/lib/utils";

type NavTarget = { href: string; label: string; hint?: string };

interface TickerResult {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  owned: boolean;
  watched: boolean;
  price: number | null;
  dayChangePct: number | null;
}

type Item =
  | { kind: "nav"; href: string; label: string; hint?: string }
  | { kind: "ticker"; result: TickerResult }
  | { kind: "copilot"; question: string }
  | { kind: "compare"; tickers: string[] };

const RECENT_KEY = "psx.recentSearches";

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Global command palette. One ⌘K owner for the whole app: jump to any tab, any
 * PSX ticker, compare a list, or hand the query to the Copilot. Ticker search
 * reuses /api/stocks/search; navigation targets are the user's visible tabs.
 */
export function CommandPalette({ nav }: { nav: NavTarget[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [isMac, setIsMac] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- platform is client-only.
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setHighlight(0);
  }, []);

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
        setRecent(loadRecent());
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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

  /* eslint-disable react-hooks/set-state-in-effect -- debounced remote search synced from query. */
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

  const q = query.trim();
  const navMatches = useMemo(() => {
    if (!q) return [];
    const lower = q.toLowerCase();
    return nav.filter((n) => n.label.toLowerCase().includes(lower) || n.hint?.toLowerCase().includes(lower)).slice(0, 5);
  }, [nav, q]);

  // Detect a compare intent: two or more comma/space separated ticker-like tokens.
  const compareTickers = useMemo(() => {
    if (!q) return [];
    const tokens = q.toUpperCase().split(/[,\s]+/).filter((t) => /^[A-Z]{2,8}$/.test(t));
    return tokens.length >= 2 ? [...new Set(tokens)].slice(0, 4) : [];
  }, [q]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const n of navMatches) out.push({ kind: "nav", href: n.href, label: n.label, hint: n.hint });
    for (const r of results) out.push({ kind: "ticker", result: r });
    if (compareTickers.length >= 2) out.push({ kind: "compare", tickers: compareTickers });
    if (q.length >= 2) out.push({ kind: "copilot", question: q });
    return out;
  }, [navMatches, results, compareTickers, q]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep highlight in range as items change.
    setHighlight(0);
  }, [q]);

  const goTicker = useCallback(
    (ticker: string) => {
      const t = ticker.toUpperCase();
      const next = [t, ...loadRecent().filter((r) => r !== t)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      close();
      router.push(`/stocks/${t}`);
    },
    [router, close]
  );

  const activate = useCallback(
    (item: Item) => {
      if (item.kind === "nav") {
        close();
        router.push(item.href);
      } else if (item.kind === "ticker") {
        goTicker(item.result.ticker);
      } else if (item.kind === "compare") {
        close();
        router.push(`/stocks/compare?t=${item.tickers.join(",")}`);
      } else {
        close();
        router.push(`/chat?q=${encodeURIComponent(item.question)}`);
      }
    },
    [router, close, goTicker]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[highlight]) activate(items[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const modKey = isMac ? "⌘" : "Ctrl";
  if (!open) return null;

  return (
    <div
      className="palette-overlay fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="palette-panel w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a tab, search a ticker, or ask Copilot…"
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <kbd className="hidden shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground sm:inline-block">esc</kbd>
          )}
        </div>

        <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
          {!q && recent.length > 0 && (
            <div className="px-2 py-2">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Clock className="h-3 w-3" /> Recent</p>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((t) => (
                  <button key={t} onClick={() => goTicker(t)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold transition-colors hover:border-emerald-500/50 hover:bg-accent">{t}</button>
                ))}
              </div>
            </div>
          )}

          {!q && recent.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">Type to jump to a tab, find a stock, or ask the Copilot.</p>
          )}

          {q && items.length === 0 && !loading && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">No matches for “{q}”.</p>
          )}

          {items.map((item, i) => {
            const active = i === highlight;
            const rowClass = cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors", active ? "bg-accent" : "hover:bg-accent");
            if (item.kind === "nav") {
              return (
                <div key={`nav-${item.href}`} onMouseEnter={() => setHighlight(i)} onClick={() => activate(item)} className={rowClass}>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.label}</p>
                    {item.hint && <p className="truncate text-xs text-muted-foreground">{item.hint}</p>}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Tab</span>
                </div>
              );
            }
            if (item.kind === "ticker") {
              const r = item.result;
              return (
                <div key={`t-${r.ticker}`} onMouseEnter={() => setHighlight(i)} onClick={() => activate(item)} className={rowClass}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold">{r.ticker}</span>
                      {r.owned && <Briefcase className="h-3 w-3 text-emerald-600" />}
                      {r.watched && <Star className="h-3 w-3 fill-amber-400 text-amber-500" />}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{r.companyName ?? "—"}{r.sector ? ` · ${r.sector}` : ""}</p>
                  </div>
                  {r.price !== null && (
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-semibold tabular-nums">{formatNumber(r.price)}</p>
                      {r.dayChangePct !== null && (
                        <p className={cn("text-[11px] tabular-nums", r.dayChangePct > 0 ? "text-emerald-600" : r.dayChangePct < 0 ? "text-red-600" : "text-muted-foreground")}>{formatSignedPct(r.dayChangePct)}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            if (item.kind === "compare") {
              return (
                <div key="compare" onMouseEnter={() => setHighlight(i)} onClick={() => activate(item)} className={rowClass}>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="flex-1 text-sm font-medium">Compare {item.tickers.join(", ")}</p>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Compare</span>
                </div>
              );
            }
            return (
              <div key="copilot" onMouseEnter={() => setHighlight(i)} onClick={() => activate(item)} className={rowClass}>
                <Sparkles className="h-4 w-4 shrink-0 text-brand" />
                <p className="flex-1 truncate text-sm font-medium">Ask Copilot: <span className="text-muted-foreground">{item.question}</span></p>
              </div>
            );
          })}
        </div>

        <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> open</span>
          <span className="flex items-center gap-1"><span className="font-sans">↑↓</span> navigate</span>
          <span className="ml-auto">{modKey}K to toggle</span>
        </div>
      </div>
    </div>
  );
}
