import { createClient, getUser } from "@/lib/supabase/server";
import { claudeConfigured } from "@/lib/ai/claude";
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
      <PageHeader
        eyebrow="Assistant"
        title="Research Copilot"
        description="Ask anything about your holdings or the PSX. It pulls live prices, ratios, charts and filings — then interprets them."
      />
      <Chat aiEnabled={claudeConfigured()} initialThreads={(threads ?? []) as ChatThread[]} />
    </div>
  );
}
