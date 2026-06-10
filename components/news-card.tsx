"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, sentimentVariant } from "@/components/ui/badge";
import type { NewsArticle } from "@/lib/types";
import { Bookmark, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function NewsCard({ article }: { article: NewsArticle }) {
  const [saved, setSaved] = useState(article.saved);
  const [ignored, setIgnored] = useState(article.ignored);

  async function toggle(field: "saved" | "ignored") {
    const supabase = createClient();
    const next = field === "saved" ? !saved : !ignored;
    if (field === "saved") setSaved(next);
    else setIgnored(next);
    await supabase.from("news_articles").update({ [field]: next }).eq("id", article.id);
  }

  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", ignored && "opacity-50")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {article.ticker && <Badge variant="outline">{article.ticker}</Badge>}
          <Badge variant={sentimentVariant(article.sentiment)}>{article.sentiment ?? "unrated"}</Badge>
          {article.relevance_score !== null && <Badge variant="secondary">relevance {article.relevance_score}/10</Badge>}
          {article.category && article.category !== "general" && <Badge variant="blue">{article.category}</Badge>}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => toggle("saved")}
            title={saved ? "Unsave" : "Save"}
            className={cn("rounded p-1 hover:bg-muted", saved ? "text-blue-600" : "text-muted-foreground")}
          >
            <Bookmark className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => toggle("ignored")}
            title={ignored ? "Un-ignore" : "Ignore"}
            className={cn("rounded p-1 hover:bg-muted", ignored ? "text-amber-600" : "text-muted-foreground")}
          >
            <EyeOff className="h-4 w-4" />
          </button>
        </div>
      </div>
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 block text-sm font-medium leading-snug hover:underline"
      >
        {article.title}
      </a>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {article.source ?? "unknown source"}
        {article.published_at ? ` · ${String(article.published_at).slice(0, 10)}` : ""}
        {article.company_name ? ` · ${article.company_name}` : ""}
      </p>
      {article.ai_summary ? (
        <p className="mt-2 text-xs leading-relaxed">{article.ai_summary}</p>
      ) : (
        article.snippet && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{article.snippet}</p>
      )}
      {article.why_it_matters && (
        <p className="mt-1.5 text-xs"><span className="font-medium">Why it matters:</span> {article.why_it_matters}</p>
      )}
      {article.thesis_impact && (
        <p className="mt-1 text-xs"><span className="font-medium">Possible thesis impact:</span> {article.thesis_impact}</p>
      )}
      {article.review_question && (
        <p className="mt-1 text-xs italic text-muted-foreground">Ask yourself: {article.review_question}</p>
      )}
    </div>
  );
}
