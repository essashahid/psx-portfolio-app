import { createClient } from "@supabase/supabase-js";

// Backfill the persisted news cluster store from the existing global article
// rows. Also seeds impact_tickers on holding-scope articles that pre-date the
// ticker-aware write path, so their clusters carry a ticker.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-news-clusters.mjs

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // 1. Seed impact_tickers on portfolio-scope globals missing it, using the
  //    per-user relevance rows (any user's mapping is fine for the shared ticker).
  const { data: rel } = await supabase
    .from("news_article_relevance")
    .select("article_id, ticker")
    .not("ticker", "is", null);
  const tickerByArticle = new Map();
  for (const r of rel ?? []) {
    if (!tickerByArticle.has(r.article_id)) tickerByArticle.set(r.article_id, r.ticker);
  }

  const { data: globals } = await supabase
    .from("global_news_articles")
    .select("id, impact_tickers, scope")
    .eq("scope", "portfolio");
  let patched = 0;
  for (const g of globals ?? []) {
    const has = Array.isArray(g.impact_tickers) && g.impact_tickers.length > 0;
    const ticker = tickerByArticle.get(g.id);
    if (!has && ticker) {
      await supabase.from("global_news_articles").update({ impact_tickers: [ticker] }).eq("id", g.id);
      patched++;
    }
  }
  console.log(`Seeded impact_tickers on ${patched} portfolio articles.`);

  // 2. Recompute all clusters over a wide window.
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("sync_news_clusters", { p_since: since });
  if (error) {
    console.error("sync_news_clusters failed:", error.message);
    process.exit(1);
  }
  console.log(`Synced ${data} clusters.`);
}

run();
