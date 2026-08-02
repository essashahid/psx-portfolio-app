import { loadEnvLocal } from "../lib/load-env";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Drive the quarterly-history backfill across many companies.
 *
 * Phase 1 of the five-year programme. Phase 0 counted the work (4,958 filings
 * across the universe, 1,097 for holdings); this does it, one company at a
 * time, and is built for a run measured in hours rather than minutes.
 *
 * Each company runs as its own child process. That is deliberate and not just
 * convenient: a single malformed PDF that hangs a parser, or an out-of-memory
 * on a 30MB scanned annual report, takes down one company instead of the whole
 * run, and the driver records it and moves on. A long unattended job should
 * degrade one row at a time.
 *
 * Resumable by construction. The underlying backfill already skips filings it
 * has stored, so re-running a company is cheap and idempotent; on top of that
 * the driver keeps a progress file and will not revisit a company that
 * finished cleanly. Interrupt it whenever, restart it, and it carries on.
 *
 *   AI_DISABLED=false VISION_DISABLED=false \
 *     npx tsx scripts/backfills/run-batch-backfill.ts --holdings --years 5
 *
 *   --holdings          every ticker you hold (the recommended first batch)
 *   --tickers A,B,C     an explicit list
 *   --universe          all active companies (4,958 filings; expect many hours)
 *   --concurrency N     companies in flight at once (default 3)
 *   --dry               print the plan and the estimated filing count, run nothing
 *   --retry-failed      include companies that previously failed
 *   --limit N           first N companies only, for a trial batch
 */

const PROGRESS = "data/reference/backfill-progress.json";
const LOG_DIR = "logs/backfill";
const CHILD = "scripts/backfills/backfill-quarterly-history.ts";
// A company is a handful of PDFs, each possibly a scanned annual read by
// vision. Generous, but not unbounded: something is wrong past this.
const PER_TICKER_TIMEOUT_MS = 45 * 60_000;

const KNOWN = new Set(["holdings", "tickers", "universe", "concurrency", "dry", "years", "retry-failed", "limit"]);
for (const a of process.argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const n = a.slice(2).split("=")[0];
  if (!KNOWN.has(n)) {
    console.error(`unknown flag --${n}. Known: ${[...KNOWN].map((f) => `--${f}`).join(", ")}`);
    process.exit(1);
  }
}
const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0) return process.argv[i + 1] ?? null;
  const inline = process.argv.find((a) => a.startsWith(`--${n}=`));
  return inline ? inline.split("=").slice(1).join("=") : null;
};

const YEARS = Number(arg("years")) || 5;
const CONCURRENCY = Math.max(1, Number(arg("concurrency")) || 3);
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const DRY = process.argv.includes("--dry");
const RETRY_FAILED = process.argv.includes("--retry-failed");
const HOLDINGS = process.argv.includes("--holdings");
const UNIVERSE = process.argv.includes("--universe");
const ONLY = new Set((arg("tickers") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));

type Result = {
  ticker: string;
  status: "ok" | "failed" | "timeout";
  startedAt: string;
  finishedAt: string;
  seconds: number;
  exitCode: number | null;
  saved: number | null;
  quartersWritten: number | null;
  bleedRepaired: number | null;
  crossChecksOff: number | null;
  error?: string;
};

const loadProgress = (): Record<string, Result> => {
  try {
    return JSON.parse(readFileSync(PROGRESS, "utf8")).results ?? {};
  } catch {
    return {};
  }
};

const saveProgress = (results: Record<string, Result>) => {
  const v = Object.values(results);
  writeFileSync(
    PROGRESS,
    JSON.stringify(
      {
        _note:
          "Phase 1 progress. A company listed 'ok' is not revisited on a re-run. Delete an entry, or pass --retry-failed, to redo one. crossChecksOff counts quarters where the value derived from the cumulative chain disagreed by more than 2% with a quarter PSX reports directly: those are the rows worth a human look.",
        _asOf: new Date().toISOString(),
        summary: {
          companies: v.length,
          ok: v.filter((r) => r.status === "ok").length,
          failed: v.filter((r) => r.status === "failed").length,
          timeout: v.filter((r) => r.status === "timeout").length,
          statementsSaved: v.reduce((n, r) => n + (r.saved ?? 0), 0),
          quartersDerived: v.reduce((n, r) => n + (r.quartersWritten ?? 0), 0),
          bleedRepaired: v.reduce((n, r) => n + (r.bleedRepaired ?? 0), 0),
          crossChecksNeedingReview: v.reduce((n, r) => n + (r.crossChecksOff ?? 0), 0),
        },
        results,
      },
      null,
      2
    ) + "\n"
  );
};

/**
 * Pull the numbers back out of the child's own output rather than having it
 * report them separately. The child prints for a human reading one company;
 * this reads the same lines so the driver's summary cannot drift from what
 * actually happened.
 */
function parseChildLog(text: string) {
  const saved = [...text.matchAll(/^\s*saved (\d+), processed/gm)].reduce((n, m) => n + Number(m[1]), 0);
  const quarters = Number(text.match(/^(\d+) quarter\(s\) to write:/m)?.[1] ?? 0);
  const bleed = Number(text.match(/^Comparative bleed detected \((\d+) row/m)?.[1] ?? 0);
  const crossOff = (text.match(/<-- CHECK/g) ?? []).length;
  return { saved, quarters, bleed, crossOff };
}

async function runTicker(ticker: string): Promise<Result> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const logPath = join(LOG_DIR, `${ticker}.log`);

  return new Promise<Result>((resolve) => {
    const child = spawn("npx", ["tsx", CHILD, ticker, "--years", String(YEARS)], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, PER_TICKER_TIMEOUT_MS);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      writeFileSync(logPath, out);
      const p = parseChildLog(out);
      const timedOut = signal === "SIGKILL";
      resolve({
        ticker,
        status: timedOut ? "timeout" : code === 0 ? "ok" : "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        seconds: Math.round((Date.now() - t0) / 1000),
        exitCode: code,
        saved: p.saved,
        quartersWritten: p.quarters,
        bleedRepaired: p.bleed,
        crossChecksOff: p.crossOff,
        ...(timedOut
          ? { error: `killed after ${PER_TICKER_TIMEOUT_MS / 60000} minutes` }
          : code !== 0
            ? { error: out.trim().split("\n").slice(-3).join(" | ").slice(0, 300) }
            : {}),
      });
    });
  });
}

async function main() {
  loadEnvLocal();
  mkdirSync(LOG_DIR, { recursive: true });

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const db = createAdminClient();

  let tickers: string[];
  if (ONLY.size) tickers = [...ONLY].sort();
  else if (HOLDINGS) {
    const { data } = await db.from("holdings").select("ticker").gt("quantity", 0);
    tickers = [...new Set((data ?? []).map((r) => String(r.ticker).toUpperCase()))].sort();
  } else if (UNIVERSE) {
    tickers = [...new Set(await activeUniverseTickers(db, "companies"))].sort();
  } else {
    console.error("choose a scope: --holdings, --universe, or --tickers A,B,C");
    process.exit(1);
  }

  const results = loadProgress();
  const skip = (t: string) => {
    const r = results[t];
    if (!r) return false;
    if (r.status === "ok") return true;
    return !RETRY_FAILED;
  };
  const todo = tickers.filter((t) => !skip(t)).slice(0, LIMIT);

  // What Phase 0 says this batch costs, so the number is on screen before the
  // spend starts rather than discovered from a bill afterwards.
  let plannedFilings: number | null = null;
  if (existsSync("data/reference/filing-archive-inventory.json")) {
    const inv = JSON.parse(readFileSync("data/reference/filing-archive-inventory.json", "utf8")).entries ?? {};
    plannedFilings = todo.reduce((n: number, t: string) => {
      const slots = Object.values((inv[t]?.periods ?? {}) as Record<string, { filed: boolean; stored: boolean }>);
      return n + slots.filter((s) => s.filed && !s.stored).length;
    }, 0);
  }

  console.log(
    `${tickers.length} companies in scope, ${todo.length} to run ` +
      `(${tickers.length - todo.length} already done), concurrency ${CONCURRENCY}, ${YEARS}-year window`
  );
  if (plannedFilings !== null) console.log(`Phase 0 says this batch is about ${plannedFilings} filings to extract.\n`);

  if (DRY) {
    console.log(todo.join(" "));
    console.log("\n--dry: nothing run.");
    return;
  }
  if (!todo.length) {
    console.log("Nothing to do.");
    return;
  }

  const queue = [...todo];
  let done = 0;
  const t0 = Date.now();

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const ticker = queue.shift();
        if (!ticker) return;
        const r = await runTicker(ticker);
        results[ticker] = r;
        done++;
        saveProgress(results);
        const rate = (Date.now() - t0) / done;
        const etaMin = Math.round((rate * (todo.length - done)) / 60000);
        console.log(
          `[${String(done).padStart(3)}/${todo.length}] ${ticker.padEnd(8)} ${r.status.padEnd(7)} ` +
            `${String(r.seconds).padStart(4)}s  saved=${String(r.saved ?? 0).padStart(3)} ` +
            `quarters=${String(r.quartersWritten ?? 0).padStart(2)} ` +
            `bleed=${String(r.bleedRepaired ?? 0).padStart(2)} ` +
            `check=${String(r.crossChecksOff ?? 0).padStart(2)}  eta ${etaMin}m` +
            (r.error ? `\n        ${r.error.slice(0, 160)}` : "")
        );
      }
    })
  );

  const v = Object.values(results);
  console.log(`\n${"=".repeat(60)}\nPHASE 1 BATCH COMPLETE\n${"=".repeat(60)}`);
  console.log(`companies run            ${v.length}`);
  console.log(`  ok                     ${v.filter((r) => r.status === "ok").length}`);
  console.log(`  failed                 ${v.filter((r) => r.status === "failed").length}`);
  console.log(`  timed out              ${v.filter((r) => r.status === "timeout").length}`);
  console.log(`statements saved         ${v.reduce((n, r) => n + (r.saved ?? 0), 0)}`);
  console.log(`quarters derived         ${v.reduce((n, r) => n + (r.quartersWritten ?? 0), 0)}`);
  console.log(`comparative bleed fixed  ${v.reduce((n, r) => n + (r.bleedRepaired ?? 0), 0)}`);
  console.log(`cross-checks to review   ${v.reduce((n, r) => n + (r.crossChecksOff ?? 0), 0)}`);
  console.log(`\nprogress: ${PROGRESS}   per-company logs: ${LOG_DIR}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
