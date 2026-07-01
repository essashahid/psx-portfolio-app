"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Sparkles, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BriefModel = "deepseek" | "claude-sonnet" | "claude-opus";

const MD: Components = {
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-1.5 text-sm leading-relaxed text-foreground/85">{children}</p>,
  ul: ({ children }) => <ul className="my-2 space-y-1 pl-0">{children}</ul>,
  li: ({ children }) => (
    <li className="flex gap-2 text-sm leading-relaxed text-foreground/85 before:mt-1.5 before:h-1.5 before:w-1.5 before:shrink-0 before:rounded-full before:bg-emerald-500 [&>p]:my-0">
      {children}
    </li>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline-offset-2 hover:underline">
      {children}
    </a>
  ),
  hr: () => <div className="my-4 h-px bg-border" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/90 tabular-nums">{children}</td>,
};

interface SavedBrief {
  content: string;
  model: string;
  createdAt: string;
}

export function NewsBriefWidget({
  hasNews,
  initialBrief = null,
}: {
  hasNews: boolean;
  claudeAvailable?: boolean;
  initialBrief?: SavedBrief | null;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(initialBrief ? "done" : "idle");
  const [content, setContent] = useState(initialBrief?.content ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(initialBrief?.createdAt ?? null);
  const [collapsed, setCollapsed] = useState(false);

  async function run(selected: BriefModel = "deepseek") {
    setState("loading");
    setContent("");
    setCollapsed(false);
    try {
      const res = await fetch("/api/ai/news-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setContent(data.content);
      setSavedAt(data.created_at ?? new Date().toISOString());
      setState("done");
    } catch (err) {
      setContent(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-foreground/70" />
          <div>
            <p className="text-sm font-semibold">Daily investor brief</p>
            <p className="text-xs text-muted-foreground">Important developments suggested from your holdings, watchlist, and the wider market.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button onClick={() => run()} disabled={!hasNews} size="sm" className="gap-1.5" title={!hasNews ? "Refresh news first" : undefined}>
            Generate
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rise w-full rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className={cn("h-4 w-4 text-foreground/70", state === "loading" && "animate-pulse")} />
          <span className="text-sm font-semibold">Daily investor brief</span>
          {savedAt && state === "done" && (
            <span className="text-[10px] text-muted-foreground" title={new Date(savedAt).toLocaleString("en-PK")}>
              saved {formatAgo(savedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {state !== "loading" && state === "done" && (
            <Button onClick={() => run()} size="sm" variant="outline">Regenerate</Button>
          )}
          {state === "done" && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            onClick={() => setState("idle")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {state === "loading" && (
        <div className="flex items-center gap-2.5 px-4 py-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading stored events and portfolio relevance...
        </div>
      )}

      {!collapsed && state !== "loading" && content && (
        <div className={cn("px-4 pb-4 pt-3", state === "error" && "text-red-600")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{content}</ReactMarkdown>
        </div>
      )}

      {collapsed && state === "done" && (
        <p className="px-4 py-2 text-xs text-muted-foreground">Brief collapsed.</p>
      )}
    </div>
  );
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}
