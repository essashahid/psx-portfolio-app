import type { PromptMode } from "@/lib/chat/system-prompt";

/**
 * Picks the answer posture for one chat request.
 *
 * Explain is the default for everyone: a decision question is answered as
 * "what to weigh" with the decision left to the user. Advise, the verdict-first
 * posture, is used only when the account has told us it is advanced AND the
 * message itself asks for a view outright ("your view", "recommend",
 * "should I", "would you"). A beginner or intermediate account never gets a
 * verdict, whatever it asks; an advanced account still gets explanations
 * unless it asks for a view.
 */

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

const ASKS_FOR_A_VIEW =
  /\b(your (own )?(view|take|opinion|call|verdict|recommendation)|recommend(ation)?s?|should i|would you|what would you do|do you think i should|advise me|your advice)\b/i;

/** True when the message explicitly asks the assistant for its own view. */
export function asksForView(message: string): boolean {
  return ASKS_FOR_A_VIEW.test(message);
}

export function chooseMode(input: { experienceLevel: string | null | undefined; message: string }): PromptMode {
  if (input.experienceLevel !== "advanced") return "explain";
  return asksForView(input.message) ? "advise" : "explain";
}
