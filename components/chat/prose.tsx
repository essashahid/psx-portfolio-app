"use client";

import { Fragment, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArtifactRenderer } from "@/components/chat/artifacts";
import { splitTablesFromMarkdown } from "@/lib/chat/md-table";
import { cn } from "@/lib/utils";

/**
 * Assistant prose rendering: the house markdown components (moved verbatim
 * from chat.tsx), plus the Tier-1 visual upgrades that apply to every answer,
 * old and new:
 *
 *  - Signed figures get semantic color (+18% green, -12% red) and "up/down X%"
 *    phrases inherit their direction. Deterministic, text-node only, so a
 *    ticker like KSE-100, T+1, or a date like 2026-07-03 is never touched.
 *  - The opening paragraph renders as the lead: slightly larger with a
 *    hairline underneath, so the verdict reads as a verdict.
 *  - Markdown tables upgrade into the styled table artifact (sticky header,
 *    right-aligned numerics, tone color) once the message finishes streaming,
 *    which retroactively upgrades every saved answer too.
 */

// ── Semantic number color ────────────────────────────────────────────────────

// A signed figure not glued to a word/number (so T+1, KSE-100, 2026-07-03 are
// safe): +18%, -12.4%, +7 pts, -240bps, -16,000, +PKR 12k.
const SIGNED_TOKEN = /(?<![\w.+-])([+-](?:PKR\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|pts?|bps|[kKmM]|bn)?)(?![\w.%])/g;
// "up 27%" / "down 12 pts" style phrases where the direction word carries the sign.
const DIRECTIONAL = /\b(up|rose|gained|jumped|surged|down|fell|dropped|declined|slid|lost)\s(\d[\d,]*(?:\.\d+)?\s?(?:%|pts?|bps))/gi;
const NEGATIVE_WORDS = new Set(["down", "fell", "dropped", "declined", "slid", "lost"]);

const POS = "text-emerald-600 tabular-nums";
const NEG = "text-red-600 tabular-nums";

function colorizeString(text: string, keyBase: number): ReactNode[] {
  const marks: { start: number; end: number; cls: string; text: string }[] = [];
  for (const m of text.matchAll(SIGNED_TOKEN)) {
    marks.push({ start: m.index!, end: m.index! + m[1].length, cls: m[1].startsWith("+") ? POS : NEG, text: m[1] });
  }
  for (const m of text.matchAll(DIRECTIONAL)) {
    const numStart = m.index! + m[1].length + 1;
    marks.push({
      start: numStart,
      end: numStart + m[2].length,
      cls: NEGATIVE_WORDS.has(m[1].toLowerCase()) ? NEG : POS,
      text: m[2],
    });
  }
  if (marks.length === 0) return [text];
  marks.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue; // overlapping match, first wins
    if (mark.start > cursor) out.push(text.slice(cursor, mark.start));
    out.push(
      <span key={`c${keyBase}-${mark.start}`} className={mark.cls}>
        {mark.text}
      </span>
    );
    cursor = mark.end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/** Color signed figures inside the direct string children of an element. */
function colorize(children: ReactNode): ReactNode {
  if (typeof children === "string") return colorizeString(children, 0);
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === "string" ? <Fragment key={`s${i}`}>{colorizeString(child, i)}</Fragment> : child
    );
  }
  return children;
}

// ── Markdown components (house style, verbatim, + colorized text nodes) ─────

export const CHAT_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold tracking-editorial first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mb-3 mt-6 text-lg font-semibold tracking-editorial first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2.5 mt-5 text-base font-semibold tracking-editorial first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-4 text-sm font-semibold text-foreground">{children}</h4>,
  p: ({ children }) => <p className="my-3 leading-7 text-foreground/85">{colorize(children)}</p>,
  ul: ({ children }) => <ul className="my-3 space-y-2 pl-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-3 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="leading-7 text-foreground/85 [&>p]:my-0">{colorize(children)}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{colorize(children)}</strong>,
  em: ({ children }) => <em className="text-foreground/75">{colorize(children)}</em>,
  hr: () => <div className="my-6 h-px bg-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-md border-l-2 border-emerald-500 bg-emerald-50/50 px-3 py-2 text-sm text-foreground/80">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline-offset-4 hover:underline">
      {children}
    </a>
  ),
  code: ({ children, className, ...props }) => (
    <code className={cn("rounded bg-muted px-1.5 py-0.5 text-[0.9em] text-foreground", className)} {...props}>
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }) => <tr className="transition-colors hover:bg-muted/30">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/90 tabular-nums">{colorize(children)}</td>,
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
};

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={CHAT_MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}

// ── Lead paragraph split ─────────────────────────────────────────────────────

/** First plain paragraph (not a heading/table/list/code) + the rest. */
function splitLead(content: string): { lead: string | null; rest: string } {
  const trimmed = content.trimStart();
  if (/^[#|\-*>`\d]/.test(trimmed)) return { lead: null, rest: content };
  const idx = trimmed.indexOf("\n\n");
  const lead = idx === -1 ? trimmed : trimmed.slice(0, idx);
  if (lead.length < 60) return { lead: null, rest: content }; // one-liners don't need the treatment
  return { lead, rest: idx === -1 ? "" : trimmed.slice(idx + 2) };
}

// ── Public component ─────────────────────────────────────────────────────────

export function AssistantProse({
  content,
  lead = false,
  upgradeTables = true,
}: {
  content: string;
  /** Style the opening paragraph as the answer's verdict. */
  lead?: boolean;
  /** Convert markdown tables into styled table artifacts (skip mid-stream). */
  upgradeTables?: boolean;
}) {
  const segments = upgradeTables ? splitTablesFromMarkdown(content) : [{ type: "text" as const, content }];
  const leadIndex = lead ? segments.findIndex((s) => s.type === "text" && s.content.trim()) : -1;

  return (
    <div className="text-[15px]">
      {segments.map((seg, i) => {
        if (seg.type === "table" && seg.spec) {
          return <ArtifactRenderer key={i} spec={seg.spec} />;
        }
        if (i === leadIndex) {
          const { lead: leadText, rest } = splitLead(seg.content);
          if (leadText) {
            return (
              <Fragment key={i}>
                <div className="mb-4 border-b border-border/60 pb-4 text-[15.5px] font-medium leading-7 [&_p]:my-0">
                  <Markdown content={leadText} />
                </div>
                {rest.trim() && <Markdown content={rest} />}
              </Fragment>
            );
          }
        }
        return <Markdown key={i} content={seg.content} />;
      })}
    </div>
  );
}
