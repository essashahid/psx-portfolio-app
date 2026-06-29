import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";

export interface PsxEventRow {
  id: string;
  ticker: string | null;
  title: string;
  url: string;
  category: string | null;
  published_at: string | null;
}

const CATEGORY_LABEL: Record<string, { label: string; variant: "green" | "blue" | "amber" | "secondary" }> = {
  dividend: { label: "Dividend", variant: "green" },
  result: { label: "Result", variant: "blue" },
  corporate_announcement: { label: "Corporate action", variant: "amber" },
};

/** Official PSX filings that matter: dividends, results, corporate actions, material info. */
export function ImportantPsxEvents({ events }: { events: PsxEventRow[] }) {
  return (
    <section className="border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Important PSX Events</h2>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {events.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No recent PSX filings stored.
          </p>
        ) : (
          events.map((e) => {
            const cat = CATEGORY_LABEL[e.category ?? ""] ?? { label: "Filing", variant: "secondary" as const };
            const cleanTitle = e.title.replace(/\s*-\s*PSX Company Announcement$/i, "");
            return (
              <div key={e.id} className="flex items-start gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                <Badge variant={cat.variant}>{cat.label}</Badge>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 text-xs leading-snug hover:underline"
                >
                  <span className="font-medium">{e.ticker ?? "—"}</span> · {cleanTitle}
                  {e.published_at && (
                    <span className="ml-1 text-muted-foreground">({e.published_at.slice(0, 10)})</span>
                  )}
                </a>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
