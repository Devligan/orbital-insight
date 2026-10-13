"use client";

/**
 * Anonymous demo watchlist, persisted in the browser's localStorage.
 *
 * This is *client-side preference data*, clearly presented as local to the
 * browser in the UI. Authenticated server persistence (Supabase, RLS) exists
 * separately; the UI always shows which one is active.
 */

import { useCallback, useSyncExternalStore } from "react";

export interface WatchlistItem {
  satelliteNumber: string;
  name: string;
  addedAt: string;
}

const STORAGE_KEY = "orbital-insight.watchlist";
const WATCHLIST_EVENT = "orbital-insight:watchlist-changed";
const EMPTY: WatchlistItem[] = [];

/** Parse snapshot cache: JSON parse produces a stable reference per raw value. */
let snapshot: { raw: string | null; items: WatchlistItem[] } = { raw: null, items: EMPTY };

function parseItems(raw: string | null): WatchlistItem[] {
  if (raw === null) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(
      (item): item is WatchlistItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as WatchlistItem).satelliteNumber === "string" &&
        typeof (item as WatchlistItem).name === "string",
    );
  } catch {
    return EMPTY; // Corrupt local data behaves as empty, never crashes the page.
  }
}

function read(): WatchlistItem[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === snapshot.raw) return snapshot.items;
  snapshot = { raw, items: parseItems(raw) };
  return snapshot.items;
}

function write(items: WatchlistItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
