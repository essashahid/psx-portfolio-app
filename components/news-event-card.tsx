"use client";

import { useState } from "react";
import { Bookmark, EyeOff, ExternalLink, X } from "lucide-react";
import type { NewsEvent } from "@/lib/news/events";
import { cn } from "@/lib/utils";

export function NewsEventCard({ event, featured = false }: { event: NewsEvent; featured?: boolean }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(event.saved);
  const [hidden, setHidden] = useState(event.ignored);

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

  return (
    <>
      <article
        className={cn(
          "group rounded-lg border border-border bg-card transition-colors hover:border-foreground/20",
          featured ? "p-5 shadow-[var(--shadow-card)]" : "p-4",
          hidden && "opacity-45"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/75">{event.suggested ? "Suggested for you" : event.verification}</span>
              <span aria-hidden>·</span>
              <span>{event.eventType}</span>
              <span aria-hidden>·</span>
              <span>{event.timeLabel}</span>
            </div>
            <h2 className={cn("mt-2 font-semibold leading-snug tracking-editorial text-foreground", featured ? "text-xl sm:text-2xl" : "text-base")}>
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
            {(event.affectedHoldings.length > 0 || event.affectedSectors.length > 0 || event.affectedAssets.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[...event.affectedHoldings, ...event.affectedSectors, ...event.affectedAssets].slice(0, 6).map((item) => (
                  <span key={item} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground/75">
                    {item}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
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
          </button>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <IconButton active={saved} onClick={() => toggle("saved")} label={saved ? "Unsave" : "Save"}>
              <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
            </IconButton>
            <IconButton active={hidden} onClick={() => toggle("ignored")} label={hidden ? "Un-hide" : "Hide"}>
              <EyeOff className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </article>

      {open && <EventDetailDrawer event={event} onClose={() => setOpen(false)} saved={saved} hidden={hidden} onToggle={toggle} />}
    </>
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
  return (
    <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-card shadow-2xl">
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
            <div className="flex flex-wrap gap-1.5">
              {[...event.affectedHoldings, ...event.affectedSectors, ...event.affectedAssets].length ? (
                [...event.affectedHoldings, ...event.affectedSectors, ...event.affectedAssets].map((item) => (
                  <span key={item} className="rounded-md border border-border px-2 py-1 text-xs">{item}</span>
                ))
              ) : (
                <p>No direct holding or watchlist relationship was identified.</p>
              )}
            </div>
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "text-foreground"
      )}
    >
      {children}
    </button>
  );
}
