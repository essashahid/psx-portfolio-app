"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, sentimentVariant } from "@/components/ui/badge";
import type { NewsArticle } from "@/lib/types";
import {
  ArrowUpRight,
  Bookmark,
  Building2,
  CalendarDays,
  EyeOff,
  Link2,
  MessageSquareText,
  Sparkles,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function NewsCard({ article }: { article: NewsArticle }) {
  const [saved, setSaved] = useState(article.saved);
  const [ignored, setIgnored] = useState(article.ignored);
  const relevanceLabel = getRelevanceLabel(article.relevance_score);
  const lowRelevance = article.low_confidence || (article.relevance_score !== null && article.relevance_score <= 3);
  const highRelevance = article.relevance_score !== null && article.relevance_score >= 7 && !lowRelevance;
  const published = formatDate(article.published_at);
  const body = article.ai_summary || article.snippet;

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
        "group overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)] transition-colors hover:border-foreground/20",
        highRelevance && "border-emerald-200",
        lowRelevance && "border-amber-200 bg-amber-50/25",
        ignored && "opacity-55"
      )}
    >
      <div
        className={cn(
          "h-1 bg-muted",
          article.sentiment === "positive" && "bg-emerald-500",
          article.sentiment === "negative" && "bg-red-500",
          article.sentiment === "neutral" && "bg-zinc-300",
          highRelevance && "bg-blue-500",
          lowRelevance && "bg-amber-400"
        )}
      />
      <div className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {article.ticker && <Badge variant="outline">{article.ticker}</Badge>}
              <Badge variant={sentimentVariant(article.sentiment)}>{article.sentiment ?? "unrated"}</Badge>
              {relevanceLabel && (
                <Badge variant={highRelevance ? "blue" : lowRelevance ? "amber" : "secondary"}>
                  {relevanceLabel}
                </Badge>
              )}
              {article.category && article.category !== "general" && <Badge variant="blue">{formatCategory(article.category)}</Badge>}
              {article.low_confidence && <Badge variant="amber">low confidence</Badge>}
              {article.source_quality && <Badge variant={sourceQualityVariant(article.source_quality)}>source {article.source_quality}</Badge>}
            </div>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-start gap-2 text-sm font-semibold leading-snug tracking-editorial text-foreground transition-colors hover:text-foreground/75 sm:text-base"
            >
              <span>{article.title}</span>
              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          </div>
          <div className="flex shrink-0 gap-0.5 sm:gap-1">
            <button
              onClick={() => toggle("saved")}
              title={saved ? "Unsave" : "Save"}
              aria-label={saved ? "Unsave article" : "Save article"}
              aria-pressed={saved}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-muted sm:h-8 sm:w-8",
                saved ? "bg-blue-50 text-blue-700" : "text-muted-foreground"
              )}
            >
              <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => toggle("ignored")}
              title={ignored ? "Un-ignore" : "Ignore"}
              aria-label={ignored ? "Un-ignore article" : "Ignore article"}
              aria-pressed={ignored}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-muted sm:h-8 sm:w-8",
                ignored ? "bg-amber-50 text-amber-700" : "text-muted-foreground"
              )}
            >
              <EyeOff className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Link2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{article.source ?? "Unknown source"}</span>
          </span>
          {published && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {published}
            </span>
          )}
          {article.company_name && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{article.company_name}</span>
            </span>
          )}
        </div>

        {body && (
          <p className={cn("mt-3 text-sm leading-relaxed", article.ai_summary ? "text-foreground/90" : "line-clamp-3 text-muted-foreground")}>
            {body}
          </p>
        )}

        {(article.why_it_matters || article.link_reason || article.thesis_impact || article.review_question) && (
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            {article.why_it_matters && (
              <SignalLine icon={Sparkles} label="Why it matters" text={article.why_it_matters} />
            )}
            {article.thesis_impact && (
              <SignalLine icon={Target} label="Thesis impact" text={article.thesis_impact} />
            )}
            {article.link_reason && (
              <SignalLine icon={Link2} label="Linked because" text={article.link_reason} muted />
            )}
            {article.review_question && (
              <SignalLine icon={MessageSquareText} label="Review prompt" text={article.review_question} muted />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function SignalLine({
  icon: Icon,
  label,
  text,
  muted,
}: {
  icon: LucideIcon;
  label: string;
  text: string;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-xs leading-relaxed">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5", muted ? "text-muted-foreground" : "text-emerald-600")} />
      <p className={muted ? "text-muted-foreground" : "text-foreground/90"}>
        <span className="font-medium text-foreground">{label}:</span> {text}
      </p>
    </div>
  );
}

function getRelevanceLabel(score: number | null): string | null {
  if (score === null) return null;
  if (score <= 2) return `off-topic ${score}/10`;
  if (score <= 3) return `weak match ${score}/10`;
  if (score >= 7) return `high relevance ${score}/10`;
  return `relevance ${score}/10`;
}

function formatCategory(category: string): string {
  return category.replace(/_/g, " ");
}

function sourceQualityVariant(quality: string): "green" | "blue" | "amber" | "secondary" {
  if (quality === "high") return "green";
  if (quality === "medium") return "blue";
  if (quality === "low") return "amber";
  return "secondary";
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}
