"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type FeedbackKind = "bug" | "confusing" | "idea" | "missing" | "general";

const VISITOR_KEY = "portfolioos_feedback_visitor_id";
const SESSION_KEY = "portfolioos_feedback_session_id";

function makeId(prefix: string) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id}`;
}

function getStoredId(storage: Storage, key: string, prefix: string) {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const next = makeId(prefix);
  storage.setItem(key, next);
  return next;
}

export function FeedbackWidget({ isDemo }: { isDemo: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("general");
  const [rating, setRating] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const pagePath = useMemo(() => pathname || "/", [pathname]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSent(false);
    try {
      const visitorId = getStoredId(window.localStorage, VISITOR_KEY, "visitor");
      const sessionId = getStoredId(window.sessionStorage, SESSION_KEY, "session");
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: visitorId,
          session_id: sessionId,
          kind,
          rating: rating ? Number(rating) : null,
          message,
          contact,
          page_path: pagePath,
          metadata: {
            demo: isDemo,
            viewport:
              typeof window === "undefined"
                ? null
                : { width: window.innerWidth, height: window.innerHeight },
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send feedback");
      setMessage("");
      setContact("");
      setKind("general");
      setRating("");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setSent(false);
        }}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-3 z-40 inline-flex h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium shadow-lg transition-colors hover:bg-accent md:bottom-4 md:right-4"
      >
        <MessageSquare className="h-4 w-4" />
        Feedback
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Send feedback">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="feedback-kind">Type</Label>
              <Select id="feedback-kind" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
                <option value="general">General</option>
                <option value="bug">Bug</option>
                <option value="confusing">Confusing</option>
                <option value="idea">Idea</option>
                <option value="missing">Missing feature</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feedback-rating">Rating</Label>
              <Select id="feedback-rating" value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="">No rating</option>
                <option value="5">5 - great</option>
                <option value="4">4 - good</option>
                <option value="3">3 - mixed</option>
                <option value="2">2 - weak</option>
                <option value="1">1 - poor</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-message">Feedback</Label>
            <Textarea
              id="feedback-message"
              required
              minLength={5}
              maxLength={2000}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Example: On the dashboard, I expected this number to mean X, but it looks like Y."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-contact">Contact, optional</Label>
            <Input
              id="feedback-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email, WhatsApp, or name"
              maxLength={160}
            />
          </div>

          <p className="text-[11px] text-muted-foreground">Page: {pagePath}</p>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          {sent && (
            <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Feedback sent.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="submit" disabled={submitting || message.trim().length < 5}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
