import { createClient, getUser } from "@/lib/supabase/server";
import { claudeConfigured } from "@/lib/ai/claude";
import { deepseekChatConfigured } from "@/lib/ai/deepseek-chat";
import { PageHeader } from "@/components/page-header";
import { Chat, type ChatThread } from "@/components/chat/chat";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: threads } = await supabase
    .from("chat_threads")
    .select("id, title, summary, created_at, updated_at, last_message_at")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })
    .limit(50);

  return (
    <div>
      {/* Hide the header on mobile — the top bar already labels the page, and
          every pixel of vertical space goes to the conversation. */}
      <div className="mb-4 hidden md:block">
        <PageHeader
          eyebrow="Assistant"
          title="Research Copilot"
          description="Ask about your holdings or the PSX using live prices, ratios, charts and filings."
        />
      </div>
      <Chat
        providers={{ claude: claudeConfigured(), deepseek: deepseekChatConfigured() }}
        initialThreads={(threads ?? []) as ChatThread[]}
      />
    </div>
  );
}
