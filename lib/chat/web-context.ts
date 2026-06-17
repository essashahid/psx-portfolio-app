import type { ResolvedMessage } from "@/lib/chat/resolver";
import { tavilySearch, tavilyConfigured } from "@/lib/tavily";

/**
 * Server-side web search for models that can't call tools themselves
 * (DeepSeek R1). For tool-capable models the on-demand `web_search` tool is
 * cheaper; for R1 we pre-fetch here and inject the results into the context so
 * it can still answer "why did it move" questions with cited, real-world news.
 */

/** Cheap intent gate so we only spend a Tavily call when the web is actually needed. */
export function wantsWebContext(message: string): boolean {
  return /\bwhy\b|reason|driver|catalyst|news|happen|announc|mov(e|ed|ing|ement)|surg|jump|rall|drop|fell|fall|crash|plung|spik|gain|ris(e|ing)|increas|decreas|up today|down today|what'?s? (driving|happening|going on)/i.test(
    message
  );
}

/** Fetch recent web results for the message subject, formatted for the context block. */
export async function gatherWebContext(resolved: ResolvedMessage, message: string): Promise<string> {
  if (!tavilyConfigured()) return "";
  const subject = resolved.tickers.length
    ? `${resolved.tickers.slice(0, 2).join(" ")} ${message}`
    : resolved.sector
      ? `${resolved.sector} sector ${message}`
      : message;
  const q = /pakistan|psx|kse/i.test(subject) ? subject : `${subject} Pakistan PSX`;
  try {
    const results = await tavilySearch(q, { days: 30, maxResults: 5 });
    if (!results.length) return "";
    const lines = results.map(
      (r, i) =>
        `${i + 1}. ${r.title}${r.published_date ? ` (${r.published_date})` : ""} — ${r.url}\n   ${(r.content ?? "").slice(0, 320)}`
    );
    return `<web_results note="From the web — cite these URLs inline; may be less precise than official PSX data. If none are relevant, say no specific catalyst was found.">\n${lines.join("\n")}\n</web_results>`;
  } catch {
    return ""; // never break the chat because a web search failed
  }
}
