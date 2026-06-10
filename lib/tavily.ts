export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export function tavilyConfigured(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

export async function tavilySearch(
  query: string,
  opts: { days?: number; maxResults?: number } = {}
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not configured. Add it in .env.local.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      topic: "news",
      search_depth: "basic",
      max_results: opts.maxResults ?? 5,
      days: opts.days ?? 7,
      include_answer: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Tavily search failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.results ?? []) as TavilyResult[];
}

/** Standard query set for one holding (kept small to control API usage). */
export function holdingQueries(h: {
  ticker: string;
  company_name: string | null;
  sector: string | null;
}): string[] {
  const queries = new Set<string>();
  const companyName = h.company_name?.trim();

  if (companyName) {
    const company = `"${companyName}"`;
    queries.add(`${company} ${h.ticker} PSX Pakistan Stock Exchange news`);
    queries.add(`${company} financial result dividend announcement Pakistan`);

    const shortName = companyName
      .replace(/\b(limited|ltd\.?|company|co\.?)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (shortName && shortName.toLowerCase() !== companyName.toLowerCase()) {
      queries.add(`"${shortName}" ${h.ticker} PSX latest news`);
    }
  } else {
    queries.add(`${h.ticker} PSX Pakistan Stock Exchange company news`);
  }

  return [...queries].slice(0, 3);
}
