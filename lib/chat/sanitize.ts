/**
 * Backstop for the case where a model emits a function call as plain text
 * instead of a structured tool call. Some providers occasionally "write out"
 * internal call markup (e.g. `<｜tool calls｜>`, `DSML`, `invoke name=`).
 *
 * Keep this narrow: normal prose may mention tools, but a genuine answer should
 * never contain provider markup or invocation syntax.
 */

const LEAK_RE = /\bDSML\b|<\s*[｜|][^>]*(tool|function)|invoke\s+name=|parameter\s+name=/i;

export function looksLikeToolLeak(text: string): boolean {
  return !!text && LEAK_RE.test(text);
}

/**
 * Enforce the house rule that answers never use em or en dashes. The owner
 * dislikes them and models (DeepSeek Flash especially) ignore the prompt
 * instruction, so we strip them deterministically as part of the pipeline: a
 * dash between digits becomes a "to" range, any other dash becomes a comma. Only
 * targets — (U+2014) and – (U+2013), so hyphens like "KSE-100" and "52-week" are
 * untouched. Applied both to the live output stream and inside the eval, so the
 * eval scores what actually ships.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}

/**
 * Whole-message typography cleanup applied at persist and render time.
 * stripEmDashes runs per streaming delta, so when a delta starts with a dash it
 * cannot see the previous delta's trailing space; the result is " , " scattered
 * through saved answers. Collapsing whitespace before punctuation here fixes
 * both stored history and the final render. Operates line by line and skips
 * table rows (lines with "|") so Markdown alignment is never touched.
 */
export function tidyTypography(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.includes("|")
        ? line
        : line
            .replace(/[ \t]+([,.;:!?])/g, "$1")
            .replace(/,([^\s\d])/g, ", $1")
            .replace(/([,.;:]) {2,}/g, "$1 ")
    )
    .join("\n");
}

/**
 * Remove planning-narration openers that models (DeepSeek V4 Pro especially)
 * emit at the start of their synthesis turn despite the prompt ban: "Now I
 * have the full picture. Let me lay out the answer." Deterministic because
 * prompting alone does not stop them; a V4 Pro test run leaked them in 5 of 16
 * answers.
 *
 * Deliberately narrow: only sentences that are unambiguously process talk are
 * removed. A legitimate finding like "No official filings were published
 * today." is kept — a leading "No …" sentence is stripped only when it is
 * followed by another planning opener (the "No news in the feed. Now I have
 * everything." pattern).
 */
const PLANNING_OPENER = new RegExp(
  "^(?:" +
    [
      "Now,? (?:I have|let me)[^.!:\\n]{0,90}[.!:]",
      "Let me (?:lay|build|assemble|synthesi[sz]e|put together|compute|map|now|search|check|look|pull|gather|dig|verify|analy[sz]e)[^.!:\\n]{0,90}[.!:]",
      "I (?:now )?have (?:everything|all the data|the full picture|a complete picture)[^.!:\\n]{0,90}[.!:]",
      "(?:Perfect|Good|Great|Right|Okay|OK)[.,!] ?(?=\\S)",
      "Here(?:'s| is) (?:the|my|your) (?:full |complete )?(?:picture|answer|analysis|assessment|breakdown)[.!:]",
      "Based on (?:all )?the (?:data|evidence|information) (?:gathered|collected) so far[^.!:\\n]{0,60}[.!:]",
    ].join("|") +
    ")\\s*",
  "i"
);
// "No X in the feed." style pre-verdicts are stripped only when chained into a
// planning opener after them.
const NO_PREFIX_BEFORE_PLANNING = /^No [^.\n]{0,90}\.\s+(?=(?:Now|Let me|I now have|I have everything|Here (?:is|'s) the))/i;

export function stripNarrationOpeners(text: string): string {
  let out = text.replace(/^\s+/, "");
  out = out.replace(NO_PREFIX_BEFORE_PLANNING, "");
  for (let i = 0; i < 3; i++) {
    const next = out.replace(PLANNING_OPENER, "");
    if (next === out) break;
    out = next.replace(/^\s+/, "");
  }
  // A divider the model used to separate its planning from the answer is now a
  // dangling first element — drop it.
  out = out.replace(/^-{3,}\s*/, "");
  return out;
}
