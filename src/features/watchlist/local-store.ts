"use client";

/**
 * Anonymous demo watchlist, persisted in the browser's localStorage.
 *
 * This is *client-side preference data*, clearly presented as local to the
 * browser in the UI. Authenticated server persistence (Supabase, RLS) exists
 * separately; the UI always shows which one is active.
 */

import { useCallback, useSyncExternalStore } from "react";
import { canonicalCatalogNumber } from "@/contracts/catalog-number";

export interface WatchlistItem {
  satelliteNumber: string;
  name: string;
  /** ISO time it was saved; null when the stored value isn't a real time. */
  addedAt: string | null;
}

export const WATCHLIST_STORAGE_KEY = "orbital-insight.watchlist";
const WATCHLIST_EVENT = "orbital-insight:watchlist-changed";
const EMPTY: WatchlistItem[] = [];
const MAX_NAME_LENGTH = 120;
/** Generous for a hand-kept list; a bigger stored array is cut, not rendered. */
const MAX_ITEMS = 500;

/** Parse snapshot cache: JSON parse produces a stable reference per raw value. */
let snapshot: { raw: string | null; items: WatchlistItem[] } = { raw: null, items: EMPTY };

/**
 * localStorage is input like any other: anyone (or any extension) can edit
 * it. Each entry must name a real catalog number, because it becomes a link
 * (/satellites/<id>) and a /passes request. Names are capped, times must
 * parse, and a repeated number keeps its first entry, since numbers are
 * React keys.
 */
export function parseWatchlist(raw: string | null): WatchlistItem[] {
  if (raw === null) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY; // Corrupt local data behaves as empty, never crashes the page.
  }
  if (!Array.isArray(parsed)) return EMPTY;
  const items: WatchlistItem[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.slice(0, MAX_ITEMS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { satelliteNumber: stored, name, addedAt } = entry as Record<string, unknown>;
    const satelliteNumber = typeof stored === "string" ? canonicalCatalogNumber(stored) : null;
    if (satelliteNumber === null) continue;
    if (seen.has(satelliteNumber)) continue;
    seen.add(satelliteNumber);
    const shownName = typeof name === "string" ? name.trim().slice(0, MAX_NAME_LENGTH) : "";
    items.push({
      satelliteNumber,
      name: shownName || `NORAD ${satelliteNumber}`,
      addedAt: typeof addedAt === "string" && Number.isFinite(Date.parse(addedAt)) ? addedAt : null,
    });
  }
  return items;
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
  } catch {
    return null; // storage blocked (private window, site data off): an empty list
  }
}

function read(): WatchlistItem[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = readRaw();
  if (raw === snapshot.raw) return snapshot.items;
  snapshot = { raw, items: parseWatchlist(raw) };
  return snapshot.items;
}

function write(items: WatchlistItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items));
  } catch {
    return; // storage blocked or full: the star simply doesn't stick
  }
  window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(WATCHLIST_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(WATCHLIST_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useWatchlist() {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY);

  const add = useCallback((satelliteNumber: string, name: string) => {
    const existing = read();
    if (existing.some((i) => i.satelliteNumber === satelliteNumber)) return;
    write([...existing, { satelliteNumber, name, addedAt: new Date().toISOString() }]);
  }, []);

  const remove = useCallback((satelliteNumber: string) => {
    write(read().filter((i) => i.satelliteNumber !== satelliteNumber));
  }, []);

  const has = useCallback(
    (satelliteNumber: string) => items.some((i) => i.satelliteNumber === satelliteNumber),
    [items],
  );

  return { items, add, remove, has };
}
