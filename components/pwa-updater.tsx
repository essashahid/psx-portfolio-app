"use client";

import { useEffect, useState } from "react";
import { DownloadCloud, X } from "lucide-react";

export function PwaUpdater() {
  const [show, setShow] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const onUpdateFound = (reg: ServiceWorkerRegistration) => {
      const installingWorker = reg.installing;
      if (installingWorker) {
        installingWorker.onstatechange = () => {
          if (installingWorker.state === "installed") {
            if (navigator.serviceWorker.controller) {
              // A new service worker is ready to take over
              setRegistration(reg);
              setShow(true);
            }
          }
        };
      }
    };

    navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener("updatefound", () => onUpdateFound(reg));
      // In case we missed the event, check if there's already a waiting worker
      if (reg.waiting) {
        setRegistration(reg);
        setShow(true);
      }
    });
  }, []);

  const handleUpdate = () => {
    if (registration && registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      setShow(false);
      // The new SW will take over, we reload when the controller changes
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    }
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 transform sm:bottom-6 sm:w-auto">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <DownloadCloud className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Update available</p>
          <p className="text-xs text-muted-foreground">A new version of PortfolioOS is ready.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleUpdate}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90"
          >
            Update
          </button>
          <button
            onClick={() => setShow(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss update"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
