"use client";

/**
 * The observer's chosen spot, remembered in this browser only.
 *
 * One small external store (localStorage + listeners) read through
 * useSyncExternalStore, so the home page and /passes agree on "where you
 * are", other tabs follow along (the `storage` event), and the server render
 * (no spot) hydrates without a mismatch. The spot never leaves the device.
 * When storage is unavailable (private windows, blocked site data), it lives
 * in memory for the visit instead.
 */

import { useMemo, useSyncExternalStore } from "react";

export interface ObserverSpot {
  lat: number;
  lon: number;
  source: "device" | "place" | "manual";
  /** "Brooklyn, New York, United States" when chosen by name. */
  label: string | null;
}

export const SPOT_STORAGE_KEY = "orbital-insight:observer:v1";

const listeners = new Set<() => void>();
let memoryFallback: string | null = null;

/** Parse a remembered spot; anything malformed is ignored, never trusted. */
export function parseSpot(raw: string | null): ObserverSpot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ObserverSpot>;
    const { lat, lon, source, label } = value;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (source !== "device" && source !== "place" && source !== "manual") return null;
    return { lat, lon, source, label: typeof label === "string" && label.length > 0 ? label.slice(0, 120) : null };
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(SPOT_STORAGE_KEY) ?? memoryFallback;
  } catch {
    return memoryFallback;
  }
}

/** Remember a spot (or forget it with null) and tell every reader. */
export function rememberSpot(spot: ObserverSpot | null): void {
  const raw = spot ? JSON.stringify(spot) : null;
  memoryFallback = raw;
  try {
    if (raw) localStorage.setItem(SPOT_STORAGE_KEY, raw);
    else localStorage.removeItem(SPOT_STORAGE_KEY);
  } catch {
    /* storage unavailable: the in-memory copy serves this visit */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SPOT_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The remembered spot; null on the server and until one is chosen. */
export function useRememberedSpot(): ObserverSpot | null {
  // The raw string is the snapshot: equal strings compare equal, so readers
  // re-render only when the spot actually changes.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parseSpot(raw), [raw]);
}
