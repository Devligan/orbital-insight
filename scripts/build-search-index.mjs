#!/usr/bin/env node
/**
 * Build-time catalog snapshot.
 *
 * Fetches the same bounded, curated groups the server serves (see
 * CATALOG_GROUPS in src/server/satellites.ts) and writes a static catalog
 * file that the application seeds from at startup. This is why search and
 * detail for curated objects answer instantly on a cold server instance:
 * the data ships with the deployment instead of being fetched one request
 * after another from the provider.
 *
 * Data provenance: CelesTrak GP element sets (public, free, attributed on
 * /methodology). This is the same client contract as src/integrations/
 * celestrak — GROUP=<name>&FORMAT=tle with polite spacing — reimplemented
 * inline because build scripts cannot import TypeScript sources.
 *
 * Failure policy: the build must never depend on the provider. Any fetch
 * problem results in an (empty or partial) index plus a marker, and the
 * running application falls back to its normal on-demand provider path.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GP_URL = "https://celestrak.org/NORAD/elements/gp.php";
const GROUPS = ["stations", "gps-ops", "galileo", "science"];
const MIN_REQUEST_INTERVAL_MS = 2_000;
const FETCH_TIMEOUT_MS = 15_000;

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(here, "../src/server/search-index.static.json");

function writeOut(payload) {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Minimal, strict TLE-triplet parser (same contract as the app client). */
function parseTriplets(text, group) {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line1 = lines[i] ?? "";
    // Documented epoch-line shape: '1 NNNNNU ' (classified-letter set).
    if (!/^1 \d{5}[UCSO] /.test(line1)) continue;
    const line2 = lines[i + 1] ?? "";
    if (!/^2 \d{5} /.test(line2)) continue;
    const prev = i > 0 ? (lines[i - 1] ?? "") : "";
    const isName = prev && !/^[12] \d/.test(prev);
    const name = isName ? prev.trim() : "";
    const satelliteNumber = line1.slice(2, 7).trim();
    if (!satelliteNumber || !name) continue;
    entries.push({ satelliteNumber, name, group, tleLine1: line1.trim(), tleLine2: line2.trim() });
    i += 1; // consumed the epoch line
  }
  return entries;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchGroup(group) {
  const url = new URL(GP_URL);
  url.searchParams.set("GROUP", group);
  url.searchParams.set("FORMAT", "tle");
  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Orbital-Insight/0.1 (educational analysis tool; cached, bounded)",
      Accept: "text/plain",
    },
  });
  if (response.status === 404) return []; // "no objects matched" — honest empty
  if (!response.ok) throw new Error(`HTTP ${response.status} for group ${group}`);
  const text = await response.text();
  if (!text.trim()) return [];
  return parseTriplets(text, group);
}

async function main() {
  const entries = [];
  const failures = [];
  for (const group of GROUPS) {
    try {
      const got = await fetchGroup(group);
      entries.push(...got);
      console.log(`[search-index] ${group}: ${got.length} entries`);
    } catch (error) {
      failures.push(group);
      console.warn(`[search-index] group ${group} failed (${error?.message ?? error}) — continuing`);
    }
    await sleep(MIN_REQUEST_INTERVAL_MS); // politeness contract
  }

  const unique = new Map(entries.map((e) => [e.satelliteNumber, e]));
  writeOut({
    generatedAt: new Date().toISOString(),
    gaps: failures.join(",") || null,
    entries: [...unique.values()].sort((a, b) => a.name.localeCompare(b.name)),
  });

  const readback = readFileSync(OUT_PATH, "utf8");
  if (!JSON.parse(readback).entries) throw new Error("index file malformed after write");
  console.log(`[search-index] wrote ${unique.size} entries -> ${OUT_PATH}`);
  if (failures.length > 0) {
    console.warn(`[search-index] partial index: failed groups = ${failures.join(", ")} (app falls back to on-demand provider path)`);
  }
}

main().catch((error) => {
  console.error(`[search-index] aborted: ${error?.message ?? error}`);
  // Never fail the build on provider trouble.
  writeOut({ generatedAt: new Date().toISOString(), gaps: "all", entries: [] });
});
