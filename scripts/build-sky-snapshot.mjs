#!/usr/bin/env node
/**
 * Build-time whole-sky snapshot (GROUP=active, ~16k element sets).
 *
 * Why it exists: CelesTrak answered Vercel's serverless functions with HTTP
 * 500 for the full-catalog query while answering other networks normally,
 * which left the globe's sky, the atlas and close-approach screening with
 * nothing to show. The deployment now carries its own copy, so those pages
 * work on a cold instance whatever the provider says; the server still
 * refreshes from CelesTrak when it can and labels the copy's age honestly.
 *
 * Policy (same spirit as build-search-index.mjs):
 *  - reuse a snapshot younger than 6 h (provider politeness; the provider
 *    updates GP data a few times a day) unless SKY_SNAPSHOT_FORCE_REFRESH=1;
 *  - replace it only with a complete, validated feed (≥ 5,000 objects -
 *    smaller answers are truncated feeds, not the sky);
 *  - never fail the build and never clobber a good snapshot on provider
 *    trouble. With no snapshot at all, nothing is written and the app keeps
 *    its on-demand provider path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const URL_ACTIVE = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
const FETCH_TIMEOUT_MS = 90_000;
const MIN_OBJECTS = 5_000;
const REUSE_MS = 6 * 60 * 60 * 1000;

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = resolve(here, "../data/sky-catalog.snapshot.json");

function readExisting() {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    const ok = typeof parsed.generatedAt === "string" && Array.isArray(parsed.entries) && parsed.entries.length >= MIN_OBJECTS;
    return ok ? parsed : null;
  } catch {
    return null;
  }
}

/** Name line + the two element lines; rows that don't match the documented shape are skipped. */
function parse(text) {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const entries = [];
  for (let k = 0; k < lines.length; k++) {
    const l1 = lines[k] ?? "";
    if (!/^1 [ \d]{4}\d[UCS ] /.test(l1)) continue;
    const l2 = lines[k + 1] ?? "";
    if (!/^2 [ \d]{4}\d /.test(l2)) continue;
    const name = k > 0 && !/^[12] /.test(lines[k - 1] ?? "") ? (lines[k - 1] ?? "").trim() : "";
    // Same id form as the rest of the app (src/domain/orbit/tle.ts): five columns, leading zeros kept.
    const i = l1.slice(2, 7).trim();
    if (i && name) entries.push({ i, n: name, l1: l1.trim(), l2: l2.trim() });
    k += 1;
  }
  return entries;
}

async function main() {
  const existing = readExisting();
  const age = existing ? Date.now() - Date.parse(existing.generatedAt) : Infinity;
  if (existing && age < REUSE_MS && !process.env.SKY_SNAPSHOT_FORCE_REFRESH) {
    console.warn(`[sky-snapshot] ${existing.count} objects, ${Math.round(age / 60_000)} min old — reusing`);
    return;
  }
  try {
    const response = await fetch(URL_ACTIVE, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Orbital-Insight/0.1 (educational; one snapshot per build)", Accept: "text/plain" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const entries = parse(await response.text());
    if (entries.length < MIN_OBJECTS) throw new Error(`only ${entries.length} objects — truncated feed refused`);
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    const payload = { generatedAt: new Date().toISOString(), source: URL_ACTIVE, count: entries.length, entries };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(payload), "utf8");
    console.warn(`[sky-snapshot] wrote ${entries.length} objects -> ${SNAPSHOT_PATH}`);
  } catch (error) {
    const kept = existing
      ? `keeping the existing ${existing.count}-object snapshot from ${existing.generatedAt}`
      : "no snapshot available — the app falls back to its on-demand provider path";
    console.warn(`[sky-snapshot] refresh failed (${error?.message ?? error}); ${kept}`);
  }
}

await main();
