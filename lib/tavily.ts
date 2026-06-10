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
  const queries = [`${h.ticker} Pakistan Stock Exchange latest news`];
  if (h.company_name) {
    queries.push(`${h.company_name} PSX latest news`);
    queries.push(`${h.company_name} financial result dividend announcement`);
  }
  return queries;
}
