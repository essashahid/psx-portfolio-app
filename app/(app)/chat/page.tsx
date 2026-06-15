import { getUser } from "@/lib/supabase/server";
import { claudeConfigured } from "@/lib/ai/claude";
import { PageHeader } from "@/components/page-header";
import { Chat } from "@/components/chat/chat";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getUser();
  if (!user) return null;

  return (
    <div>
      <PageHeader
        eyebrow="Assistant"
        title="Research Copilot"
        description="Ask anything about your holdings or the PSX. It pulls live prices, ratios, charts and filings — then interprets them."
      />
      <Chat aiEnabled={claudeConfigured()} />
    </div>
  );
}
