// Guards the one rule that makes @psx/shared work: it is compiled by both Next
// and Metro, so it must not reach for anything that only exists on one of them.
// A violation here does not fail the web build, it fails the mobile bundler at
// runtime with a confusing stack, which is why this runs in CI-style checks.
//
// Run: npm run check:shared

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../packages/shared/src/", import.meta.url).pathname;

const BANNED = [
  { pattern: /from\s+["']react["']/, why: "react is not available in shared code" },
  { pattern: /from\s+["']react-dom/, why: "react-dom is web only" },
  { pattern: /from\s+["']react-native/, why: "react-native is mobile only" },
  { pattern: /from\s+["']next\//, why: "next/* is web only" },
  { pattern: /from\s+["']@supabase\/ssr["']/, why: "@supabase/ssr is cookie based and web only" },
  { pattern: /from\s+["'](clsx|tailwind-merge)["']/, why: "Tailwind helpers are web only" },
  { pattern: /\bprocess\.env\b/, why: "shared code must take config as arguments, not read env" },
  { pattern: /\b(document|window|localStorage)\s*\./, why: "no DOM access in shared code" },
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

const violations = [];
for (const file of walk(ROOT)) {
  const source = readFileSync(file, "utf8");
  source.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("//")) return;
    for (const { pattern, why } of BANNED) {
      if (pattern.test(line)) {
        violations.push(`${relative(process.cwd(), file)}:${i + 1}  ${why}\n    ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`@psx/shared is not platform neutral:\n\n${violations.join("\n")}\n`);
  process.exit(1);
}
console.log("@psx/shared is platform neutral.");
