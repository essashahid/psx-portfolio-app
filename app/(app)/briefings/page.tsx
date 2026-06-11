import { createClient, getUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/action-button";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

const GENERATORS = [
  { type: "daily", label: "Daily briefing" },
  { type: "weekly", label: "Weekly briefing" },
  { type: "risk_review", label: "Risk review" },
  { type: "news_only", label: "News-only briefing" },
  { type: "dividend_review", label: "Dividend review" },
  { type: "thesis_review", label: "Thesis review" },
];

const TYPE_BADGE: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  risk_review: "Risk",
  news_only: "News",
  dividend_review: "Dividends",
  thesis_review: "Thesis",
  journal_analysis: "Journal",
  stock_review: "Stock",
};

export default async function BriefingsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  let query = supabase
    .from("ai_briefings")
    .select("id, briefing_type, ticker, title, content, model, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (sp.type) query = query.eq("briefing_type", sp.type);
  const { data: briefings } = await query;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Intelligence"
        title="AI Briefings"
        description="Generated from your actual portfolio, news and journal. Stored permanently, never financial advice."
      />

      <Card>
        <CardHeader>
          <CardTitle>Generate a briefing</CardTitle>
          <CardDescription>
            Each briefing reads your holdings, prices, targets, theses, recent news, alerts and journal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {GENERATORS.map((g) => (
            <ActionButton
              key={g.type}
              endpoint="/api/ai/briefing"
              body={{ type: g.type }}
              label={<><Sparkles className="h-3.5 w-3.5" /> {g.label}</>}
              variant="outline"
              size="sm"
              onSuccessMessage={`${g.label} generated below.`}
            />
          ))}
        </CardContent>
      </Card>

      {(briefings ?? []).length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No briefings yet"
          description="Generate your first briefing above. You need at least one holding (or demo data) first."
        />
      ) : (
        <div className="space-y-3">
          {(briefings ?? []).map((b) => (
            <Card key={b.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {b.title ?? b.briefing_type}
                    <Badge variant="blue">{TYPE_BADGE[b.briefing_type] ?? b.briefing_type}</Badge>
                    {b.ticker && <Badge variant="outline">{b.ticker}</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {b.created_at.slice(0, 16).replace("T", " ")} · model {b.model ?? "?"}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <details open={b.id === briefings![0].id}>
                  <summary className="cursor-pointer text-xs text-muted-foreground">show / hide</summary>
                  <Markdown content={b.content} className="mt-2" />
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
