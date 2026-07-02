import { GET as backfill } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron entry point for deep statement extraction (official filing PDFs parsed
 * by the DeepSeek tasks model, cached per filing). Prioritizes companies with
 * no balance sheet, so the leverage/liquidity/FCF ratios fill in first.
 * Delegates to /api/cron/backfill?task=extract.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/extract$/, "");
  url.searchParams.set("task", "extract");
  return backfill(new Request(url, { headers: request.headers }));
}
