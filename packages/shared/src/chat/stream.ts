import type { ArtifactSpec } from "./artifacts";

/**
 * The Copilot's wire format, as typed events.
 *
 * /api/chat answers with newline-delimited JSON, one event per line. The web
 * client parsed that inline; putting the parse here means the phone and the
 * browser agree on the contract by construction, and a new event type is added
 * in one place.
 *
 * The parser is transport agnostic on purpose. It takes decoded text, not a
 * stream, because the two platforms read bytes differently: the browser uses
 * response.body.getReader(), React Native goes through expo/fetch or an XHR
 * progress handler. All of them can produce strings.
 */

export interface ChatThreadSummary {
  id: string;
  title: string | null;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
  last_message_at?: string | null;
}

export interface ActivityStep {
  id: string;
  label: string;
  done?: boolean;
  detail?: string;
}

/**
 * Mirrors the `Evt` union in app/api/chat/route.ts. Every case there must have
 * a case here: a client that quietly ignores an event type it does not know is
 * how a server-reported failure turns into a blank screen.
 */
export type ChatStreamEvent =
  | { type: "thread"; thread: ChatThreadSummary }
  | { type: "cards"; cards: { kind: string; [key: string]: unknown }[] }
  | { type: "artifact"; spec: ArtifactSpec }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "reset" }
  | { type: "activity"; id: string; label: string; done?: boolean; detail?: string }
  | { type: "status"; text: string }
  | { type: "meta"; meta: Record<string, unknown> }
  | { type: "incomplete"; reason: string }
  /** The answer failed server side. The message is meant to be shown. */
  | { type: "error"; message: string }
  | { type: "done" }
  /** Not sent by the server. Emitted locally for a line that would not parse. */
  | { type: "parse-error"; line: string; reason: string };

/**
 * Feed it decoded chunks, get whole events back.
 *
 * A chunk can split a line anywhere, so the tail is held until its newline
 * arrives. Call flush() when the response ends to emit a trailing line that
 * never got one.
 */
export class ChatStreamParser {
  private buffer = "";

  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // The last element is either an incomplete line or an empty string; either
    // way it is not ready to parse yet.
    this.buffer = lines.pop() ?? "";
    return lines.flatMap((line) => this.parseLine(line));
  }

  flush(): ChatStreamEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    return this.parseLine(rest);
  }

  private parseLine(line: string): ChatStreamEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as ChatStreamEvent;
      // A line without a type is not an event we can act on. Surfacing it as a
      // parse error beats letting it through as undefined-typed noise.
      if (!parsed || typeof (parsed as { type?: unknown }).type !== "string") {
        return [{ type: "parse-error", line: trimmed, reason: "no event type" }];
      }
      return [parsed];
    } catch {
      // One malformed line must not kill the rest of the answer.
      return [{ type: "parse-error", line: trimmed, reason: "invalid JSON" }];
    }
  }
}

/**
 * The readable sentence inside a Copilot error message.
 *
 * When the model provider rejects a request, the route forwards its response
 * body verbatim, so `message` arrives looking like
 * `400 {"type":"error","error":{"message":"..."},"request_id":"..."}`.
 * Putting that on screen asks the reader to parse JSON. This digs out the
 * innermost human sentence and falls back to the original string when there is
 * nothing better, so no information is ever lost.
 */
export function readableChatError(message: string): string {
  const start = message.indexOf("{");
  if (start === -1) return message.trim();

  try {
    const parsed: unknown = JSON.parse(message.slice(start));
    const seen = new Set<unknown>();
    // The useful text is nested at an unpredictable depth, so walk for the
    // deepest `message` string rather than assuming a shape.
    const find = (node: unknown): string | null => {
      if (!node || typeof node !== "object" || seen.has(node)) return null;
      seen.add(node);
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const value = record[key];
        if (key === "message" && typeof value === "string" && value.trim()) return value.trim();
      }
      for (const key of Object.keys(record)) {
        const nested = find(record[key]);
        if (nested) return nested;
      }
      return null;
    };
    return find(parsed) ?? message.trim();
  } catch {
    return message.trim();
  }
}
