import { createClient, getUser } from "@/lib/supabase/server";
import { claudeConfigured } from "@/lib/ai/claude";
import { deepseekChatConfigured } from "@/lib/ai/deepseek-chat";
import { getDataFreshness } from "@/lib/market/read";
import { getPortfolio } from "@/lib/portfolio";
import { Chat, type ChatThread } from "@/components/chat/chat";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [{ data: threads }, freshness, portfolio] = await Promise.all([
    supabase.from("chat_threads").select("id, title, summary, created_at, updated_at, last_message_at").eq("user_id", user.id).order("last_message_at", { ascending: false }).limit(50),
    getDataFreshness(supabase, user.id),
    getPortfolio(supabase, user.id),
  ]);
  const sources = freshness.filter((item) => item.date && item.key !== "brief").map((item) => `${item.label} · ${item.date}`);
  const belowCost = portfolio.holdings.find((holding) => (holding.unrealized_pl ?? 0) < 0);
  const prompts = [
    portfolio.largestHolding ? `Why is ${portfolio.largestHolding.ticker} my largest portfolio contributor?` : "Which holdings created the most total return after dividends and fees?",
    `How has my ${portfolio.holdings.find((holding) => holding.ticker === "UBL")?.ticker ?? portfolio.holdings[0]?.ticker ?? "largest"} position performed after dividends?`,
    belowCost ? `Why is ${belowCost.ticker} below my average cost?` : "Which of my holdings are currently below average cost?",
    "Summarise today’s official filings affecting my holdings.",
    "Which of my holdings outperformed their sectors today?",
  ];

  return (
    <div className="space-y-4">
      <header className="hidden border-b border-border pb-4 md:block">
        <p className="eyebrow">Assistant</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Research Copilot</h1>
        <p className="mt-1 text-sm text-muted-foreground">Research your portfolio and the PSX using holdings, transactions, financials, market data and official filings.</p>
        {sources.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{sources.join(" · ")}</p>}
      </header>
      <Chat
        providers={{ claude: claudeConfigured(), deepseek: deepseekChatConfigured() }}
        initialThreads={(threads ?? []) as ChatThread[]}
        suggestions={prompts}
        sourceStatus={sources}
      />
    </div>
  );
}
