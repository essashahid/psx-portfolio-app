"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/telemetry/client";

/** One page_view per route change, for the "which pages get used" question. */
export function TrackPageView() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    track("page_view", { route: routeOf(pathname) });
  }, [pathname]);
  return null;
}

/** /stocks/OGDC becomes /stocks/[ticker], so counts group by page, not company. */
function routeOf(pathname: string): string {
  return pathname.replace(/^\/stocks\/[^/]+$/, "/stocks/[ticker]").replace(/^\/admin\/users\/[^/]+$/, "/admin/users/[id]");
}
