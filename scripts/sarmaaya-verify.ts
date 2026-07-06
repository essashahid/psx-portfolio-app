import { loadEnvLocal } from "./load-env";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Sarmaaya validation layer.
 *
 * Sarmaaya's "Company Snapshot" (EPS, P/E, P/B, net margin, dividend yield,
 * shares, market cap) is client-rendered and sits behind Cloudflare, so it
 * cannot be fetched server-side. Instead we paste the snapshot HTML into a file
 * and parse it here into data/sarmaaya-snapshots.json, then diff that reference
 * against our own ratio engine to catch stale/wrong data.
 *
 *   # add or refresh one ticker from pasted snapshot HTML
 *   npx tsx scripts/sarmaaya-verify.ts add CCM /tmp/ccm.html
 *
 *   # verify every stored snapshot against our company_ratios
 *   npx tsx scripts/sarmaaya-verify.ts
 *
 * A gap is only a real problem when basis matches and the name is not a
 * micro-cap: consolidated-basis names (Sarmaaya reports the group, we report
 * unconsolidated to match PSX) and companies whose earnings cross zero will
 * diverge legitimately and are labelled, not flagged.
 */

const STORE = resolve(__dirname, "../data/sarmaaya-snapshots.json");

const LABELS: Record<string, string> = {
  "Price close": "priceClose",
  "52 week high price": "high52",
  "52 week low price": "low52",
  "Market cap": "marketCap",
  "Shares outstanding": "shares",
  "Dividend Yield (%)": "dividendYield",
  "Earnings Per Share": "eps",
  "Net Income Margin (%)": "netMargin",
  "Price to Book Value": "pb",
  "Price to Earnings": "pe",
  "PEG Ratio": "peg",
};

function toNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([KMBT])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] ?? "").toUpperCase()] ?? 1;
  return n * mult;
}

/** Extract snapshot fields from the pasted Company Snapshot HTML div. */
function parseSnapshot(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re =
    /capitalize"[^>]*>([^<]+)<\/span>\s*<span class="font-medium"[^>]*>([^<]*)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const field = LABELS[m[1].trim()];
    if (!field) continue;
    const val = toNumber(m[2]);
    if (val !== null) out[field] = val;
  }
  return out;
}

function readStore(): { snapshots: Record<string, Record<string, number | string>> } & Record<string, unknown> {
  return JSON.parse(readFileSync(STORE, "utf8"));
}

async function addFromHtml(ticker: string, file: string) {
  const html = readFileSync(resolve(file), "utf8");
  const parsed = parseSnapshot(html);
  if (Object.keys(parsed).length === 0) {
    console.error("No snapshot fields found — is this the Company Snapshot div?");
    process.exit(1);
  }
  const store = readStore();
  store.snapshots[ticker.toUpperCase()] = { ...(store.snapshots[ticker.toUpperCase()] ?? {}), ...parsed };
  store._asOf = new Date().toISOString().slice(0, 10);
  writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
  console.log(`${ticker.toUpperCase()} stored:`, JSON.stringify(parsed));
}

async function verify() {
  loadEnvLocal();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { isVerified } = await import("@/lib/engine/verified");
  const db = createAdminClient();
  const store = readStore();
  const already = Object.keys(store.snapshots).filter((t) => isVerified(t));
  if (already.length)
    console.log(`(${already.length} already in the verified registry: ${already.join(", ")})\n`);
  // Sarmaaya field -> our ratio name
  const MAP: [string, string][] = [
    ["pe", "P/E"],
    ["eps", "EPS (TTM)"],
    ["pb", "P/B"],
    ["netMargin", "Net margin"],
    ["dividendYield", "Dividend yield (TTM)"],
  ];
  const tickers = Object.keys(store.snapshots).sort();
  console.log(`Verifying ${tickers.length} snapshots against our ratios (⚠ = >8% gap on matching basis)\n`);
  console.log("TKR      metric        ours     sarmaaya   gap%   note");
  for (const t of tickers) {
    const snap = store.snapshots[t];
    const basis = snap.basis as string | undefined;
    const { data: rat } = await db.from("company_ratios").select("ratio_name, ratio_value").eq("ticker", t);
    const get = (n: string) => {
      const r = (rat ?? []).find((x) => x.ratio_name === n);
      return r?.ratio_value != null ? Number(r.ratio_value) : null;
    };
    for (const [sf, rn] of MAP) {
      const sv = snap[sf];
      if (typeof sv !== "number") continue;
      const ov = get(rn);
      if (ov == null) continue;
      const gap = sv !== 0 ? (ov / sv - 1) * 100 : null;
      const flag =
        gap != null && Math.abs(gap) > 8
          ? basis === "consolidated"
            ? "ok (basis: consolidated vs unconsolidated)"
            : Number(snap.marketCap) < 3e9
              ? "ok (micro-cap noise)"
              : "⚠ REVIEW"
          : "ok";
      if (flag === "ok" && Math.abs(gap ?? 0) <= 8) continue; // only print notable rows
      console.log(
        `${t.padEnd(8)} ${rn.padEnd(13)} ${String(ov.toFixed(2)).padStart(7)} ${String(sv.toFixed(2)).padStart(9)}  ${(gap ?? 0).toFixed(1).padStart(6)}  ${flag}`
      );
    }
  }
  console.log("\n(rows within 8% are omitted; they match)");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "add") {
    if (rest.length < 2) {
      console.error("usage: sarmaaya-verify.ts add <TICKER> <html-file>");
      process.exit(1);
    }
    await addFromHtml(rest[0], rest[1]);
  } else {
    await verify();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
