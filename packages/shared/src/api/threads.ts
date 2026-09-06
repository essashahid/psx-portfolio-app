/**
 * The contract for the saved-conversation routes.
 *
 * A thread is what makes the Copilot worth returning to: without it every
 * question is asked into a void and yesterday's answer is gone. The shapes
 * below are what /api/chat/threads and /api/chat/threads/[id] already return.
 */

export interface ChatThreadSummary {
  id: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  /** Null on a thread created but never used. */
  last_message_at: string | null;
}

export interface SavedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string | null;
  /**
   * A mixed bag by design: data cards, persisted artifact specs under
   * kind "artifact", and the activity trail under kind "activity".
   */
  cards: { kind: string; data: unknown }[] | null;
  created_at: string;
}

export interface ThreadListResponse {
  threads: ChatThreadSummary[];
}

export interface ThreadDetailResponse {
  thread: ChatThreadSummary;
  messages: SavedChatMessage[];
}

/** What POST /api/chat/threads accepts. The title defaults to "New chat". */
export interface ThreadCreateRequest {
  title?: string;
}

/** What PATCH /api/chat/threads/[id] accepts. The title is trimmed and capped at 80 characters. */
export interface ThreadPatchRequest {
  title: string;
}

/** The response to POST /api/chat/threads and PATCH /api/chat/threads/[id]. */
export interface ThreadWriteResponse {
  thread: ChatThreadSummary;
}
