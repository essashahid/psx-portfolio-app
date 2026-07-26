"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/shared/format";
import { X } from "lucide-react";

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = React.useId();

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handler);
    };
  }, [open, onClose]);

  // The portal target only exists in the browser; `open` is always false
  // during SSR, so this guard never changes what the server renders.
  if (!open || typeof document === "undefined") return null;

  // Rendered into <body> rather than in place. An ancestor carrying a
  // transform, filter or backdrop-filter becomes the containing block for a
  // fixed overlay, which would trap the dialog inside the content column and
  // push it below the fold. Both .rise and .chart-reveal leave a filter or
  // transform behind once they settle, so this is not hypothetical.
  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className={cn(
          "scroll-touch max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-lg border border-rule bg-card p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-dialog sm:max-w-lg sm:rounded-lg sm:p-5",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-center justify-between bg-card px-1">
          <h2 id={titleId} className="font-display text-(length:--text-h2) font-normal tracking-editorial text-text-strong">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-muted hover:text-text-strong sm:h-9 sm:w-9"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
