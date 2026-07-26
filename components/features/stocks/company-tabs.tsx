"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/shared/format";
import type { ReactNode } from "react";

export interface CompanyTabDef {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * The company page's tab strip: labels on a rule, the active one underlined in
 * the sector's own hue.
 *
 * Separate from the shared Tabs component, which other pages still use with its
 * pill styling. The hue is the only place colour enters the strip, and it is
 * never used for the label text — direction stays the job of up and down.
 *
 * Every panel is server-rendered and passed in as `content`, so switching tabs
 * is instant and nothing refetches. The active tab is mirrored to the URL hash
 * so it survives a reload and can be linked to.
 */
export function CompanyTabs({
  tabs,
  initial,
  accent,
}: {
  tabs: CompanyTabDef[];
  initial?: string;
  accent: string;
}) {
  const [active, setActive] = useState(() => initial ?? tabs[0]?.id);

  useEffect(() => {
    function fromHash() {
      const hash = decodeURIComponent(window.location.hash.replace("#", ""));
      if (hash && tabs.some((t) => t.id === hash)) setActive(hash);
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  function select(id: string) {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Company sections"
        className="scroll-touch flex gap-6 overflow-x-auto border-b border-rule px-(--gutter-page) pt-4"
      >
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => select(t.id)}
              className={cn(
                "whitespace-nowrap border-b-2 pb-1.5 text-sm transition-colors",
                on ? "font-semibold text-text-strong" : "border-transparent font-medium text-text-muted hover:text-text-strong"
              )}
              style={on ? { borderBottomColor: accent } : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
