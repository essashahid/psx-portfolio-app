"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RiskPanel } from "@/components/outlook/risk-panel";
import { TurbulencePanel } from "@/components/outlook/turbulence-panel";
import type { OutlookViewModel } from "@/lib/engine/outlook/presentation";

/**
 * The Outlook tab as a reader first meets it.
 *
 * Each section leads with a plain sentence and shows one visual. Sample sizes
 * appear as confidence labels, raw figures sit behind a toggle, and the data
 * coverage and known gaps live on a separate page, so the default reading is
 * about what the market has done rather than about our data pipeline.
 */
export function OutlookView({ model }: { model: OutlookViewModel }) {
  const evidence = model.evidence;

  return (
    <div className="space-y-4">
      <Card className="rise border-l-[3px] border-l-brand">
        <CardContent className="p-4">
          <p className="eyebrow mb-1.5">Phase 1 of 6 &middot; Data foundation</p>
          <p className="text-sm leading-relaxed text-foreground">
            This tab does not forecast anything yet. Everything below describes what the market has already done. Once a
            model has been built and tested against periods it has never seen, this page will carry a genuine outlook.
          </p>
        </CardContent>
      </Card>

      <RiskPanel model={model} />
      <TurbulencePanel model={model} />

      <Card className="rise rise-3">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-editorial text-foreground">About this data</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              {evidence
                ? `Every figure here comes from ${evidence.sessions.toLocaleString()} trading days of KSE-100 history, covering ${evidence.years.toFixed(1)} years. `
                : ""}
              The full record of what we hold, how current it is, and the sources we are missing is kept separately.
            </p>
          </div>
          <Link
            href="/outlook/data"
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition-colors duration-(--dur-fast) ease-(--ease-ui) hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:self-auto"
          >
            Coverage and gaps
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
