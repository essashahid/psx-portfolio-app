"use client";

import { useState } from "react";
import type { NewsArticle } from "@/lib/types";
import { Bookmark, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Plain-text category labels. No colour, no ring, no pill — just a quiet
// kicker in the meta line. Kept minimal on purpose.
const CATEGORY_LABEL: Record<string, string> = {
  policy: "Policy",
  regulatory: "Regulatory",
  economy: "Economy",
  commodity: "Commodity",
  forex: "Currency",
  crypto: "Crypto",
  funds: "Funds",
  market: "Markets",
  international: "Global",
  geopolitics: "Global",
  earnings: "Earnings",
  result: "Results",
  dividend: "Dividend",
  corporate_announcement: "Filing",
  company: "Company",
};

type ActionableNewsArticle = NewsArticle & {
  storage?: "global" | "legacy";
  global_article_id?: string | null;
  legacy_article_id?: string | null;
};

export function NewsCard({ article, lead = false }: { article: ActionableNewsArticle; lead?: boolean }) {
  const [saved, setSaved] = useState(article.saved);
  const [ignored, setIgnored] = useState(article.ignored);

  const category = article.category ? CATEGORY_LABEL[article.category] : undefined;
  const summary = article.ai_summary || article.snippet;
  const tickers = article.ticker ? [article.ticker] : (article.impact_tickers ?? []).slice(0, 3);
  const time = formatWhen(article.published_at ?? article.created_at);
  const showWhy = (article.relevance_score ?? 0) >= 7 && !article.low_confidence && !!article.why_it_matters;

  // Meta line, joined by thin dots: Source · Category · Time.
  const meta = [article.source ?? "Unknown", category, time].filter(Boolean) as string[];

  async function toggle(field: "saved" | "ignored") {
    const next = field === "saved" ? !saved : !ignored;
    if (field === "saved") setSaved(next);
    else setIgnored(next);
    try {
      const res = await fetch("/api/news/article-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: article.storage === "global" ? article.global_article_id ?? article.id : article.legacy_article_id ?? article.id,
          storage: article.storage ?? "legacy",
          field,
          value: next,
        }),
      });
      if (!res.ok) throw new Error("Article action failed");
    } catch {
      if (field === "saved") setSaved(!next);
      else setIgnored(!next);
    }
  }

  return (
    <article className={cn("group relative", ignored && "opacity-45")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {meta.map((part, i) => (
              <span key={i} className="inline-flex items-center gap-x-1.5">
                {i > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
                <span className={cn("truncate", i === 0 && "font-medium text-foreground/70")}>{part}</span>
              </span>
            ))}
          </div>

          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "mt-1.5 block font-semibold leading-snug tracking-editorial text-foreground transition-colors hover:text-foreground/60",
              lead ? "text-lg sm:text-2xl" : "text-[15px]"
            )}
          >
            {article.title}
          </a>

          {summary && (
            <p className={cn("mt-1.5 text-sm leading-relaxed text-muted-foreground", lead ? "line-clamp-3" : "line-clamp-2")}>
              {summary}
            </p>
          )}

          {(tickers.length > 0 || showWhy) && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              {tickers.length > 0 && <span className="font-medium text-foreground/70">{tickers.join(", ")}</span>}
              {tickers.length > 0 && showWhy && <span className="mx-1.5 text-muted-foreground/40">·</span>}
              {showWhy && <span>{article.why_it_matters}</span>}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconToggle active={saved} onClick={() => toggle("saved")} label={saved ? "Unsave" : "Save"}>
            <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
          </IconToggle>
          <IconToggle active={ignored} onClick={() => toggle("ignored")} label={ignored ? "Un-hide" : "Hide"}>
            <EyeOff className="h-4 w-4" />
          </IconToggle>
        </div>
      </div>
    </article>
  );
}

function IconToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "text-foreground"
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
