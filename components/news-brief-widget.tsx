"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Loader2, Sparkles, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BriefModel = "deepseek" | "claude-sonnet" | "claude-opus";

const MODELS: { id: BriefModel; label: string; hint: string; claude: boolean }[] = [
  { id: "deepseek", label: "DeepSeek", hint: "fast · ~$0.002", claude: false },
  { id: "claude-sonnet", label: "Claude Sonnet", hint: "sharper · ~$0.02", claude: true },
  { id: "claude-opus", label: "Claude Opus", hint: "deepest · ~$0.06", claude: true },
];

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
};

interface SavedBrief {
  content: string;
  model: string;
  createdAt: string;
}

export function NewsBriefWidget({
  hasNews,
  claudeAvailable = false,
  initialBrief = null,
}: {
  hasNews: boolean;
  claudeAvailable?: boolean;
  initialBrief?: SavedBrief | null;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(initialBrief ? "done" : "idle");
  const [content, setContent] = useState(initialBrief?.content ?? "");
  const [model, setModel] = useState<string>(initialBrief?.model ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(initialBrief?.createdAt ?? null);
  const [choice, setChoice] = useState<BriefModel>("deepseek");
  const [collapsed, setCollapsed] = useState(false);

  async function run(selected: BriefModel = choice) {
    setChoice(selected);
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
      setModel(data.model);
      setSavedAt(data.created_at ?? new Date().toISOString());
      setState("done");
    } catch (err) {
      setContent(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  const picker = (
    <ModelPicker value={choice} claudeAvailable={claudeAvailable} onPick={(m) => setChoice(m)} />
  );

  if (state === "idle") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold">Analyst brief</p>
            <p className="text-xs text-muted-foreground">AI read of your last 48h — top signal, portfolio impact, what to watch.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {picker}
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
          <Sparkles className={cn("h-4 w-4 text-emerald-600", state === "loading" && "animate-pulse")} />
          <span className="text-sm font-semibold">Analyst brief</span>
          {model && state === "done" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{model}</span>
          )}
          {savedAt && state === "done" && (
            <span className="text-[10px] text-muted-foreground" title={new Date(savedAt).toLocaleString("en-PK")}>
              saved {formatAgo(savedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {state !== "loading" && <ModelPicker value={choice} claudeAvailable={claudeAvailable} onPick={(m) => run(m)} />}
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
          {choice === "claude-opus" ? "Opus is thinking deeply — this takes a moment…" : "Reading your news feed…"}
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

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}

/** Compact model selector. In the header it re-runs on pick; idle it just sets the choice. */
function ModelPicker({
  value,
  claudeAvailable,
  onPick,
}: {
  value: BriefModel;
  claudeAvailable: boolean;
  onPick: (m: BriefModel) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onPick(e.target.value as BriefModel)}
      className="h-8 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Model used to write the brief"
    >
      {MODELS.map((m) => (
        <option key={m.id} value={m.id} disabled={m.claude && !claudeAvailable}>
          {m.label}{m.claude && !claudeAvailable ? " (needs key)" : ` · ${m.hint}`}
        </option>
      ))}
    </select>
  );
}
