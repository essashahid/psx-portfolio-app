"use client";

import { useRef, useState, useEffect } from "react";
import { ChatCards } from "@/components/chat/cards";
import type { Card } from "@/lib/chat/context";
import type { ChatLevel } from "@/lib/ai/claude";
import { cn } from "@/lib/utils";
import { Send, Loader2, Sparkles, ChevronDown, ChevronRight, Zap, Gauge, Brain } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  cards?: Card[];
  status?: string;
}

const LEVELS: { id: ChatLevel; label: string; icon: typeof Zap; hint: string }[] = [
  { id: "light", label: "Light", icon: Zap, hint: "Fastest, cheapest — quick lookups" },
  { id: "standard", label: "Standard", icon: Gauge, hint: "Balanced — default" },
  { id: "deep", label: "Deep think", icon: Brain, hint: "Most thorough — multi-step analysis" },
];

const SUGGESTIONS = [
  "How does MEBL's position look?",
  "How is the PSX market today?",
  "Which of my holdings are up today?",
  "Is OGDC cheap on valuation?",
];

export function Chat({ aiEnabled }: { aiEnabled: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [level, setLevel] = useState<ChatLevel>("standard");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
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
        body: JSON.stringify({ message: q, level, history }),
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
          if (evt.type === "cards") update((m) => ({ ...m, cards: evt.cards }));
          else if (evt.type === "thinking") update((m) => ({ ...m, thinking: (m.thinking ?? "") + evt.delta }));
          else if (evt.type === "text") update((m) => ({ ...m, content: m.content + evt.delta, status: undefined }));
          else if (evt.type === "status") update((m) => ({ ...m, status: evt.text }));
          else if (evt.type === "error") update((m) => ({ ...m, content: (m.content || "") + `\n\n⚠️ ${evt.message}` }));
        }
      }
    } catch (e) {
      update((m) => ({ ...m, content: m.content || `⚠️ ${e instanceof Error ? e.message : "Failed"}` }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div className="rise mx-auto mt-8 max-w-lg text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Sparkles className="h-5 w-5" /></div>
            <h2 className="text-base font-semibold">Ask about your portfolio or the PSX</h2>
            <p className="mt-1 text-sm text-muted-foreground">Live data, ratios, charts and filings — interpreted. {aiEnabled ? "" : "(AI narration is off; you'll still get live data cards.)"}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-lg border border-border px-3 py-2 text-left text-xs transition-colors hover:bg-muted">{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[92%]", m.role === "user" ? "rounded-2xl rounded-br-sm bg-foreground px-4 py-2 text-sm text-background" : "w-full")}>
              {m.role === "assistant" ? (
                <div className="space-y-2">
                  {m.thinking && <ThinkingPanel text={m.thinking} streaming={busy && i === messages.length - 1 && !m.content} />}
                  {m.content && <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{m.content}</div>}
                  {m.status && !m.content && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {m.status}</p>}
                  {busy && i === messages.length - 1 && !m.content && !m.status && !m.thinking && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> thinking…</p>}
                  {m.cards && <ChatCards cards={m.cards} />}
                </div>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-border pt-3">
        <div className="mb-2 flex items-center gap-1">
          {LEVELS.map((l) => {
            const Icon = l.icon;
            return (
              <button key={l.id} onClick={() => setLevel(l.id)} title={l.hint}
                className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors", level === l.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}>
                <Icon className="h-3 w-3" /> {l.label}
              </button>
            );
          })}
          {!aiEnabled && <span className="ml-auto text-[10px] text-amber-600">AI narration off — data only</span>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask anything about your holdings or PSX…"
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button type="submit" disabled={busy || !input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Research support, not financial advice. Data is cached from official PSX sources.</p>
      </div>
    </div>
  );
}

function ThinkingPanel({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3" /> {streaming ? "Thinking…" : "Reasoning"}
      </button>
      {open && <div className="whitespace-pre-wrap border-t border-border px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">{text}</div>}
    </div>
  );
}
