import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { claudeConfigured } from "@/lib/ai/claude";
import { deepseekChatConfigured } from "@/lib/ai/deepseek-chat";
import { normalizeAllowedChatProviders } from "@/lib/config/features";
import type { ProviderStatus } from "@psx/shared/ai/models";

/**
 * Which models this account may actually use.
 *
 * The web page computes this in its server component and passes it down. The
 * phone has no server render, so it asks. Two things gate a provider: whether
 * a key is configured at all, and whether this account is allowed it — a demo
 * account is allowed neither.
 */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("allowed_llm_providers, demo_mode")
      .eq("id", user.id)
      .maybeSingle();

    const isDemo = Boolean(profile?.demo_mode);
    const allowed = normalizeAllowedChatProviders(profile?.allowed_llm_providers);

    const providers: ProviderStatus = {
      claude: { configured: claudeConfigured(), allowed: !isDemo && allowed.includes("claude") },
      deepseek: {
        configured: deepseekChatConfigured(),
        allowed: !isDemo && allowed.includes("deepseek"),
      },
    };
    return NextResponse.json({ providers });
  } catch (err) {
    return errorResponse(err);
  }
}
