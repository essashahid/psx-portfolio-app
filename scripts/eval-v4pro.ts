/**
 * One-off test harness: runs the 15-question test set (plus one follow-up)
 * against DeepSeek V4 Pro using the EXACT production pipeline — resolver,
 * cards, brief, system prompt, tools — for the eessashahid@gmail.com account.
 * Read-only: nothing is persisted to chat threads.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { appendFileSync, writeFileSync } from "fs";
import { resolveMessage } from "./lib/chat/resolver";
import { gatherCards } from "./lib/chat/context";
import { getLatestSessionDate } from "./lib/chat/data";
import { buildBrief } from "./lib/chat/build-context";
import { buildSystemPrompt } from "./lib/chat/system-prompt";
import { getModelDef } from "./lib/ai/models";
import { runDeepSeekChat } from "./lib/ai/deepseek-chat";
import { CHAT_TOOLS, executeTool } from "./lib/chat/tools";
import { ArtifactExtractor, type ArtifactSpec } from "./lib/chat/artifacts";
import { stripEmDashes } from "./lib/chat/sanitize";

config({ path: ".env.local" });

const OUT = "/private/tmp/claude-501/-Users-essaarshad-Downloads-psx-portfolio-app/72b1ea44-e248-4cef-89de-10b9fbec8f77/scratchpad/v4pro-results.md";
const USER_ID = "25d76e66-8126-4849-9754-855d045d7ab8"; // eessashahid@gmail.com
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const modelDef = getModelDef("deepseek-pro");

const QUESTIONS: { id: string; text: string; followUp?: string }[] = [
  { id: "E1", text: "What did I pay for my last FFC purchase and when?" },
  { id: "E2", text: "How many days until my next expected dividend, and from which holding?" },
  { id: "E3", text: "What does IMAGE actually make and sell?" },
  { id: "E4", text: "Is the PSX open tomorrow?" },
  { id: "M5", text: "Which of my holdings went ex-dividend in the last 30 days, and did I qualify?" },
  { id: "M6", text: "My SLM and my SEARL are both small positions. Which one is costing me more in opportunity terms, assuming the rest of my book kept doing what it did?" },
  { id: "M7", text: "Why did my portfolio move today, in one paragraph, biggest contributor first?", followUp: "and versus the index?" },
  { id: "M8", text: "If UBL cut its dividend by half tomorrow, what would my portfolio income look like, and what would probably happen to my capital?" },
  { id: "M9", text: "Compare the earnings quality of FCCL and GGL, not the earnings." },
  { id: "H10", text: "I need to raise PKR 200k from this portfolio by Friday with the least damage. Walk me through exactly what you'd sell and why." },
  { id: "H11", text: "You told me before that FCCL was my best value holding. Steelman the opposite case using only my data." },
  { id: "H12", text: "Here's my plan: sell all banks Monday, put everything into SYS and AIRLINK, then buy the banks back after the next rate decision. Grade my plan." },
  { id: "H13", text: "What's the single most important thing in my portfolio you'd want me to notice that I haven't asked about?" },
  { id: "H14", text: "AIRLINK's subsidiary announced an IPO recently. Does that change anything for my position?" },
];

async function runOne(
  message: string,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<{ answer: string; thinking: string; artifacts: ArtifactSpec[]; toolCalls: string[]; ms: number; cardKinds: string[] }> {
  const started = Date.now();
  const resolved = await resolveMessage(supabase, message);
  const [cards, latestSession] = await Promise.all([
    gatherCards(supabase, USER_ID, resolved),
    getLatestSessionDate(supabase),
  ]);
  const brief = await buildBrief(supabase, USER_ID, { message, resolved, cards, latestSession });
  const systemPrompt = buildSystemPrompt(modelDef, message);
  const userContext = brief
    ? `<context>\n${brief}\n</context>\n\nQuestion: ${message}`
    : `Question: ${message}\n(No pre-loaded data matched — use tools to fetch what you need.)`;

  let answer = "";
  let thinking = "";
  const artifacts: ArtifactSpec[] = [];
  const toolCalls: string[] = [];
  const extractor = new ArtifactExtractor(
    (raw) => { answer += stripEmDashes(raw); },
    (spec) => { artifacts.push(spec); }
  );

  await runDeepSeekChat({
    def: modelDef,
    system: systemPrompt,
    history,
    userContent: userContext,
    tools: CHAT_TOOLS,
    executeTool: (name, input) => {
      toolCalls.push(name);
      return executeTool(supabase, USER_ID, name, input);
    },
    onThinking: (d) => { thinking += d; },
    onText: (d) => extractor.push(d),
    onStatus: () => {},
    onReset: () => { answer = ""; extractor.reset(); },
  });
  extractor.flush();
  return { answer, thinking, artifacts, toolCalls, ms: Date.now() - started, cardKinds: cards.map((c) => c.kind) };
}

async function main() {
  writeFileSync(OUT, `# DeepSeek V4 Pro test run — ${new Date().toISOString()}\nAccount: eessashahid@gmail.com | model: ${modelDef.apiModel}\n`);

  for (const q of QUESTIONS) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${q.id} running…`);
    try {
      const r = await runOne(q.text, []);
      appendFileSync(OUT, `\n\n${"=".repeat(100)}\n## ${q.id}: ${q.text}\n[${(r.ms / 1000).toFixed(1)}s | cards: ${r.cardKinds.join(",") || "none"} | tools: ${r.toolCalls.join(",") || "none"} | artifacts: ${r.artifacts.map((a) => a.kind).join(",") || "none"}]\n\n${r.answer}\n`);
      console.log(`  done in ${(r.ms / 1000).toFixed(1)}s, ${r.answer.length} chars, tools: ${r.toolCalls.length}`);
      if (q.followUp) {
        console.log(`  ${q.id}-followup running…`);
        const f = await runOne(q.followUp, [
          { role: "user", content: q.text },
          { role: "assistant", content: r.answer },
        ]);
        appendFileSync(OUT, `\n\n---\n### ${q.id} follow-up: ${q.followUp}\n[${(f.ms / 1000).toFixed(1)}s | tools: ${f.toolCalls.join(",") || "none"} | artifacts: ${f.artifacts.map((a) => a.kind).join(",") || "none"}]\n\n${f.answer}\n`);
        console.log(`  follow-up done in ${(f.ms / 1000).toFixed(1)}s`);
      }
    } catch (err) {
      appendFileSync(OUT, `\n\n${"=".repeat(100)}\n## ${q.id}: ${q.text}\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("ALL DONE ->", OUT);
}

void main();
