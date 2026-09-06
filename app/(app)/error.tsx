"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A signed-in page threw. Without this the reader gets Next's default error
 * screen, which looks like the product broke rather than one panel failing.
 *
 * The digest is shown because server errors are redacted in production: it is
 * the only thing that ties what the reader saw to what the logs recorded.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-5 block h-0.75 w-11 bg-indigo" />
      <h1 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        This page did not load
      </h1>
      <p className="mt-2 max-w-md text-sm text-text-muted">
        Something failed while building the page. Your data is not affected. Try again, and if it keeps
        happening the digest below identifies this failure in the logs.
      </p>
      <Button onClick={reset} className="mt-6 gap-1.5" size="sm">
        <RotateCw className="h-3.5 w-3.5" /> Try again
      </Button>
      {error.digest && (
        <p className="figure mt-5 text-(length:--text-2xs) text-text-faint">Digest {error.digest}</p>
      )}
    </div>
  );
}
