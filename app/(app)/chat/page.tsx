import { createClient, getUser } from "@/lib/supabase/server";
import { claudeConfigured } from "@/lib/ai/claude";
import { deepseekChatConfigured } from "@/lib/ai/deepseek-chat";
import { getDataFreshness } from "@/lib/market/read";
import { getPortfolio } from "@/lib/portfolio";
import { Chat, type ChatThread } from "@/components/chat/chat";
import type { PromptContext } from "@/lib/chat/prompt-suggestions";
import { normalizeAllowedChatProviders } from "@/lib/features";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [{ data: threads }, freshness, portfolio, profileRes, txCountRes] = await Promise.all([
    supabase.from("chat_threads").select("id, title, summary, created_at, updated_at, last_message_at").eq("user_id", user.id).order("last_message_at", { ascending: false }).limit(50),
    getDataFreshness(supabase, user.id),
    getPortfolio(supabase, user.id),
    supabase.from("profiles").select("allowed_llm_providers, demo_mode").eq("id", user.id).maybeSingle(),
    supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const allowedProviders = normalizeAllowedChatProviders(profileRes.data?.allowed_llm_providers);
  const freshnessItems = freshness.filter((item) => item.date && item.key !== "brief");
  const sources = freshnessItems.map((item) => `${item.label} · ${item.date}`);
  const latestDate = freshnessItems.map((item) => item.date as string).sort().at(-1) ?? null;
  const dataUpdated = latestDate
    ? new Date(latestDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // Compact, structured signals the client uses to build model-aware sample
  // prompts (see lib/chat/prompt-suggestions). Top holdings by weight, the
  // heaviest sector, available cash for add-size, and whether a ledger exists.
  const promptContext: PromptContext = {
    hasLedger: (txCountRes.count ?? 0) > 0,
    holdingsCount: portfolio.holdingsCount,
    cashBalance: portfolio.cashBalance ?? null,
    top: [...portfolio.holdings]
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .slice(0, 8)
      .map((h) => ({ ticker: h.ticker, sector: h.sector ?? null, weightPct: h.weight ?? null })),
    topSector: portfolio.largestSector?.sector ?? null,
    sectors: portfolio.sectorWeights.map((s) => s.sector).filter((s) => s && s !== "Uncategorized").slice(0, 5),
    hasThesis: portfolio.holdings.some((h) => h.has_thesis),
  };

  // Escape every padding tier of the shared app-shell main so the Copilot
  // fills the full content area edge to edge at every breakpoint.
  return (
    <div className="-mx-3 -mt-3 sm:-mx-4 sm:-mt-4 md:-m-8">
      <Chat
        providers={{
          claude: { configured: claudeConfigured(), allowed: !isDemo && allowedProviders.includes("claude") },
          deepseek: { configured: deepseekChatConfigured(), allowed: !isDemo && allowedProviders.includes("deepseek") },
        }}
        initialThreads={(threads ?? []) as ChatThread[]}
        promptContext={promptContext}
        sourceStatus={sources}
        dataUpdated={dataUpdated}
        readOnly={isDemo}
      />
    </div>
  );
}
