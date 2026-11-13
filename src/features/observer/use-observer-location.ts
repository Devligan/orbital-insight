"use client";

/**
 * Shared observer-location state.
 *
 * Asking the browser for location is a permission event - doing it from two
 * separate widgets means two prompts for one action. This hook is lifted to
 * the explorer and passed down, so "use my location" on any panel fills in
 * the same observer everywhere (overhead widget, tonight's passes, …).
 *
 * Always offers a fallback that needs no permission: a place search that also
 * accepts typed coordinates. No dead end.
 *
 * The spot itself lives in ./spot-store (remembered in this browser only), so
 * a returning visitor sees their sky without being asked again.
 */

import { useState } from "react";
import { rememberSpot, useRememberedSpot, type ObserverSpot } from "./spot-store";

export type ObserverLocation = ObserverSpot;

export type ObserverLocationError = { kind: string; message: string };

export interface ObserverLocationState {
  observer: ObserverLocation | null;
  locating: boolean;
  error: ObserverLocationError | null;
  /** Ask the browser for device location. */
  locate: () => void;
  /** Use a spot picked in the place search (a named place or typed coordinates). */
  choose: (spot: { lat: number; lon: number; label: string | null; source: "place" | "manual" }) => void;
  /** Forget the current spot so a different one can be chosen. */
  clear: () => void;
}

export function useObserverLocation(): ObserverLocationState {
  const observer = useRememberedSpot();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<ObserverLocationError | null>(null);

  function apply(spot: ObserverLocation) {
    setError(null);
    rememberSpot(spot);
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setError({ kind: "unsupported", message: "This browser can't share a location. Search for a place instead." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        apply({ lat: position.coords.latitude, lon: position.coords.longitude, source: "device", label: null });
      },
      () => {
        setLocating(false);
        setError({ kind: "permission", message: "Location wasn't shared. Search for your town instead." });
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function choose(spot: { lat: number; lon: number; label: string | null; source: "place" | "manual" }) {
    apply({ lat: spot.lat, lon: spot.lon, label: spot.label, source: spot.source });
  }

  function clear() {
    setError(null);
    rememberSpot(null);
  }

  return { observer, locating, error, locate, choose, clear };
}
