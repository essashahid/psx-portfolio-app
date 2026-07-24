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
const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 2000;

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
  const trimmedMessage = message.trim();
  const messageLength = message.length;
  const remaining = MAX_MESSAGE_LENGTH - messageLength;
  const messageTooShort = trimmedMessage.length > 0 && trimmedMessage.length < MIN_MESSAGE_LENGTH;
  const messageTooLong = messageLength > MAX_MESSAGE_LENGTH;
  const nearLimit = remaining <= 200;
  const canSubmit = !submitting && trimmedMessage.length >= MIN_MESSAGE_LENGTH && !messageTooLong;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (messageTooLong) {
      setError(`Feedback is too long. Please keep it under ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`);
      return;
    }
    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
      setError("Please add a little more detail before sending.");
      return;
    }
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

      <Dialog open={open} onClose={() => setOpen(false)} title={sent ? "Feedback received" : "Send feedback"}>
        {sent ? (
          <div className="space-y-4 py-1">
            <div className="flex flex-col items-center rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
              <div className="relative mb-3 flex h-14 w-14 items-center justify-center">
                <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-300/45" />
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-900/15">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
              </div>
              <p className="text-base font-semibold text-emerald-950">Thanks, your feedback was sent.</p>
              <p className="mt-1 max-w-sm text-sm text-emerald-800">
                It has been added to the admin feedback queue with this page attached, so it is easy to review in context.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMessage("");
                  setSent(false);
                  setError(null);
                }}
              >
                Send another
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
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
              <div className="flex items-end justify-between gap-3">
                <Label htmlFor="feedback-message">Feedback</Label>
                <span
                  className={`text-[11px] tabular-nums ${
                    messageTooLong
                      ? "text-red-700"
                      : nearLimit
                        ? "text-amber-700"
                        : "text-muted-foreground"
                  }`}
                >
                  {messageTooLong
                    ? `${Math.abs(remaining).toLocaleString()} characters over`
                    : `${remaining.toLocaleString()} characters left`}
                </span>
              </div>
              <Textarea
                id="feedback-message"
                required
                minLength={MIN_MESSAGE_LENGTH}
                rows={5}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Example: On the dashboard, I expected this number to mean X, but it looks like Y."
                className={messageTooLong ? "border-red-300 focus-visible:ring-red-200" : undefined}
              />
              <p
                className={`text-[11px] ${
                  messageTooLong || messageTooShort ? "text-red-700" : "text-muted-foreground"
                }`}
              >
                {messageTooLong
                  ? `Feedback is too long. Please keep it under ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`
                  : messageTooShort
                    ? "Please add a little more detail before sending."
                    : "A sentence or two is enough. Longer notes are welcome, up to 2,000 characters."}
              </p>
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

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
