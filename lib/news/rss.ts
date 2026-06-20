/**
 * Tiny dependency-free RSS / Atom reader. The Pakistani business wires
 * (Business Recorder, Dawn, Tribune) and Google News all publish clean RSS,
 * so a regex-based item extractor is plenty — no XML library needed.
 */

const REQUEST_TIMEOUT_MS = 15_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
};

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  /** From <source> (Google News) or the feed's own title — best-effort outlet name. */
  source: string | null;
}

export async function fetchRssFeed(url: string): Promise<RssItem[]> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml);
}

export function parseRss(xml: string): RssItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks
    .map((block) => {
      const title = decodeEntities(stripTags(pick(block, "title")));
      const link = decodeEntities(pickLink(block));
      if (!title || !link) return null;
      const description = decodeEntities(stripTags(pick(block, "description") || pick(block, "summary") || pick(block, "content")));
      const pubDate = pick(block, "pubDate") || pick(block, "published") || pick(block, "updated") || pick(block, "dc:date");
      const source = decodeEntities(stripTags(pick(block, "source"))) || null;
      return {
        title,
        link,
        description,
        pubDate: normalizeDate(pubDate),
        source,
      } satisfies RssItem;
    })
    .filter((item): item is RssItem => !!item);
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? unwrapCdata(m[1]).trim() : "";
}

/** RSS uses <link>url</link>; Atom uses <link href="url" />. Google News uses both. */
function pickLink(block: string): string {
  const text = pick(block, "link");
  if (text) return text;
  const href = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return href ? href[1].trim() : "";
}

function unwrapCdata(value: string): string {
  const m = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : value;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normalizeDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
