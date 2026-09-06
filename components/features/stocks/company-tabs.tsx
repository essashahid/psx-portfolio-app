"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { track } from "@/lib/telemetry/client";
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
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [underline, setUnderline] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

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
    track("company_tab_viewed", { tab: id });
  }

  // Measured from the rendered tabs rather than computed from label lengths,
  // which would drift with the font and break on a wrapped or scrolled strip.
  const measure = useCallback(() => {
    const el = active ? tabRefs.current[active] : null;
    if (!el) return;
    setUnderline({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active]);

  // Layout effect so the bar is in place on the first paint after a tab change;
  // in a plain effect it would visibly jump from its old position.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    // Fonts landing late and the container resizing both move the tabs under
    // a bar that has already been positioned.
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  return (
    <div>
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Company sections"
        className="tabstrip scroll-touch flex gap-6 overflow-x-auto border-b border-rule px-(--gutter-page) pt-4"
      >
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => select(t.id)}
              className={cn(
                "whitespace-nowrap pb-1.5 text-sm transition-colors",
                on ? "font-semibold text-text-strong" : "font-medium text-text-muted hover:text-text-strong"
              )}
            >
              {t.label}
            </button>
          );
        })}
        {/* One underline that slides, rather than a border appearing on the new
            tab and vanishing from the old. It carries --tab-hue, the sector's
            own colour, which is the only place colour enters this strip. */}
        <span
          className="tabstrip__underline"
          style={{ ...({ "--tab-hue": accent } as React.CSSProperties), left: underline.left, width: underline.width }}
          aria-hidden
        />
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
