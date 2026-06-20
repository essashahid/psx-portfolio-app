"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { NewsArticle } from "@/lib/types";
import { ArrowUpRight, Bookmark, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_META: Record<string, { label: string; className: string }> = {
  policy: { label: "Policy", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  economy: { label: "Economy", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  commodity: { label: "Commodity", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  market: { label: "Markets", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  international: { label: "Global", className: "bg-violet-50 text-violet-700 ring-violet-200" },
  earnings: { label: "Earnings", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  result: { label: "Earnings", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  dividend: { label: "Dividend", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  corporate_announcement: { label: "Filing", className: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
  company: { label: "Company", className: "bg-zinc-100 text-zinc-600 ring-zinc-200" },
};

const SENTIMENT_DOT: Record<string, string> = {
  positive: "bg-emerald-500",
  negative: "bg-red-500",
  neutral: "bg-zinc-300",
};

export function NewsCard({ article, lead = false }: { article: NewsArticle; lead?: boolean }) {
  const [saved, setSaved] = useState(article.saved);
  const [ignored, setIgnored] = useState(article.ignored);

  const category = article.category ? CATEGORY_META[article.category] : undefined;
  const summary = article.ai_summary || article.snippet;
  const tickers = article.ticker
    ? [article.ticker]
    : (article.impact_tickers ?? []).slice(0, 3);
  const time = formatWhen(article.published_at ?? article.created_at);
  const highRelevance = (article.relevance_score ?? 0) >= 7 && !article.low_confidence;

  async function toggle(field: "saved" | "ignored") {
    const supabase = createClient();
    const next = field === "saved" ? !saved : !ignored;
    if (field === "saved") setSaved(next);
    else setIgnored(next);
    await supabase.from("news_articles").update({ [field]: next }).eq("id", article.id);
  }

  return (
    <article
      className={cn(
        "group relative rounded-xl border border-border bg-card transition-colors hover:border-foreground/20",
        lead ? "p-5 sm:p-6" : "p-4",
        ignored && "opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {category && (
            <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 font-semibold ring-1 ring-inset", category.className)}>
              {category.label}
            </span>
          )}
          {article.is_interesting && (
            <span className="inline-flex items-center rounded-md bg-foreground px-1.5 py-0.5 font-semibold text-background">
              ★ Notable
            </span>
          )}
          {article.sentiment && <span className={cn("h-1.5 w-1.5 rounded-full", SENTIMENT_DOT[article.sentiment])} />}
          <span className="truncate font-medium text-foreground/70">{article.source ?? "Unknown"}</span>
          {time && <span>· {time}</span>}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <IconToggle active={saved} onClick={() => toggle("saved")} label={saved ? "Unsave" : "Save"} activeClass="bg-blue-50 text-blue-700">
            <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
          </IconToggle>
          <IconToggle active={ignored} onClick={() => toggle("ignored")} label={ignored ? "Un-hide" : "Hide"} activeClass="bg-amber-50 text-amber-700">
            <EyeOff className="h-4 w-4" />
          </IconToggle>
        </div>
      </div>

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "mt-2 flex items-start gap-1.5 font-semibold leading-snug tracking-editorial text-foreground transition-colors hover:text-foreground/70",
          lead ? "text-lg sm:text-xl" : "text-[15px]"
        )}
      >
        <span>{article.title}</span>
        <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </a>

      {summary && (
        <p className={cn("mt-2 text-sm leading-relaxed text-muted-foreground", lead ? "line-clamp-4" : "line-clamp-2")}>
          {summary}
        </p>
      )}

      {(tickers.length > 0 || (highRelevance && article.why_it_matters)) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {tickers.map((t) => (
            <span key={t} className="inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] font-semibold">
              {t}
            </span>
          ))}
          {highRelevance && article.why_it_matters && (
            <span className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">{article.why_it_matters}</span>
          )}
        </div>
      )}
    </article>
  );
}

function IconToggle({
  active,
  onClick,
  label,
  activeClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  activeClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted",
        active && activeClass
      )}
    >
      {children}
    </button>
  );
}

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-PK", { month: "short", day: "numeric" });
}
