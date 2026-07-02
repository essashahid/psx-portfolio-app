"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, EyeOff, ExternalLink, X } from "lucide-react";
import type { NewsEvent } from "@/lib/news/events";
import { SectorChip } from "@/components/sector-chip";
import { cn, formatSignedPct } from "@/lib/utils";

/** Day-change percentages per ticker, used to annotate holding chips. */
export type TickerMoves = Record<string, number | null>;

const READ_KEY = "news-read-v1";
const READ_CAP = 600;

function loadRead(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function persistRead(id: string) {
  try {
    const ids = [...loadRead().add(id)];
    localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-READ_CAP)));
  } catch {
    /* storage unavailable */
  }
}

function useEventState(event: NewsEvent) {
  const [saved, setSaved] = useState(event.saved);
  const [hidden, setHidden] = useState(event.ignored);
  const [read, setRead] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loadRead().has(event.id)) setRead(true);
  }, [event.id]);

  const markRead = () => {
    setRead(true);
    persistRead(event.id);
  };

  const openDrawer = () => {
    markRead();
    setOpen(true);
  };

  async function toggle(field: "saved" | "ignored") {
    const next = field === "saved" ? !saved : !hidden;
    if (field === "saved") setSaved(next);
    else setHidden(next);
    try {
      const res = await fetch("/api/news/article-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: event.primaryArticleId,
          storage: event.storage,
          field,
          value: next,
        }),
      });
      if (!res.ok) throw new Error("Article action failed");
    } catch {
      if (field === "saved") setSaved(!next);
      else setHidden(!next);
    }
  }

  return { saved, hidden, read, open, setOpen, openDrawer, markRead, toggle };
}

/** Chips for affected holdings (with day move), sectors and macro assets. */
function AffectedChips({ event, moves, max = 6 }: { event: NewsEvent; moves?: TickerMoves; max?: number }) {
  const holdings = event.affectedHoldings.slice(0, max);
  const sectors = event.affectedSectors.slice(0, Math.max(0, max - holdings.length));
  const assets = event.affectedAssets.slice(0, Math.max(0, max - holdings.length - sectors.length));
  if (holdings.length + sectors.length + assets.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {holdings.map((ticker) => {
        const move = moves?.[ticker];
        return (
          <Link
            key={ticker}
            href={`/news?ticker=${encodeURIComponent(ticker)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
            title={`Filter news for ${ticker}`}
          >
            {ticker}
            {typeof move === "number" && (
              <span className={cn("tabular-nums", move > 0 ? "text-emerald-700" : move < 0 ? "text-red-700" : "text-muted-foreground")}>
                {formatSignedPct(move)}
              </span>
            )}
          </Link>
        );
      })}
      {sectors.map((sector) => (
        <Link key={sector} href={`/news?q=${encodeURIComponent(sector)}`} title={`Search news for ${sector}`}>
          <SectorChip sector={sector} size="xs" className="transition-opacity hover:opacity-80" />
        </Link>
      ))}
      {assets.map((asset) => (
        <span key={asset} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground/70">
          {asset}
        </span>
      ))}
    </div>
  );
}

export function NewsEventCard({
  event,
  featured = false,
  moves,
}: {
  event: NewsEvent;
  featured?: boolean;
  moves?: TickerMoves;
}) {
  const state = useEventState(event);

  return (
    <>
      <article
        className={cn(
          "group rounded-lg border border-border bg-card transition-colors hover:border-foreground/20",
          featured ? "p-5 shadow-card" : "p-4",
          state.hidden && "opacity-45"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <button type="button" onClick={state.openDrawer} className="block w-full text-left">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/75">{event.suggested ? "Suggested for you" : event.verification}</span>
                <span aria-hidden>·</span>
                <span>{event.eventType}</span>
                <span aria-hidden>·</span>
                <span>{event.timeLabel}</span>
              </div>
              <h2
                className={cn(
                  "mt-2 font-semibold leading-snug tracking-editorial transition-colors",
                  featured ? "text-xl sm:text-2xl" : "text-base",
                  state.read ? "text-foreground/60" : "text-foreground"
                )}
              >
                {event.title}
              </h2>
              {event.summary && (
                <p className={cn("mt-2 leading-relaxed text-muted-foreground", featured ? "text-sm" : "line-clamp-2 text-sm")}>
                  {event.summary}
                </p>
              )}
              {event.whySuggested && (
                <p className="mt-3 text-sm leading-relaxed text-foreground/85">
                  <span className="font-medium">Why suggested: </span>
                  {event.whySuggested}
                </p>
              )}
              {event.potentialRelevance && (
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground/75">Potential relevance: </span>
                  {event.potentialRelevance}
                </p>
              )}
            </button>
            <div className="mt-3 space-y-3">
              <AffectedChips event={event} moves={moves} />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span>{event.importance} importance</span>
                <span aria-hidden>·</span>
                <span>{event.sourceStatus}</span>
                <span aria-hidden>·</span>
                <span>{event.source}</span>
                {event.relatedCount > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{event.relatedCount + 1} related sources</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <IconButton active={state.saved} onClick={() => state.toggle("saved")} label={state.saved ? "Unsave" : "Save"}>
              <Bookmark className="h-4 w-4" fill={state.saved ? "currentColor" : "none"} />
            </IconButton>
            <IconButton active={state.hidden} onClick={() => state.toggle("ignored")} label={state.hidden ? "Un-hide" : "Hide"}>
              <EyeOff className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </article>

      {state.open && (
        <EventDetailDrawer event={event} onClose={() => state.setOpen(false)} saved={state.saved} hidden={state.hidden} onToggle={state.toggle} />
      )}
    </>
  );
}

/**
 * Dense single-line variant for the compact feed view: time, title, tickers
 * and source on one row, with actions revealed on hover.
 */
export function NewsEventRow({ event, moves }: { event: NewsEvent; moves?: TickerMoves }) {
  const state = useEventState(event);
  const firstTicker = event.affectedHoldings[0];
  const move = firstTicker ? moves?.[firstTicker] : null;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40",
          state.hidden && "opacity-45"
        )}
      >
        <span className="w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground">{event.timeLabel}</span>
        <button
          type="button"
          onClick={state.openDrawer}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-sm font-medium transition-colors hover:text-foreground",
            state.read ? "text-foreground/55" : "text-foreground/90"
          )}
          title={event.title}
        >
          {event.title}
        </button>
        {firstTicker && (
          <Link
            href={`/news?ticker=${encodeURIComponent(firstTicker)}`}
            className="hidden shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground/75 transition-colors hover:border-foreground/30 sm:inline-flex"
          >
            {firstTicker}
            {typeof move === "number" && (
              <span className={cn("tabular-nums", move > 0 ? "text-emerald-700" : move < 0 ? "text-red-700" : "text-muted-foreground")}>
                {formatSignedPct(move)}
              </span>
            )}
          </Link>
        )}
        <span className="hidden w-32 shrink-0 truncate text-right text-[11px] text-muted-foreground md:block" title={event.source}>
          {event.source}
        </span>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton active={state.saved} onClick={() => state.toggle("saved")} label={state.saved ? "Unsave" : "Save"} small>
            <Bookmark className="h-3.5 w-3.5" fill={state.saved ? "currentColor" : "none"} />
          </IconButton>
          <IconButton active={state.hidden} onClick={() => state.toggle("ignored")} label={state.hidden ? "Un-hide" : "Hide"} small>
            <EyeOff className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {state.open && (
        <EventDetailDrawer event={event} onClose={() => state.setOpen(false)} saved={state.saved} hidden={state.hidden} onToggle={state.toggle} />
      )}
    </div>
  );
}

function EventDetailDrawer({
  event,
  onClose,
  saved,
  hidden,
  onToggle,
}: {
  event: NewsEvent;
  onClose: () => void;
  saved: boolean;
  hidden: boolean;
  onToggle: (field: "saved" | "ignored") => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="palette-overlay fixed inset-0 z-50 bg-background/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="palette-panel absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">{event.verification} · {event.importance} importance</p>
            <h2 className="mt-1 line-clamp-2 text-base font-semibold">{event.title}</h2>
          </div>
          <button onClick={onClose} className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          <DetailSection title="What happened">
            <p>{event.summary ?? event.title}</p>
          </DetailSection>

          {event.whySuggested && (
            <DetailSection title="Why suggested">
              <p>{event.whySuggested}</p>
            </DetailSection>
          )}

          {event.potentialRelevance && (
            <DetailSection title="Why it matters">
              <p>{event.potentialRelevance}</p>
            </DetailSection>
          )}

          <DetailSection title="Affected assets">
            {event.affectedHoldings.length || event.affectedSectors.length || event.affectedAssets.length ? (
              <div className="flex flex-wrap gap-1.5">
                {event.affectedHoldings.map((ticker) => (
                  <Link
                    key={ticker}
                    href={`/stocks/${ticker}`}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:border-foreground/30"
                    title={`Open ${ticker}`}
                  >
                    {ticker}
                  </Link>
                ))}
                {event.affectedSectors.map((sector) => (
                  <SectorChip key={sector} sector={sector} />
                ))}
                {event.affectedAssets.map((asset) => (
                  <span key={asset} className="rounded-md border border-border px-2 py-1 text-xs">{asset}</span>
                ))}
              </div>
            ) : (
              <p>No direct holding or watchlist relationship was identified.</p>
            )}
          </DetailSection>

          {event.whatToWatch.length > 0 && (
            <DetailSection title="What to watch">
              <ul className="space-y-1.5">
                {event.whatToWatch.map((item) => (
                  <li key={item} className="text-sm text-foreground/85">- {item}</li>
                ))}
              </ul>
            </DetailSection>
          )}

          <DetailSection title="Sources">
            <p>{event.sourceStatus}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {event.relatedSources.map((source) => (
                <span key={source} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{source}</span>
              ))}
            </div>
            <a href={event.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
              Open original source <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </DetailSection>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <button onClick={() => onToggle("saved")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              {saved ? "Unsave" : "Save"}
            </button>
            <button onClick={() => onToggle("ignored")} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              {hidden ? "Un-hide" : "Hide"}
            </button>
            <a href={event.url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Open source
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="text-sm leading-relaxed text-foreground/85">{children}</div>
    </section>
  );
}

function IconButton({
  active,
  onClick,
  label,
  children,
  small = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        small ? "h-7 w-7" : "h-8 w-8",
        active && "text-foreground"
      )}
    >
      {children}
    </button>
  );
}
