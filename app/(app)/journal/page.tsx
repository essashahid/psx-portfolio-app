import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { JournalForm } from "@/components/journal-form";
import { ActionButton } from "@/components/action-button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Sparkles, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  buy_decision: "Buy decision",
  sell_decision: "Sell decision",
  hold_review: "Hold/review",
  news_reaction: "News reaction",
  result_review: "Result review",
  dividend_review: "Dividend review",
  general_note: "General note",
};

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string; type?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const { data: holdings } = await supabase
    .from("holdings")
    .select("ticker")
    .eq("user_id", user.id)
    .order("ticker");
  const tickers = (holdings ?? []).map((h) => h.ticker);

  let query = supabase
    .from("journal_entries")
    .select("*")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (sp.ticker) query = query.eq("ticker", sp.ticker);
  if (sp.type) query = query.eq("entry_type", sp.type);
  if (sp.q) query = query.or(`title.ilike.%${sp.q}%,body.ilike.%${sp.q}%`);
  const { data: entries } = await query;

  const filterLink = (patch: Record<string, string | undefined>, label: string, active: boolean) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) params.set(k, v);
    return (
      <Link
        key={label}
        href={`/journal?${params.toString()}`}
        className={cn(
          "rounded-full border px-2.5 py-1 text-[11px] font-medium",
          active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Investment Journal"
        description="Write down decisions before the market grades them. AI can analyze your patterns over time."
        actions={
          <>
            <ActionButton
              endpoint="/api/ai/journal"
              label={<><Sparkles className="h-3.5 w-3.5" /> Analyze my patterns</>}
              variant="outline"
              size="sm"
              onSuccessMessage="Analysis saved — see AI Briefings."
            />
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download, not a page navigation */}
            <a href="/api/export/journal">
              <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> Export CSV</Button>
            </a>
          </>
        }
      />

      <JournalForm tickers={tickers} defaultTicker={sp.ticker} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {filterLink({ ticker: undefined }, "All tickers", !sp.ticker)}
          {tickers.map((t) => filterLink({ ticker: t }, t, sp.ticker === t))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {filterLink({ type: undefined }, "All types", !sp.type)}
          {Object.entries(TYPE_LABEL).map(([v, l]) => filterLink({ type: v }, l, sp.type === v))}
        </div>
        <form method="get" className="flex max-w-xs items-center gap-2">
          {sp.ticker && <input type="hidden" name="ticker" value={sp.ticker} />}
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search entries…"
            className="h-8 w-full rounded-md border border-border bg-card px-3 text-xs"
          />
          <Button type="submit" size="sm" variant="outline">Search</Button>
        </form>
      </div>

      <div className="space-y-3">
        {(entries ?? []).length === 0 && (
          <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">No journal entries match.</CardContent></Card>
        )}
        {(entries ?? []).map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tabular-nums">{e.entry_date}</span>
                <Badge variant="outline">{TYPE_LABEL[e.entry_type] ?? e.entry_type}</Badge>
                {e.ticker && (
                  <Link href={`/stocks/${e.ticker}`}>
                    <Badge variant="blue">{e.ticker}</Badge>
                  </Link>
                )}
                {e.confidence && <Badge variant="secondary">confidence {e.confidence}/5</Badge>}
                {e.source === "ai" && <Badge variant="amber">AI generated</Badge>}
                {e.follow_up_date && <span className="text-[11px] text-muted-foreground">follow up {e.follow_up_date}</span>}
              </div>
              <h3 className="mt-2 text-sm font-semibold">{e.title}</h3>
              {e.body && (
                <div className="mt-1 max-h-56 overflow-y-auto">
                  <Markdown content={e.body} />
                </div>
              )}
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                {e.expected_outcome && <p><span className="font-medium text-foreground">Expected:</span> {e.expected_outcome}</p>}
                {e.risk && <p><span className="font-medium text-foreground">Risk:</span> {e.risk}</p>}
                {e.outcome && <p><span className="font-medium text-foreground">Outcome:</span> {e.outcome}</p>}
                {e.lessons && <p><span className="font-medium text-foreground">Lessons:</span> {e.lessons}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
