#!/usr/bin/env node
/**
 * Bundle budget gate (CI).
 *
 * Sums the gzipped JavaScript each page loads up front (layout + page chunks
 * from Next's app-build-manifest) and fails when a page exceeds its budget.
 * The point is the home page: the 1.3 MB Cesium globe must stay a lazy chunk
 * that mounts only when the globe scrolls into view — an accidental static
 * import would silently put it on every visitor's critical path.
 *
 * Budgets are gzip kB, a little above today's measured size so ordinary
 * changes pass and a regression of tens of kB does not.
 */

import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const BUDGETS_KB = {
  "/page": 150,
  "/passes/page": 150,
  "/satellites/[satelliteNumber]/page": 150,
  "/atlas/page": 170,
  "/compare/page": 260, // Recharts
  default: 160,
};

const manifestPath = path.join(distDir, "app-build-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`[bundle-budget] ${manifestPath} not found — run the production build first`);
  process.exit(1);
}
const { pages } = JSON.parse(readFileSync(manifestPath, "utf8"));
const layoutFiles = pages["/layout"] ?? [];
const sizeCache = new Map();

function gzipKb(file) {
  if (!sizeCache.has(file)) {
    const bytes = readFileSync(path.join(distDir, file));
    sizeCache.set(file, gzipSync(bytes, { level: 9 }).length / 1024);
  }
  return sizeCache.get(file);
}

let failed = false;
const rows = [];
for (const [route, files] of Object.entries(pages)) {
  if (!route.endsWith("/page")) continue;
  const js = [...new Set([...layoutFiles, ...files])].filter((f) => f.endsWith(".js"));
  const total = js.reduce((sum, f) => sum + gzipKb(f), 0);
  const budget = BUDGETS_KB[route] ?? BUDGETS_KB.default;
  const ok = total <= budget;
  if (!ok) failed = true;
  rows.push(`${ok ? "ok  " : "FAIL"} ${route.padEnd(40)} ${total.toFixed(1).padStart(6)} kB / ${budget} kB`);
}

console.log(["[bundle-budget] first-load JS per page (gzip):", ...rows].join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**Bundle budget**\n\n\`\`\`\n${rows.join("\n")}\n\`\`\`\n`);
}
if (failed) {
  console.error("[bundle-budget] over budget — a heavy module probably reached the initial bundle");
  process.exit(1);
}
