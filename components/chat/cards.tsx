"use client";

import Link from "next/link";
import { Sparkline } from "@/components/market/sparkline";
import { fmtPct, fmtPrice, fmtCompact, tone } from "@/lib/market/format";
import type { Card } from "@/lib/chat/context";
import { cn } from "@/lib/utils";
import { TrendingUp, Briefcase, Calculator, Activity, HandCoins, FileText, Gauge, Globe2 } from "lucide-react";

/**
 * Renders the assistant's data cards — the free layer. These are React
 * components fed by Supabase data, never drawn by the LLM, which is what keeps
 * token cost down while the UI stays rich.
 */
export function ChatCards({ cards }: { cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {cards.map((c, i) => (
        <ChatCard key={i} card={c} />
      ))}
    </div>
  );
}

// Neutral surface for every card. Colour is reserved for the values inside
// (positive/negative movement), never the card outline, so a screen of cards
// stays calm rather than fencing each one in green or red.
function Shell({ icon: Icon, title, href, children }: { icon: typeof TrendingUp; title: string; href?: string; children: React.ReactNode }) {
  const inner = (
    <div className={cn("rounded-xl border border-border/70 bg-card p-3 transition-colors", href && "hover:border-border hover:bg-muted/30")}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {title}
      </div>
      {children}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Big({ value, sub, t }: { value: string; sub?: string; t?: "positive" | "negative" | "flat" }) {
  return (
    <div>
      <p className={cn("text-lg font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-foreground")}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function fmtFlow(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function ChatCard({ card }: { card: Card }) {
  switch (card.kind) {
    case "quote": {
      const q = card.data;
      const t = tone(q.changePct);
      return (
        <Shell icon={TrendingUp} title={`${q.ticker} · Quote`} href={`/stocks/${q.ticker}`}>
          <div className="flex items-end justify-between">
            <Big value={fmtPrice(q.price)} sub={q.companyName ?? q.sector ?? ""} t={t} />
            <div className="text-right">
              <p className={cn("text-sm font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-muted-foreground")}>{fmtPct(q.changePct)}</p>
              <p className="text-[10px] text-muted-foreground">vol {fmtCompact(q.volume)}</p>
            </div>
          </div>
        </Shell>
      );
    }
    case "position": {
      const p = card.data;
      const t = tone(p.unrealizedPLPct);
      return (
        <Shell icon={Briefcase} title={`${p.ticker} · Your position`}>
          <div className="flex items-end justify-between">
            <Big value={`${fmtCompact(p.marketValue)}`} sub={`${p.quantity} sh @ ${p.avgCost.toFixed(2)}`} />
            <div className="text-right">
              <p className={cn("text-sm font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-muted-foreground")}>{p.unrealizedPL != null ? fmtCompact(p.unrealizedPL) : "—"}</p>
              <p className="text-[10px] text-muted-foreground">{fmtPct(p.unrealizedPLPct)} unrealized</p>
            </div>
          </div>
        </Shell>
      );
    }
    case "ratios": {
      const r = card.data;
      const shown = r.rows.filter((x) => x.value != null).slice(0, 6);
      return (
        <Shell icon={Calculator} title={`${r.ticker} · Ratios`} href={`/stocks/${r.ticker}#ratios`}>
          <div className="grid grid-cols-3 gap-1.5">
            {shown.map((x) => (
              <div key={x.name}>
                <p className="text-sm font-semibold tabular-nums">{x.value!.toFixed(x.value! >= 100 ? 0 : 2)}{/yield|margin|growth|roe|roa/i.test(x.name) ? "%" : ""}</p>
                <p className="truncate text-[9px] text-muted-foreground" title={x.name}>{x.name}</p>
              </div>
            ))}
          </div>
          {r.sourcePeriod && <p className="mt-1.5 text-[9px] text-muted-foreground">{r.sourcePeriod}</p>}
        </Shell>
      );
    }
    case "technical": {
      const tc = card.data;
      const pos = tc.price != null && tc.fiftyTwoWeekHigh != null && tc.fiftyTwoWeekLow != null && tc.fiftyTwoWeekHigh > tc.fiftyTwoWeekLow
        ? Math.max(0, Math.min(1, (tc.price - tc.fiftyTwoWeekLow) / (tc.fiftyTwoWeekHigh - tc.fiftyTwoWeekLow))) : null;
      return (
        <Shell icon={Activity} title={`${tc.ticker} · Trend`} href={`/stocks/${tc.ticker}#technicals`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              {tc.spark && tc.spark.length > 1 ? <Sparkline data={tc.spark} width={120} height={32} /> : <p className="text-[11px] text-muted-foreground">no chart yet</p>}
              {pos != null && (
                <div className="mt-1 h-1.5 w-full rounded-full bg-gradient-to-r from-red-200 via-amber-200 to-emerald-200">
                  <span className="relative block h-1.5" style={{ left: `${pos * 100}%` }}><span className="absolute -top-0.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-foreground" /></span>
                </div>
              )}
            </div>
            {tc.rsi != null && <div className="text-right"><p className="text-sm font-semibold tabular-nums">{tc.rsi.toFixed(0)}</p><p className="text-[9px] text-muted-foreground">RSI</p></div>}
          </div>
        </Shell>
      );
    }
    case "dividend": {
      const d = card.data;
      return (
        <Shell icon={HandCoins} title={`${d.ticker} · Dividends`} href={`/stocks/${d.ticker}#dividends`}>
          <Big value={d.ttmDps != null ? `${d.ttmDps.toFixed(2)} PKR` : "—"} sub="trailing-12m cash DPS" />
          {d.recent.length > 0 && <p className="mt-1 truncate text-[10px] text-muted-foreground">{d.recent.map((x) => x.raw).filter(Boolean).join(" · ")}</p>}
        </Shell>
      );
    }
    case "news": {
      const n = card.data;
      return (
        <Shell icon={FileText} title={`${n.ticker ?? "Market"} · News`}>
          <ul className="space-y-1">
            {n.items.slice(0, 4).map((it, i) => (
              <li key={i} className="text-[11px] leading-snug">
                {it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{it.title}</a> : it.title}
                <span className="ml-1 text-[9px] text-muted-foreground">{it.date}</span>
              </li>
            ))}
          </ul>
        </Shell>
      );
    }
    case "market": {
      const m = card.data;
      const t = tone(m.indexChangePct);
      return (
        <Shell icon={Gauge} title={`${m.indexName ?? "PSX"} · ${m.date}`} href="/market">
          <div className="flex items-end justify-between">
            <Big value={m.indexValue?.toLocaleString("en-PK", { maximumFractionDigits: 0 }) ?? "—"} sub={`${m.advancers}↑ / ${m.decliners}↓`} t={t} />
            <p className={cn("text-sm font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-muted-foreground")}>{fmtPct(m.indexChangePct)}</p>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Leading {m.topSector ?? "—"} · Lagging {m.bottomSector ?? "—"}</p>
        </Shell>
      );
    }
    case "sector": {
      const sc = card.data;
      const rows = sc.sectors.slice(0, sc.filter ? sc.sectors.length : 8);
      return (
        <Shell icon={Activity} title={sc.filter ? `Sector · ${sc.filter}` : "Sectors today"} href="/market">
          <div className="space-y-1">
            {rows.map((s) => {
              const t = tone(s.avgReturn);
              return (
                <div key={s.sector} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px]">{s.sector} <span className="text-muted-foreground">({s.advancers}↑/{s.decliners}↓)</span></span>
                  <span className={cn("shrink-0 text-[11px] font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-muted-foreground")}>{fmtPct(s.avgReturn)}</span>
                </div>
              );
            })}
          </div>
          {sc.filter && rows[0]?.topGainer && <p className="mt-1.5 text-[10px] text-muted-foreground">Top: {rows[0].topGainer} {fmtPct(rows[0].topGainerPct)} · Worst: {rows[0].topLoser} {fmtPct(rows[0].topLoserPct)}</p>}
        </Shell>
      );
    }
    case "foreign_flow": {
      const f = card.data;
      const t = tone(f.day.fipiNet);
      return (
        <Shell icon={Globe2} title={`FIPI / LIPI · ${f.day.date}`} href="/market">
          <div className="flex items-end justify-between">
            <Big value={`${fmtFlow(f.day.fipiNet)} ${f.day.currency} mn`} sub={f.stanceLabel} t={t} />
            <div className="text-right">
              <p className={cn("text-sm font-semibold tabular-nums", (f.cumulativeNet ?? 0) > 0 ? "text-emerald-600" : (f.cumulativeNet ?? 0) < 0 ? "text-red-600" : "text-muted-foreground")}>{fmtFlow(f.cumulativeNet)}</p>
              <p className="text-[10px] text-muted-foreground">{f.series.length}-day net</p>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {f.buckets.slice(0, 3).map((b) => `${b.label} ${fmtFlow(b.net)}`).join(" · ") || `Source ${f.day.sourceProvider}`}
          </p>
        </Shell>
      );
    }
    case "holdings": {
      const h = card.data;
      return (
        <Shell icon={Briefcase} title="Your holdings" href="/holdings">
          <Big value={`${h.count}`} sub="positions" />
          <div className="mt-1 flex flex-wrap gap-1">
            {h.holdings.slice(0, 10).map((x) => (
              <Link key={x.ticker} href={`/stocks/${x.ticker}`} className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums", (x.changePct ?? 0) > 0 ? "bg-emerald-50 text-emerald-700" : (x.changePct ?? 0) < 0 ? "bg-red-50 text-red-700" : "bg-muted text-muted-foreground")}>
                {x.ticker} {fmtPct(x.changePct)}
              </Link>
            ))}
          </div>
        </Shell>
      );
    }
  }
}
