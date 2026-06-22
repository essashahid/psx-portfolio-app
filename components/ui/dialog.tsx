"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
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

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className={cn(
          "scroll-touch max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-lg border border-border bg-card p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl sm:max-w-lg sm:rounded-lg sm:p-5",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-center justify-between bg-card px-1">
          <h2 id={titleId} className="text-base font-semibold sm:text-sm">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:h-9 sm:w-9"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
