"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/shared/format";

export interface SpineEntry {
  date: string | null;
  title: string;
  category: string;
  url: string | null;
  source: string;
  /** The one figure this entry moved, when we can prove which. */
  moved: string | null;
  /** Said instead when the entry is known to have moved nothing yet. */
  pending: string | null;
}

const CATEGORY: Record<string, { label: string; color: string }> = {
  result: { label: "Result", color: "var(--sp-indigo)" },
  dividend: { label: "Dividend", color: "var(--sp-olive)" },
  board_meeting: { label: "Board meeting", color: "var(--sp-slate)" },
  material: { label: "Material information", color: "var(--sp-violet)" },
  corporate_announcement: { label: "Corporate action", color: "var(--sp-violet)" },
  news: { label: "Press coverage", color: "var(--sp-neutral)" },
};

const meta = (c: string) => CATEGORY[c] ?? { label: "Announcement", color: "var(--sp-neutral)" };

const MONTH = new Intl.DateTimeFormat("en-PK", { month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("en-PK", { day: "2-digit", month: "short" });

/**
 * Filings and news on one dated spine, newest first.
 *
 * The spine is its own grid column rather than a border on each row, so the
 * line runs unbroken between entries and through the month headings instead of
 * restarting at every gap.
 *
 * Each entry names the one figure it moved where that can be established from
 * our own records. Where an announcement is known to have moved nothing yet —
 * a board meeting called to approve accounts that have not been filed — it says
 * so. Where we simply cannot tell, it says nothing rather than guessing, since
 * the whole point of the line is that it can be trusted.
 */
export function FilingsSpine({ entries }: { entries: SpineEntry[] }) {
  const [filter, setFilter] = useState<string>("all");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [entries]);

  const shown = filter === "all" ? entries : entries.filter((e) => e.category === filter);

  // Group by month for the headings, keeping the incoming order.
  const groups: { label: string; items: SpineEntry[] }[] = [];
  for (const e of shown) {
    const t = e.date ? Date.parse(e.date) : NaN;
    const label = Number.isFinite(t) ? MONTH.format(new Date(t)) : "Undated";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  const chips = [
    { key: "all", label: "Everything", n: entries.length, color: "var(--ink-1)" },
    ...[...counts.entries()].map(([key, n]) => ({ key, label: meta(key).label, n, color: meta(key).color })),
  ];

  return (
    <div>
      <div className="mb-7 flex flex-wrap gap-2">
        {chips.map((c) => {
          const on = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-(--radius-pill) border px-3.5 py-1.5 text-(length:--text-2xs) transition-colors",
                on
                  ? "border-transparent bg-ink-1 font-semibold text-(--text-on-dark)"
                  : "border-rule font-medium text-text-muted hover:text-text-strong"
              )}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: on ? "currentColor" : c.color }} />
              {c.label}
              <span className="figure opacity-60">{c.n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
          Nothing in this category.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.label}>
            <p className="mb-3 mt-6 border-b border-rule pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint first:mt-0">
              {g.label}
            </p>
            {g.items.map((e, i) => {
              const m = meta(e.category);
              const t = e.date ? Date.parse(e.date) : NaN;
              return (
                <article
                  key={`${e.date}-${i}-${e.title.slice(0, 24)}`}
                  className="grid grid-cols-[5.5rem_1px_minmax(0,1fr)] gap-x-5"
                >
                  <div className="pt-0.5 text-right">
                    <p className="figure text-sm text-text-strong">
                      {Number.isFinite(t) ? DAY.format(new Date(t)) : "—"}
                    </p>
                    <p className="figure text-(length:--text-2xs) text-text-faint">
                      {Number.isFinite(t) ? new Date(t).getFullYear() : ""}
                    </p>
                  </div>
                  {/* The middle column is the spine, so it never breaks between rows. */}
                  <div className="relative bg-rule">
                    <span
                      className="absolute -left-[3.5px] top-1.5 h-[9px] w-[9px] rounded-full"
                      style={{ background: m.color }}
                    />
                  </div>
                  <div className="pb-7">
                    <p
                      className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps)"
                      style={{ color: m.color }}
                    >
                      {m.label}
                    </p>
                    <p className="mt-1.5 max-w-(--measure) text-sm leading-relaxed text-text-strong">{e.title}</p>
                    {e.moved ? (
                      <p className="mt-2.5 inline-block border-l-2 border-rule-strong bg-surface-sunken py-1.5 pl-3 pr-4 text-(length:--text-2xs) text-text-muted">
                        <span className="figure">{e.moved}</span>
                      </p>
                    ) : e.pending ? (
                      <p className="mt-2 text-(length:--text-2xs) text-text-faint">{e.pending}</p>
                    ) : null}
                    <p className="mt-2 flex flex-wrap items-center gap-3 text-(length:--text-2xs) text-text-faint">
                      <span>{e.source}</span>
                      {e.url && (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-indigo transition-colors hover:underline"
                        >
                          Read the notice ↗
                        </a>
                      )}
                    </p>
                  </div>
                </article>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
