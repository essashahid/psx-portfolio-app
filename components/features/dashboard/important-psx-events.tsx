export interface PsxEventRow {
  id: string;
  ticker: string | null;
  title: string;
  url: string;
  category: string | null;
  published_at: string | null;
  /** Number of articles clustered under this event; only shown when above 1. */
  articleCount?: number;
  /** Primary source label when available. */
  source?: string | null;
}

const CATEGORY: Record<string, { label: string; color: string }> = {
  dividend: { label: "Dividend", color: "var(--up-1)" },
  result: { label: "Result", color: "var(--indigo-1)" },
  corporate_announcement: { label: "Corporate action", color: "var(--clay-1)" },
  policy: { label: "Policy", color: "var(--saffron-1)" },
};

/**
 * Important PSX events — the design's four-column ledger: coloured tag,
 * headline, source meta, date.
 */
export function ImportantPsxEvents({ events }: { events: PsxEventRow[] }) {
  return (
    <section>
      <div className="border-b border-rule pb-2.5">
        <h2 className="font-display text-(length:--text-h2) font-normal tracking-editorial text-text-strong">Important PSX events</h2>
      </div>
      {events.length === 0 ? (
        <p className="py-6 text-center text-xs text-text-muted">No recent PSX filings stored.</p>
      ) : (
        <div className="ledger">
          {events.map((e) => {
            const cat = CATEGORY[e.category ?? ""] ?? { label: "Filing", color: "var(--text-faint)" };
            const cleanTitle = e.title.replace(/\s*-\s*PSX Company Announcement$/i, "");
            const meta = [e.source, e.articleCount && e.articleCount > 1 ? `${e.articleCount} reports` : null]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={e.id}
                className="ledger-row grid items-baseline gap-3 sm:gap-5"
                style={{ gridTemplateColumns: "110px minmax(0,1fr) minmax(0,180px) 88px" }}
              >
                <span
                  className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps)"
                  style={{ color: cat.color }}
                >
                  {cat.label}
                </span>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-sm leading-snug text-text-strong hover:underline"
                  title={cleanTitle}
                >
                  {e.ticker ? `${e.ticker} · ` : ""}{cleanTitle}
                </a>
                <span className="hidden truncate text-(length:--text-3xs) text-text-faint sm:block">{meta || "PSX announcements"}</span>
                <span className="figure text-right text-(length:--text-2xs) text-text-muted">{e.published_at?.slice(0, 10) ?? "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
