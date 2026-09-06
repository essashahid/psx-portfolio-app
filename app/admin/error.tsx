"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** An admin page threw. Same treatment as the app group, plainer chrome. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin] route error", error);
  }, [error]);

  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        This admin page did not load
      </h1>
      <p className="mt-2 max-w-md text-sm text-text-muted">
        The query behind it failed. Nothing was written. The digest below identifies the failure in the logs.
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
