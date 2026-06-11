import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, ArrowRight } from "lucide-react";

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
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Important PSX Events</CardTitle>
        </div>
        <Link href="/news" className="text-xs text-muted-foreground hover:text-foreground">
          News Center <ArrowRight className="inline h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No recent PSX filings stored. Refresh from the News Center.
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
      </CardContent>
    </Card>
  );
}
