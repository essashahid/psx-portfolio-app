/**
 * Backstop for the case where a model emits a function call as plain text
 * instead of a structured tool call. DeepSeek R1 (Reasoner) doesn't support
 * function calling, so if it is ever handed tools it "writes out" the call
 * using its internal markup (e.g. `<｜tool calls｜>`, `DSML`, `invoke name=`).
 *
 * A genuine answer never contains these tokens, so detection can be aggressive:
 * if any appear, we treat the whole message as a failed turn and replace it.
 */

const LEAK_RE = /\bDSML\b|tool[_▁\s]*calls?|<\s*[｜|]|invoke\s+name=|parameter\s+name=/i;

export function looksLikeToolLeak(text: string): boolean {
  return !!text && LEAK_RE.test(text);
}

export const TOOL_LEAK_FALLBACK =
  "I couldn't complete that lookup cleanly with this model. The DeepSeek Reasoner can't run live web or data lookups, so for “why did it move” questions use DeepSeek Chat or a Claude model instead.";
