import { GET as backfill } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron entry point for deep statement extraction (official filing PDFs parsed
 * by the DeepSeek tasks model, cached per filing). Prioritizes companies with
 * no balance sheet, so the leverage/liquidity/FCF ratios fill in first.
 * Delegates to /api/cron/backfill?task=extract.
 *
 * TEMPORARY. This route existed for months without a vercel.json entry, so the
 * only statements that ever arrived were the ones someone triggered by hand;
 * that is the direct cause of 75% of companies having no balance sheet and 78%
 * no cash flow. Phase 2 schedules it so the gap stops widening.
 *
 * It is not the destination. Every scheduled job here runs inside a 300-second
 * Vercel function, which is why each one rotates through a slice of the
 * universe and silently drops the tail. Phase 3 moves ingestion to a worker
 * with no execution limit and deletes the crons from vercel.json, this one
 * included.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/extract$/, "");
  url.searchParams.set("task", "extract");
  return backfill(new Request(url, { headers: request.headers }));
}
