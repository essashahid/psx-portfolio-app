"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Loader2, Sparkles, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MD: Components = {
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-1.5 text-sm leading-relaxed text-foreground/85">{children}</p>
  ),
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
};

export function NewsBriefWidget({ hasNews }: { hasNews: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [content, setContent] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [collapsed, setCollapsed] = useState(false);

  async function run() {
    setState("loading");
    setContent("");
    setCollapsed(false);
    try {
      const res = await fetch("/api/ai/news-brief", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setContent(data.content);
      setModel(data.model);
      setState("done");
    } catch (err) {
      setContent(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <Button
        onClick={run}
        disabled={!hasNews}
        variant="outline"
        size="sm"
        className="gap-1.5"
        title={!hasNews ? "Refresh news first" : undefined}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Analyst brief
      </Button>
    );
  }

  return (
    <div className="rise rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className={cn("h-4 w-4 text-emerald-600", state === "loading" && "animate-pulse")} />
          <span className="text-sm font-semibold">Analyst brief</span>
          {model && state === "done" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{model}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {state === "done" && (
            <>
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={collapsed ? "Expand" : "Collapse"}
              >
                {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={run}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Refresh
              </button>
            </>
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
          Reading your news feed…
        </div>
      )}

      {!collapsed && state !== "loading" && content && (
        <div className={cn("px-4 pb-4 pt-3", state === "error" && "text-red-600")}>
          <ReactMarkdown components={MD}>{content}</ReactMarkdown>
        </div>
      )}

      {collapsed && state === "done" && (
        <p className="px-4 py-2 text-xs text-muted-foreground">Brief collapsed — click ↓ to expand.</p>
      )}
    </div>
  );
}
