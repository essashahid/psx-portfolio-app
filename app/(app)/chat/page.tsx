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
  const freshnessItems = freshness.filter((item) => item.date && item.key !== "brief");
  const sources = freshnessItems.map((item) => `${item.label} · ${item.date}`);
  const latestDate = freshnessItems.map((item) => item.date as string).sort().at(-1) ?? null;
  const dataUpdated = latestDate
    ? new Date(latestDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const prompts = [
    portfolio.largestHolding ? `Why is ${portfolio.largestHolding.ticker} my largest portfolio contributor?` : "Which holdings created the most total return after dividends and fees?",
    `How has my ${portfolio.holdings.find((holding) => holding.ticker === "UBL")?.ticker ?? portfolio.holdings[0]?.ticker ?? "largest"} position performed after dividends?`,
    "Summarise today’s official filings affecting my holdings.",
    "Which of my holdings outperformed their sectors today?",
  ];

  // Escape every padding tier of the shared app-shell main so the Copilot
  // fills the full content area edge to edge at every breakpoint.
  return (
    <div className="-mx-3 -mt-3 sm:-mx-4 sm:-mt-4 md:-m-8">
      <Chat
        providers={{ claude: claudeConfigured(), deepseek: deepseekChatConfigured() }}
        initialThreads={(threads ?? []) as ChatThread[]}
        suggestions={prompts}
        sourceStatus={sources}
        dataUpdated={dataUpdated}
      />
    </div>
  );
}
