"use client";

import { useRef, useState, useEffect } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatCards } from "@/components/chat/cards";
import type { Card } from "@/lib/chat/context";
import {
  CHAT_MODELS,
  DEFAULT_MODEL_ID,
  groupedModels,
  type ChatModelId,
  type ChatProvider,
} from "@/lib/ai/models";
import { looksLikeToolLeak } from "@/lib/chat/sanitize";
import { cn } from "@/lib/utils";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Gauge,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  cards?: Card[];
  status?: string;
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
  "deepseek-chat": Zap,
  "deepseek-reasoner": Brain,
};

/** First selectable model whose provider has a key configured, else the default. */
function firstAvailableModel(providers: Record<ChatProvider, boolean>): ChatModelId {
  const def = CHAT_MODELS.find((m) => m.id === DEFAULT_MODEL_ID);
  if (def && providers[def.provider]) return DEFAULT_MODEL_ID;
  return CHAT_MODELS.find((m) => providers[m.provider])?.id ?? DEFAULT_MODEL_ID;
}

const SUGGESTIONS = [
  "How does MEBL's position look?",
  "How is the PSX market today?",
  "Which of my holdings are up today?",
  "Is OGDC cheap on valuation?",
];

const CHAT_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h2 className="mb-3 mt-5 text-xl font-semibold tracking-editorial first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mb-3 mt-5 text-lg font-semibold tracking-editorial first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2.5 mt-4 text-base font-semibold tracking-editorial first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-3 text-sm font-semibold text-foreground">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-6 text-foreground/85 sm:leading-7">{children}</p>,
  ul: ({ children }) => <ul className="my-3 space-y-2 pl-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-3 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="leading-6 text-foreground/85 sm:leading-7 [&>p]:my-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-foreground/75">{children}</em>,
  hr: () => <div className="my-5 h-px bg-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-md border-l-2 border-emerald-500 bg-emerald-50/50 px-3 py-2 text-sm text-foreground/80">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline-offset-4 hover:underline">
      {children}
    </a>
  ),
  code: ({ children, className, ...props }) => (
    <code className={cn("rounded bg-muted px-1.5 py-0.5 text-[0.9em] text-foreground", className)} {...props}>
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }) => <tr className="transition-colors hover:bg-muted/30">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/90 tabular-nums">{children}</td>,
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
};

export function Chat({
  providers,
  initialThreads = [],
}: {
  providers: Record<ChatProvider, boolean>;
  initialThreads?: ChatThread[];
}) {
  const aiEnabled = providers.claude || providers.deepseek;
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

  const activeThread = threads.find((thread) => thread.id === currentThreadId) ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [input]);

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
    if (busy) return;
    setCurrentThreadId(null);
    setMessages([]);
    setThreadError(null);
    setThreadsOpen(false);
  }

  async function renameThread(id: string) {
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
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setThreadError(null);
    const threadId = currentThreadId;
    const history = messages
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "" }]);

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
          } else if (evt.type === "cards") update((m) => ({ ...m, cards: evt.cards }));
          else if (evt.type === "thinking") update((m) => ({ ...m, thinking: (m.thinking ?? "") + evt.delta }));
          else if (evt.type === "text") update((m) => ({ ...m, content: m.content + evt.delta, status: undefined }));
          else if (evt.type === "reset") update((m) => ({ ...m, content: "" }));
          else if (evt.type === "status") update((m) => ({ ...m, status: evt.text }));
          else if (evt.type === "error") update((m) => ({ ...m, content: (m.content || "") + `\n\nError: ${evt.message}` }));
        }
      }
    } catch (e) {
      update((m) => ({ ...m, content: m.content || `Error: ${e instanceof Error ? e.message : "Failed"}` }));
    } finally {
      setBusy(false);
      void refreshThreads();
    }
  }

  return (
    <div className="grid min-h-[calc(100dvh-12.5rem)] gap-3 md:h-[calc(100dvh-9rem)] md:min-h-0 md:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-[var(--shadow-card)] md:max-h-none">
        <div className={cn("flex items-center justify-between gap-2 px-3 py-2", (threadsOpen || threadError) && "border-b border-border", "md:border-b md:py-3")}>
          <button
            type="button"
            onClick={() => setThreadsOpen((open) => !open)}
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left md:pointer-events-none"
            aria-expanded={threadsOpen}
            aria-controls="saved-chat-list"
          >
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform md:hidden", !threadsOpen && "-rotate-90")} />
            <div className="min-w-0">
            <p className="text-sm font-semibold">Saved chats</p>
            <p className="text-[11px] text-muted-foreground">{threads.length} conversation{threads.length === 1 ? "" : "s"}</p>
            </div>
          </button>
          <button
            onClick={startNewChat}
            disabled={busy}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 md:h-8 md:w-8"
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {threadError && (
          <p className="mx-3 mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            {threadError}
          </p>
        )}

        <div
          id="saved-chat-list"
          className={cn(
            "scroll-touch max-h-52 gap-2 overflow-x-auto p-3 md:flex md:max-h-none md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto",
            threadsOpen ? "flex" : "hidden"
          )}
        >
          {threads.length === 0 ? (
            <div className="min-w-56 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground md:min-w-0">
              Your chats will appear here after the first message.
            </div>
          ) : (
            threads.map((thread) => {
              const active = thread.id === currentThreadId;
              const loading = loadingThread === thread.id;
              return (
                <div
                  key={thread.id}
                  className={cn(
                    "group min-w-64 rounded-lg border p-2 transition-colors sm:min-w-72 md:min-w-0",
                    active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/50 hover:bg-muted"
                  )}
                >
                  {renamingId === thread.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void renameThread(thread.id);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-base text-foreground outline-none focus:ring-2 focus:ring-ring md:h-8 md:text-xs"
                        autoFocus
                      />
                      <button type="submit" aria-label="Save chat name" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white md:h-8 md:w-8">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        aria-label="Cancel rename"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground md:h-8 md:w-8"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        onClick={() => void loadThread(thread.id)}
                        disabled={busy}
                        className="block w-full text-left disabled:opacity-60"
                      >
                        <span className="flex items-center gap-2">
                          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5 shrink-0" />}
                          <span className="truncate text-xs font-semibold">{thread.title}</span>
                        </span>
                        <span className={cn("mt-1 block line-clamp-2 text-[11px] leading-relaxed", active ? "text-white/70" : "text-muted-foreground")}>
                          {thread.summary ?? "No summary yet"}
                        </span>
                        <span className={cn("mt-1 flex items-center gap-1 text-[10px]", active ? "text-white/60" : "text-muted-foreground")}>
                          <Clock3 className="h-3 w-3" /> {formatThreadTime(thread.last_message_at)}
                        </span>
                      </button>
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          onClick={() => {
                            setRenamingId(thread.id);
                            setRenameValue(thread.title);
                          }}
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-md transition-colors md:h-7 md:w-7",
                            active ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                          title="Rename chat"
                          aria-label="Rename chat"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void deleteThread(thread.id)}
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-md transition-colors md:h-7 md:w-7",
                            active ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          )}
                          title="Delete chat"
                          aria-label="Delete chat"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex min-h-[calc(100dvh-16.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-background/45 md:min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{activeThread?.title ?? "New chat"}</p>
            <p className="text-[11px] text-muted-foreground">
              {currentThreadId ? "Saved automatically. Continue any time." : "A saved chat starts when you send a message."}
            </p>
          </div>
          {busy && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving
            </span>
          )}
        </div>

        <div ref={scrollRef} className="scroll-touch min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
          {messages.length === 0 && (
            <div className="rise mx-auto mt-8 max-w-lg text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Sparkles className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold">Ask about your portfolio or the PSX</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Live data, ratios, charts and filings - interpreted. {aiEnabled ? "" : "(AI narration is off; you will still get live data cards.)"}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs transition-colors hover:bg-muted">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[96%] sm:max-w-[94%]", m.role === "user" ? "rounded-2xl rounded-br-sm bg-foreground px-4 py-2 text-sm text-background" : "w-full")}>
                {m.role === "assistant" ? (
                  <div className="space-y-2">
                    {m.thinking && <ThinkingPanel text={m.thinking} streaming={busy && i === messages.length - 1 && !m.content} />}
                    {m.content && (
                      <div className="max-w-4xl rounded-lg border border-border bg-card/85 px-3 py-3 text-sm shadow-[var(--shadow-card)] sm:px-5 sm:py-4 sm:text-[15px]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={CHAT_MARKDOWN_COMPONENTS}>
                          {formatAssistantContent(m.content)}
                        </ReactMarkdown>
                      </div>
                    )}
                    {m.status && !m.content && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {m.status}</p>}
                    {busy && i === messages.length - 1 && !m.content && !m.status && !m.thinking && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> thinking...</p>}
                    {m.cards && <div className="max-w-5xl"><ChatCards cards={m.cards} /></div>}
                  </div>
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border bg-background/95 p-3 backdrop-blur">
          <div className="mb-2 flex items-center gap-2">
            <ModelPicker model={model} setModel={setModel} providers={providers} />
            {!aiEnabled && <span className="ml-auto text-[10px] text-amber-600">AI narration off - data only</span>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Ask anything about your holdings or PSX..."
              rows={1}
              enterKeyHint="send"
              aria-label="Message Research Copilot"
              className="min-h-11 max-h-32 flex-1 resize-none overflow-y-auto rounded-xl border border-border bg-card px-3 py-2.5 text-base leading-6 outline-none focus:ring-2 focus:ring-emerald-500/30 md:text-sm"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:opacity-40 md:h-10 md:w-10">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Chats save automatically. Data is cached from official PSX sources.</p>
        </div>
      </section>
    </div>
  );
}

function savedMessageToMessage(row: SavedMessage): Message {
  return {
    role: row.role,
    content: row.content,
    thinking: row.thinking ?? undefined,
    cards: Array.isArray(row.cards) ? (row.cards as Card[]) : undefined,
  };
}

function formatAssistantContent(content: string): string {
  // Hide leaked tool-call markup while it streams; the server resends a clean
  // fallback once the turn ends.
  if (looksLikeToolLeak(content)) return "";
  return content
    .replace(/\r\n/g, "\n")
    .replace(/([.!?])(?=[A-Z][a-z])/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  providers: Record<ChatProvider, boolean>;
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
          className="scroll-touch absolute bottom-full left-0 z-20 mb-1.5 max-h-[min(70dvh,28rem)] w-[min(16rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-border bg-card shadow-[var(--shadow-card)]"
        >
          {groupedModels().map((g) => (
            <div key={g.group} className="py-1">
              <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>
              {g.models.map((m) => {
                const Icon = MODEL_ICONS[m.id];
                const available = providers[m.provider];
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
                        {available ? m.hint : "API key not configured"}
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

function ThinkingPanel({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <button onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-muted-foreground md:min-h-0 md:px-2.5 md:py-1.5">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3" /> {streaming ? "Thinking..." : "Reasoning"}
      </button>
      {open && <div className="whitespace-pre-wrap border-t border-border px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">{text}</div>}
    </div>
  );
}
