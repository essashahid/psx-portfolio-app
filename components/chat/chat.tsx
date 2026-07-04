"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { ChatCards } from "@/components/chat/cards";
import { ArtifactRenderer } from "@/components/chat/artifacts";
import { AssistantProse } from "@/components/chat/prose";
import { splitContentWithMarkers, stripArtifactMarkers } from "@/lib/chat/md-table";
import type { Card } from "@/lib/chat/context";
import type { ArtifactSpec } from "@/lib/chat/artifacts";
import {
  CHAT_MODELS,
  DEFAULT_MODEL_ID,
  groupedModels,
  type ChatModelId,
  type ChatProvider,
} from "@/lib/ai/models";
import { looksLikeToolLeak, stripNarrationOpeners, tidyTypography } from "@/lib/chat/sanitize";
import { buildSuggestions, type PromptContext } from "@/lib/chat/prompt-suggestions";
import { cn } from "@/lib/utils";
import {
  Brain,
  ArrowDown,
  Check,
  ChevronDown,
  Clock3,
  Gauge,
  Loader2,
  Database,
  FileSearch,
  Globe2,
  MessageSquareText,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";

// A message part is either a chunk of markdown prose or an inline artifact.
type MessagePart =
  | { type: "text"; content: string }
  | { type: "artifact"; spec: ArtifactSpec };

interface Message {
  role: "user" | "assistant";
  content: string; // full prose (persisted, search-friendly)
  parts?: MessagePart[]; // runtime: text + inline artifact interleaved
  thinking?: string;
  cards?: Card[];
  status?: string;
  activity?: string[];
  complete?: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

interface SavedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string | null;
  cards: unknown;
  created_at: string;
}

const MODEL_ICONS: Record<ChatModelId, typeof Zap> = {
  "claude-haiku": Zap,
  "claude-sonnet": Gauge,
  "claude-opus": Brain,
  "deepseek-pro": Zap,
};

type ProviderStatus = Record<ChatProvider, { configured: boolean; allowed: boolean }>;

function providerReady(providers: ProviderStatus, provider: ChatProvider): boolean {
  return providers[provider]?.configured && providers[provider]?.allowed;
}

function firstAvailableModel(providers: ProviderStatus): ChatModelId {
  const def = CHAT_MODELS.find((m) => m.id === DEFAULT_MODEL_ID);
  if (def && providerReady(providers, def.provider)) return DEFAULT_MODEL_ID;
  return CHAT_MODELS.find((m) => providerReady(providers, m.provider))?.id ?? DEFAULT_MODEL_ID;
}

type ResearchMode = "Quick answer" | "Deep research" | "Portfolio analysis" | "Company comparison" | "Filing analysis";
const RESEARCH_MODES: ResearchMode[] = ["Quick answer", "Deep research", "Portfolio analysis", "Company comparison", "Filing analysis"];

// Markdown components moved to components/chat/prose.tsx (AssistantProse),
// which adds semantic number color, the lead-paragraph treatment, and
// markdown-table upgrading on top of the same house style.

export function Chat({
  providers,
  initialThreads = [],
  promptContext = null,
  sourceStatus = [],
  dataUpdated = null,
  readOnly = false,
  initialSuggestions = [],
}: {
  providers: ProviderStatus;
  initialThreads?: ChatThread[];
  promptContext?: PromptContext | null;
  sourceStatus?: string[];
  dataUpdated?: string | null;
  readOnly?: boolean;
  /** Cached personalized suggestions (chat_suggestions); template pool is the fallback. */
  initialSuggestions?: string[];
}) {
  const aiEnabled = providerReady(providers, "claude") || providerReady(providers, "deepseek");
  const [messages, setMessages] = useState<Message[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>(initialThreads);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ChatModelId>(() => firstAvailableModel(providers));
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followStreamRef = useRef(true);
  const autoLoadedReadOnlyRef = useRef(false);
  const [showLatest, setShowLatest] = useState(false);
  const [searchThreads, setSearchThreads] = useState("");
  const [researchMode, setResearchMode] = useState<ResearchMode>("Portfolio analysis");
  // Empty-state sample prompts: a pool tailored to the selected model + the
  // user's portfolio, with an offset the "Try another" control rotates through.
  const [suggestionOffset, setSuggestionOffset] = useState(0);

  useEffect(() => {
    const selected = CHAT_MODELS.find((m) => m.id === model);
    if (selected && providerReady(providers, selected.provider)) return;
    setModel(firstAvailableModel(providers));
  }, [model, providers]);

  // Personalized pool: generated in the background from the user's book and
  // question history, cached server-side, refreshed silently after the empty
  // state has painted. The deterministic template pool remains the fallback.
  const [personalized, setPersonalized] = useState<string[]>(initialSuggestions);
  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/suggestions", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions?: string[] };
        if (!cancelled && Array.isArray(data.suggestions) && data.suggestions.length >= 4) {
          setPersonalized(data.suggestions);
        }
      } catch {
        // The template pool is already on screen; stale suggestions are fine.
      }
    })();
    return () => { cancelled = true; };
  }, [readOnly]);

  // A different model can do different things well, so re-roll the fallback
  // pool and reset rotation whenever the model changes.
  const suggestionPool = useMemo(
    () => (personalized.length >= 4 ? personalized : buildSuggestions(model, promptContext)),
    [personalized, model, promptContext]
  );
  useEffect(() => { setSuggestionOffset(0); }, [model]);
  const shownSuggestions = useMemo(() => {
    const pool = suggestionPool;
    if (pool.length <= 4) return pool;
    return Array.from({ length: 4 }, (_, i) => pool[(suggestionOffset + i) % pool.length]);
  }, [suggestionPool, suggestionOffset]);
  const canShuffleSuggestions = suggestionPool.length > 4;
  const selectedModelLabel = CHAT_MODELS.find((m) => m.id === model)?.label ?? "AI";

  const hasMessages = messages.length > 0;
  const activeThread = threads.find((thread) => thread.id === currentThreadId) ?? null;
  const filteredThreads = useMemo(() => {
    const query = searchThreads.trim().toLowerCase();
    return query ? threads.filter((thread) => `${thread.title} ${thread.summary ?? ""}`.toLowerCase().includes(query)) : threads;
  }, [threads, searchThreads]);
  const groups = useMemo(() => groupThreads(filteredThreads), [filteredThreads]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    followStreamRef.current = true;
    setShowLatest(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (!followStreamRef.current) return;
    const frame = requestAnimationFrame(() => scrollToLatest("auto"));
    return () => cancelAnimationFrame(frame);
  }, [messages, scrollToLatest]);

  function handleConversationScroll() {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceFromBottom < 96;
    followStreamRef.current = nearBottom;
    setShowLatest(!nearBottom);
  }

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [input]);

  useEffect(() => {
    if (!threadsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setThreadsOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [threadsOpen]);

  function upsertThread(thread: ChatThread) {
    setThreads((prev) =>
      [thread, ...prev.filter((item) => item.id !== thread.id)].sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      )
    );
  }

  async function refreshThreads() {
    const res = await fetch("/api/chat/threads", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { threads?: ChatThread[] };
    setThreads(data.threads ?? []);
  }

  async function loadThread(id: string) {
    if (busy) return;
    setThreadError(null);
    followStreamRef.current = true;
    setLoadingThread(id);
    try {
      const res = await fetch(`/api/chat/threads/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load chat");
      setCurrentThreadId(data.thread.id);
      upsertThread(data.thread);
      setMessages((data.messages ?? []).map(savedMessageToMessage));
      setThreadsOpen(false);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : "Failed to load chat");
    } finally {
      setLoadingThread(null);
    }
  }

  function startNewChat() {
    if (readOnly) return;
    if (busy) return;
    setCurrentThreadId(null);
    setMessages([]);
    setThreadError(null);
    setThreadsOpen(false);
  }

  async function renameThread(id: string) {
    if (readOnly) return;
    const title = renameValue.trim();
    if (!title) return;
    const res = await fetch(`/api/chat/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (res.ok) {
      upsertThread(data.thread);
      setRenamingId(null);
      setRenameValue("");
    } else {
      setThreadError(data.error ?? "Failed to rename chat");
    }
  }

  async function deleteThread(id: string) {
    if (readOnly) return;
    if (!window.confirm("Delete this saved chat?")) return;
    const res = await fetch(`/api/chat/threads/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setThreadError(data.error ?? "Failed to delete chat");
      return;
    }
    setThreads((prev) => prev.filter((thread) => thread.id !== id));
    if (currentThreadId === id) startNewChat();
  }

  async function send(text: string) {
    if (readOnly) return;
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setThreadError(null);
    const threadId = currentThreadId;
    const history = messages
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      { role: "user", content: q },
      { role: "assistant", content: "", activity: ["Understanding your question"] },
    ]);

    const update = (fn: (m: Message) => Message) =>
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, model, threadId, history }),
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let receivedDone = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === "thread") {
            setCurrentThreadId(evt.thread.id);
            upsertThread(evt.thread);
          } else if (evt.type === "cards") {
            // Filter out persisted artifact wrappers — they arrive separately as "artifact" events.
            const dataCards = (evt.cards as { kind: string }[]).filter((c) => c.kind !== "artifact");
            update((m) => ({ ...m, cards: dataCards as Card[] }));
          } else if (evt.type === "artifact") {
            // Append the spec as a new artifact part; it will render inline.
            update((m) => {
              const parts: MessagePart[] = m.parts
                ? [...m.parts, { type: "artifact", spec: evt.spec as ArtifactSpec }]
                : [{ type: "text", content: m.content }, { type: "artifact", spec: evt.spec as ArtifactSpec }];
              return { ...m, parts };
            });
          } else if (evt.type === "thinking") continue;
          else if (evt.type === "text") {
            // Append delta to content (persisted prose) and to the last text part.
            update((m) => {
              const delta = evt.delta as string;
              const existingParts = m.parts ?? [{ type: "text" as const, content: m.content }];
              const last = existingParts[existingParts.length - 1];
              let parts: MessagePart[];
              if (last?.type === "text") {
                parts = [...existingParts.slice(0, -1), { type: "text" as const, content: last.content + delta }];
              } else {
                parts = [...existingParts, { type: "text" as const, content: delta }];
              }
              return { ...m, content: m.content + delta, parts };
            });
          } else if (evt.type === "reset") {
            update((m) => ({ ...m, content: "", parts: [{ type: "text" as const, content: "" }] }));
          } else if (evt.type === "status") update((m) => ({
            ...m,
            status: evt.text,
            activity: [...(m.activity ?? []).filter((item) => item !== evt.text), evt.text],
          }));
          else if (evt.type === "done") {
            receivedDone = true;
            update((m) => ({ ...m, status: undefined, complete: true }));
          }
          else if (evt.type === "incomplete") {
            // The server reports the answer may be cut short. Append a quiet note
            // so the user knows there is more, rather than wondering if it froze.
            const note = "\n\n_This answer may be cut short. Ask a narrower follow-up to get the rest._";
            update((m) => {
              const existingParts = m.parts ?? [{ type: "text" as const, content: m.content }];
              const last = existingParts[existingParts.length - 1];
              const parts: MessagePart[] = last?.type === "text"
                ? [...existingParts.slice(0, -1), { type: "text" as const, content: last.content + note }]
                : [...existingParts, { type: "text" as const, content: note }];
              return { ...m, content: (m.content || "") + note, parts };
            });
          }
          else if (evt.type === "error") {
            const errText = `\n\nError: ${evt.message as string}`;
            update((m) => {
              const existingParts = m.parts ?? [{ type: "text" as const, content: m.content }];
              const last = existingParts[existingParts.length - 1];
              const parts: MessagePart[] = last?.type === "text"
                ? [...existingParts.slice(0, -1), { type: "text" as const, content: last.content + errText }]
                : [...existingParts, { type: "text" as const, content: errText }];
              return { ...m, content: (m.content || "") + errText, parts };
            });
          }
        }
      }
      // The stream ended but no `done` event ever arrived — the connection was
      // severed mid-answer (almost always a server-side function timeout on a
      // very broad question). Without this the UI would sit frozen on the last
      // status forever. Surface a clear, actionable message instead.
      if (!receivedDone) {
        const note =
          "The analysis didn't finish in time. This question is likely too broad to complete in one pass — try narrowing it to one or two holdings, or a single sector.";
        update((m) => {
          const text = m.content?.trim() ? `\n\n_${note}_` : note;
          const existingParts = m.parts ?? [{ type: "text" as const, content: m.content }];
          const last = existingParts[existingParts.length - 1];
          const parts: MessagePart[] = last?.type === "text"
            ? [...existingParts.slice(0, -1), { type: "text" as const, content: last.content + text }]
            : [...existingParts, { type: "text" as const, content: text }];
          return { ...m, content: (m.content || "") + text, parts };
        });
      }
    } catch (e) {
      update((m) => ({ ...m, content: m.content || `Error: ${e instanceof Error ? e.message : "Failed"}` }));
    } finally {
      setBusy(false);
      update((m) => ({ ...m, status: undefined, complete: true }));
      void refreshThreads();
      // The question history just changed, so warm the personalized pool in
      // the background; the server skips regeneration when nothing changed.
      void fetch("/api/chat/suggestions", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { suggestions?: string[] };
          if (Array.isArray(data.suggestions) && data.suggestions.length >= 4) setPersonalized(data.suggestions);
        })
        .catch(() => {});
    }
  }

  useEffect(() => {
    if (!readOnly || autoLoadedReadOnlyRef.current || currentThreadId || !threads[0]) return;
    autoLoadedReadOnlyRef.current = true;
    void loadThread(threads[0].id);
    // loadThread intentionally stays out of deps; this is a one-time demo-library bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, currentThreadId, threads]);

  const renderThreadRow = (thread: ChatThread) => {
    const active = thread.id === currentThreadId;
    const loading = loadingThread === thread.id;
    if (!readOnly && renamingId === thread.id) {
      return (
        <form
          key={thread.id}
          onSubmit={(e) => { e.preventDefault(); void renameThread(thread.id); }}
          className="flex items-center gap-1 px-1.5 py-1"
        >
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="submit" aria-label="Save chat name" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setRenamingId(null)} aria-label="Cancel rename" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      );
    }
    return (
      <div
        key={thread.id}
        className={cn(
          "group relative flex items-center rounded-lg pr-1 transition-colors",
          active ? "bg-muted" : "hover:bg-muted/60"
        )}
      >
        <button
          onClick={() => void loadThread(thread.id)}
          disabled={busy}
          aria-current={active ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <MessageSquareText className={cn("h-3.5 w-3.5 shrink-0", active ? "text-emerald-600" : "text-muted-foreground")} />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground">{thread.title}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock3 className="h-2.5 w-2.5" /> {formatThreadTime(thread.last_message_at)}
            </span>
          </span>
        </button>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              onClick={() => { setRenamingId(thread.id); setRenameValue(thread.title); }}
              title="Rename"
              aria-label="Rename chat"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => void deleteThread(thread.id)}
              title="Delete"
              aria-label="Delete chat"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-red-600"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  // Shared composer form — rendered inline on the empty state and sticky on
  // the active state. The ref and handlers are identical in both positions.
  const composerForm = readOnly ? (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      Read-only demo: browse the curated research library. Follow-up questions are available after private onboarding.
    </div>
  ) : (
    <form
      onSubmit={(e) => { e.preventDefault(); send(input); }}
      className="rounded-2xl border border-border/90 bg-card shadow-[0_8px_28px_-24px_rgba(15,23,42,0.5)] transition focus-within:border-emerald-300 focus-within:ring-4 focus-within:ring-emerald-500/10"
    >
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
        placeholder="Ask about your portfolio, a PSX company, or the market"
        rows={1}
        enterKeyHint="send"
        aria-label="Message Research Copilot"
        className="max-h-32 w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 text-base leading-6 outline-none md:text-[15px]"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <select
          value={researchMode}
          onChange={(e) => setResearchMode(e.target.value as ResearchMode)}
          aria-label="Research mode"
          className="h-8 rounded-lg border border-border bg-background px-2 text-[11px] font-medium text-foreground outline-none"
        >
          {RESEARCH_MODES.map((mode) => <option key={mode}>{mode}</option>)}
        </select>
        <details className="relative">
          <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted">
            <Database className="h-3.5 w-3.5" /> Context
          </summary>
          <div className="absolute bottom-10 left-0 z-20 w-72 rounded-lg border border-border bg-card p-3 text-xs shadow-card">
            <p className="font-semibold">Sources used in this answer</p>
            {sourceStatus.length ? (
              <ul className="mt-2 space-y-1 text-muted-foreground">{sourceStatus.map((s) => <li key={s}>{s}</li>)}</ul>
            ) : (
              <p className="mt-2 text-muted-foreground">Data availability is checked before research.</p>
            )}
          </div>
        </details>
        <details className="relative">
          <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted" title="Advanced model settings" aria-label="Advanced model settings">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </summary>
          <div className="absolute bottom-10 left-0 z-20 rounded-lg border border-border bg-card p-2 shadow-card">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Model</p>
            <ModelPicker model={model} setModel={setModel} providers={providers} />
          </div>
        </details>
        {!aiEnabled && <span className="text-[10px] text-amber-600">AI narration off</span>}
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send message"
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-[0_8px_20px_-10px_rgba(5,150,105,0.8)] transition hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );

  return (
    // Mobile height: 100dvh minus top bar (3.5rem) and bottom nav pb (5.75rem) plus safe-area insets.
    // Desktop height: 100dvh minus the app-shell footer (~2.75rem); md:-m-8 in page.tsx cancels main padding.
    <div className="flex h-[calc(100dvh-9.25rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col bg-background md:h-[calc(100dvh-2.75rem)]">

      {/* ── Compact workspace header ── */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-border/70 px-3 sm:px-5">
        <button
          type="button"
          onClick={() => setThreadsOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted md:hidden"
          aria-label="Saved research"
          title="Saved research"
        >
          <MessageSquareText className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-[-0.015em]">
            {activeThread?.title ?? "Research Copilot"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {readOnly ? "Read-only demo research library" : currentThreadId ? "Saved research" : "Portfolio-aware research workspace"}
          </p>
        </div>
        {busy && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground sm:flex">
            <Loader2 className="h-3 w-3 animate-spin" /> Researching
          </span>
        )}
        {dataUpdated && (
          <details className="relative hidden sm:block">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted">
              <Clock3 className="h-3.5 w-3.5" /> Data updated {dataUpdated}
            </summary>
            <div className="absolute right-0 top-11 z-30 w-72 rounded-lg border border-border bg-card p-3 text-xs shadow-card">
              <p className="font-semibold">Data sources</p>
              {sourceStatus.length ? (
                <ul className="mt-2 space-y-1 text-muted-foreground">{sourceStatus.map((s) => <li key={s}>{s}</li>)}</ul>
              ) : (
                <p className="mt-2 text-muted-foreground">Availability is checked before each answer.</p>
              )}
            </div>
          </details>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy}
            title="New conversation"
            aria-label="New conversation"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setThreadsOpen((o) => !o)}
          aria-expanded={threadsOpen}
          aria-controls="history-drawer"
          title={readOnly ? "Curated conversations" : "Conversation history"}
          aria-label={readOnly ? "Curated conversations" : "Conversation history"}
          className={cn(
            "hidden shrink-0 items-center gap-1.5 rounded-lg px-2.5 h-9 text-[12px] font-medium transition-colors md:flex",
            threadsOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          <PanelRight className="h-4 w-4" />
          {readOnly ? "Curated chats" : "History"}
        </button>
      </header>

      {/* ── Content region: two mutually exclusive states ── */}
      {!hasMessages ? (
        // ── EMPTY STATE — centered group with inline composer ──
        <div className="scroll-touch flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center px-4 pb-10 pt-8">
            <div className="w-full max-w-180">
              {/* Welcome heading */}
              <div className="rise mb-7 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold tracking-[-0.01em]">{readOnly ? "Browse demo research" : "Research your portfolio"}</h2>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
                  {readOnly
                    ? "Open a curated conversation to see labelled answers, charts and tables based on the demo portfolio."
                    : "Ask about your holdings, compare companies, review official filings, analyse valuation or understand what moved your portfolio."}
                  {!readOnly && !aiEnabled && " AI narration is off — live data cards will still appear."}
                </p>
              </div>

              {/* Model-aware, portfolio-personalized sample prompts */}
              {!readOnly && shownSuggestions.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {personalized.length >= 4 ? "Suggested for your portfolio" : `Suggested for ${selectedModelLabel}`}
                    </span>
                    {canShuffleSuggestions && (
                      <button
                        type="button"
                        onClick={() => setSuggestionOffset((o) => o + 4)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <RefreshCw className="h-3 w-3" /> Try another
                      </button>
                    )}
                  </div>
                  <div key={`${model}-${suggestionOffset}`} className="rise grid gap-2 sm:grid-cols-2">
                    {shownSuggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        disabled={busy}
                        className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 py-3 text-left text-[13px] text-foreground/90 transition-colors hover:border-border hover:bg-muted/40 disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                        <span className="min-w-0">{s}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline composer */}
              {composerForm}
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Portfolio tracking and research support only. Not financial advice.
              </p>
            </div>
          </div>
        </div>
      ) : (
        // ── ACTIVE STATE — scrollable messages + sticky composer ──
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={handleConversationScroll}
              className="scroll-touch h-full overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-3xl space-y-7 px-4 py-6 sm:px-6 sm:py-8">
                {messages.map((m, i) => (
                  <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    {m.role === "assistant" ? (
                      <div className="w-full space-y-3">
                        {m.activity && m.activity.length > 0 && (
                          <ResearchActivity
                            steps={m.activity}
                            active={busy && i === messages.length - 1}
                            complete={!!m.complete || !(busy && i === messages.length - 1)}
                          />
                        )}
                        {m.cards && <ChatCards cards={m.cards} />}
                        {busy && i === messages.length - 1 && !m.content && !m.activity?.length && (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Preparing research...
                          </p>
                        )}
                        {/* Parts-based rendering: prose and inline artifacts interleaved.
                            Table upgrading waits until the message stops streaming so a
                            half-received table doesn't flicker between forms. */}
                        {m.parts
                          ? m.parts.map((part, pi) =>
                              part.type === "artifact" ? (
                                <ArtifactRenderer key={pi} spec={part.spec} />
                              ) : part.content ? (
                                <AssistantProse
                                  key={pi}
                                  content={formatAssistantContent(part.content)}
                                  lead={pi === 0}
                                  upgradeTables={!(busy && i === messages.length - 1)}
                                />
                              ) : null
                            )
                          : m.content && (
                              <AssistantProse
                                content={formatAssistantContent(m.content)}
                                lead
                                upgradeTables={!(busy && i === messages.length - 1)}
                              />
                            )
                        }
                      </div>
                    ) : (
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-6 text-background">
                        {m.content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {showLatest && (
              <button
                type="button"
                onClick={() => scrollToLatest()}
                className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg transition hover:bg-muted"
              >
                <ArrowDown className="h-3.5 w-3.5" /> Latest response
              </button>
            )}
          </div>

          {/* Sticky composer — only shown in active state */}
          <div className="shrink-0 border-t border-border/70 bg-background/85 backdrop-blur-xl">
            <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
              {composerForm}
            </div>
          </div>
        </div>
      )}

      {/* ── History drawer backdrop ── */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-300",
          threadsOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setThreadsOpen(false)}
        aria-hidden="true"
      />

      {/* ── History drawer panel ── */}
      <aside
        id="history-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Saved research"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(20rem,90vw)] flex-col border-l border-border bg-card shadow-2xl transition-[transform,visibility] duration-300",
          threadsOpen ? "translate-x-0 visible" : "translate-x-full invisible"
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Saved research</p>
            <p className="text-[11px] text-muted-foreground">{threads.length} conversation{threads.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex items-center gap-1">
            {!readOnly && (
              <button
                onClick={startNewChat}
                disabled={busy}
                title="New conversation"
                aria-label="New conversation"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setThreadsOpen(false)}
              aria-label="Close history"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="px-3 py-2.5">
          <input
            value={searchThreads}
            onChange={(e) => setSearchThreads(e.target.value)}
            placeholder="Search research…"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {threadError && (
          <p className="mx-3 mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">{threadError}</p>
        )}
        <div className="scroll-touch min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {threads.length === 0 ? (
            <div className="m-2 rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              {readOnly ? "Curated demo conversations will appear here." : "Your conversations will appear here after the first message."}
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="m-2 rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No conversations match that search.
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              {([["Today", groups.today], ["Previous 7 days", groups.week], ["Older", groups.older]] as const).map(([label, list]) =>
                list.length ? (
                  <div key={label}>
                    <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <div className="space-y-0.5">{list.map(renderThreadRow)}</div>
                  </div>
                ) : null
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function groupThreads(threads: ChatThread[]): { today: ChatThread[]; week: ChatThread[]; older: ChatThread[] } {
  const now = Date.now();
  const DAY = 86_400_000;
  const today: ChatThread[] = [];
  const week: ChatThread[] = [];
  const older: ChatThread[] = [];
  for (const thread of threads) {
    const age = now - new Date(thread.last_message_at).getTime();
    if (age < DAY) today.push(thread);
    else if (age < 7 * DAY) week.push(thread);
    else older.push(thread);
  }
  return { today, week, older };
}

function savedMessageToMessage(row: SavedMessage): Message {
  const allCards = Array.isArray(row.cards) ? (row.cards as { kind: string; data: unknown }[]) : [];
  // Separate data cards from persisted artifact specs.
  const dataCards = allCards.filter((c) => c.kind !== "artifact") as Card[];
  const artifactCards = allCards.filter((c) => c.kind === "artifact").map((c) => c.data as ArtifactSpec);
  // Restore the streamed interleaving from [[artifact:N]] position markers;
  // messages saved before markers existed fall back to prose-then-artifacts.
  const parts = splitContentWithMarkers(row.content, artifactCards) as MessagePart[];
  return {
    role: row.role,
    content: stripArtifactMarkers(row.content),
    parts,
    thinking: row.thinking ?? undefined,
    cards: dataCards.length ? dataCards : undefined,
  };
}

function formatAssistantContent(content: string): string {
  if (looksLikeToolLeak(content)) return "";
  return stripNarrationOpeners(
    tidyTypography(
      stripArtifactMarkers(content)
        .replace(/\r\n/g, "\n")
        .replace(/([.!?])(?=[A-Z][a-z])/g, "$1 ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    )
  );
}

function formatThreadTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ModelPicker({
  model,
  setModel,
  providers,
}: {
  model: ChatModelId;
  setModel: (id: ChatModelId) => void;
  providers: ProviderStatus;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = CHAT_MODELS.find((m) => m.id === model) ?? CHAT_MODELS[0];
  const SelectedIcon = MODEL_ICONS[selected.id];

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 max-w-[calc(100vw-3rem)] items-center gap-1.5 rounded-full bg-muted px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/70 md:min-h-0 md:px-2.5 md:py-1"
        title="Choose model"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SelectedIcon className="h-3 w-3" />
        <span className="text-muted-foreground">{selected.group}</span>
        {selected.label}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="scroll-touch absolute bottom-full left-0 z-20 mb-1.5 max-h-[min(70dvh,28rem)] w-[min(16rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-border bg-card shadow-card"
        >
          {groupedModels().map((g) => (
            <div key={g.group} className="py-1">
              <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>
              {g.models.map((m) => {
                const Icon = MODEL_ICONS[m.id];
                const provider = providers[m.provider];
                const available = providerReady(providers, m.provider);
                const active = m.id === model;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={!available}
                    onClick={() => {
                      setModel(m.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors md:min-h-0 md:py-1.5",
                      active ? "bg-muted" : "hover:bg-muted/60",
                      !available && "cursor-not-allowed opacity-40 hover:bg-transparent"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1">
                      <span className="font-medium">{m.label}</span>
                      <span className="block text-[10px] leading-tight text-muted-foreground">
                        {available ? m.hint : provider?.allowed ? "API key not configured" : "Disabled for this account"}
                      </span>
                    </span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResearchActivity({
  steps,
  active,
  complete,
}: {
  steps: string[];
  active: boolean;
  complete: boolean;
}) {
  const [open, setOpen] = useState(false);

  const latest = steps[steps.length - 1];
  const expanded = active || open;

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-950/10 bg-[linear-gradient(135deg,rgba(236,253,245,0.85),rgba(255,255,255,0.9))] shadow-[0_14px_40px_-30px_rgba(5,150,105,0.55)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left"
        aria-expanded={expanded}
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200/80 bg-white text-emerald-700 shadow-sm">
          {active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {active && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-white bg-emerald-500" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs font-semibold tracking-[-0.01em] text-foreground">
            {active ? "Research in progress" : "Research complete"}
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700">
              Live
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{latest}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="border-t border-emerald-950/10 bg-white/55 px-4 py-3">
          <div className="relative space-y-0">
            {steps.map((step, index) => {
              const isCurrent = active && index === steps.length - 1;
              const Icon = activityIcon(step);
              return (
                <div key={`${step}-${index}`} className="relative flex min-h-9 items-start gap-3 pb-2 last:min-h-0 last:pb-0">
                  {index < steps.length - 1 && <span className="absolute left-2.75 top-6 h-[calc(100%-0.25rem)] w-px bg-emerald-200" />}
                  <span className={cn(
                    "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white",
                    isCurrent ? "border-emerald-400 text-emerald-700 shadow-[0_0_0_3px_rgba(16,185,129,0.10)]" : "border-emerald-200 text-emerald-600"
                  )}>
                    {isCurrent ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                  </span>
                  <span className={cn("pt-1 text-[11px] leading-4", isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>{step}</span>
                </div>
              );
            })}
            {complete && !active && (
              <div className="mt-2 flex items-center gap-2 border-t border-emerald-950/10 pt-2 text-[10px] font-medium text-emerald-700">
                <Check className="h-3 w-3" /> Sources reviewed and answer synthesized
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function activityIcon(step: string) {
  const value = step.toLowerCase();
  if (value.includes("web") || value.includes("coverage") || value.includes("news")) return Globe2;
  if (value.includes("portfolio") || value.includes("holding") || value.includes("market data")) return Database;
  if (value.includes("filing") || value.includes("document") || value.includes("source")) return FileSearch;
  if (value.includes("answer") || value.includes("synth")) return Sparkles;
  return Check;
}
