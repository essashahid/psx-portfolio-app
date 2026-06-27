"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldAlert, LogOut, Loader2 } from "lucide-react";

export function ImpersonationBanner({
  viewingEmail,
  adminEmail,
}: {
  viewingEmail: string;
  adminEmail: string;
}) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);

  async function exit() {
    setExiting(true);
    await fetch("/api/admin/impersonate", { method: "DELETE" });
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="flex-1 truncate">
        Viewing as <span className="font-semibold">{viewingEmail}</span>
        <span className="ml-1 text-amber-600">(signed in as {adminEmail})</span>
      </span>
      <button
        onClick={exit}
        disabled={exiting}
        className="flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
      >
        {exiting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogOut className="h-3.5 w-3.5" />
        )}
        Exit
      </button>
    </div>
  );
}
