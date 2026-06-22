"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface TabDef {
  id: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Cockpit tab bar. Every panel is server-rendered and passed in as `content`
 * (each already wrapped in its own <Suspense> by the page), so they stream in
 * independently and switching tabs is instant — no client refetch. The active
 * tab is mirrored to the URL hash so it survives reloads and is shareable.
 */
export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return initial ?? tabs[0]?.id;
    const hash = decodeURIComponent(window.location.hash.replace("#", ""));
    return hash && tabs.some((t) => t.id === hash) ? hash : initial ?? tabs[0]?.id;
  });

  function select(id: string) {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  }

  return (
    <div>
      <div role="tablist" aria-label="Page sections" className="scroll-touch sticky top-0 z-10 -mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-border bg-background/90 px-1 pb-px backdrop-blur">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => select(t.id)}
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            className={cn(
              "relative min-h-11 shrink-0 whitespace-nowrap px-3 py-2 text-[13px] font-medium transition-colors md:min-h-0",
              active === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {active === t.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-600" />
            )}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={`panel-${t.id}`} role="tabpanel" hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
