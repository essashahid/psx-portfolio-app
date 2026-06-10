"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export function DismissAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("alerts").update({ status: "dismissed" }).eq("id", alertId);
    router.refresh();
  }

  return (
    <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy} title="Dismiss">
      <Check className="h-3.5 w-3.5" /> Dismiss
    </Button>
  );
}
