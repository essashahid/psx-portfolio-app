import { fetch as expoFetch } from "expo/fetch";
import { ChatStreamParser, type ChatStreamEvent } from "@psx/shared/chat/stream";
import { ApiError, apiUrl, authHeader } from "./api";

/**
 * Streams one Copilot answer, calling onEvent as each event lands.
 *
 * expo/fetch rather than the global: it is the WinterCG implementation that
 * exposes response.body as a real ReadableStream on Android and iOS. React
 * Native's own fetch buffers the whole response, which would turn a streamed
 * answer into a long wait followed by a wall of text.
 */
export async function streamChat(
  body: { message: string; threadId?: string | null; model?: string | null },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await expoFetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const parsed = JSON.parse(await response.text());
      if (typeof parsed?.error === "string") message = parsed.error;
    } catch {
      // Not JSON. The status line is all we have.
    }
    // ApiError rather than Error so the screen can tell a daily cap (429)
    // from a provider failure and word it accordingly.
    throw new ApiError(message, response.status);
  }
  if (!response.body) throw new Error("The server sent no answer stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new ChatStreamParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        onEvent(event);
      }
    }
    // A final line with no trailing newline would otherwise be lost.
    for (const event of parser.flush()) onEvent(event);
  } finally {
    reader.releaseLock();
  }
}
