import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/guard";
import { PageHeader } from "@/components/page-header";
import { AllocationView } from "@/components/allocation/allocation-view";
import type { AllocationForecast } from "@/lib/engine/allocation";

export const dynamic = "force-dynamic";

export default async function AllocationPage() {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) redirect("/dashboard");

  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("allocation_forecasts")
    .select("payload, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const initial = (data?.payload as AllocationForecast | undefined) ?? null;
  const savedAt = (data?.created_at as string | undefined) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Planning"
        title="Capital Allocation"
        description="A forward-looking model for where to deploy new capital across PSX equity, gold, Bitcoin and cash, to maximise five-year real rupee return within set risk limits."
      />
      <AllocationView initial={initial} savedAt={savedAt} />
    </div>
  );
}
