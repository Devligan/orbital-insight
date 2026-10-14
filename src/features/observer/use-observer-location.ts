"use client";

/**
 * Shared observer-location state.
 *
 * Asking the browser for location is a permission event — doing it from two
 * separate widgets means two prompts for one action. This hook is lifted to
 * the explorer and passed down, so "use my location" on any panel fills in
 * the same observer everywhere (overhead widget, tonight's passes, …).
 *
 * Always offers the manual-coordinate fallback: no permission, no dead end.
 */

import { useState } from "react";

export interface ObserverLocation {
  lat: number;
  lon: number;
  source: "device" | "manual";
}

export type ObserverLocationError = { kind: string; message: string };

export interface ObserverLocationState {
  observer: ObserverLocation | null;
  locating: boolean;
  error: ObserverLocationError | null;
  manualLat: string;
  manualLon: string;
  setManualLat: (value: string) => void;
  setManualLon: (value: string) => void;
  /** Ask the browser for device location; fills manual inputs on success. */
  locate: () => void;
  /** Validate + apply manually-typed coordinates; returns false on bad input. */
  submitManual: () => boolean;
}

export function useObserverLocation(): ObserverLocationState {
  const [observer, setObserver] = useState<ObserverLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<ObserverLocationError | null>(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");

  function locate() {
    if (!("geolocation" in navigator)) {
      setError({ kind: "unsupported", message: "This browser cannot share a location — type coordinates manually." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setObserver({ lat, lon, source: "device" });
        setManualLat(lat.toFixed(3));
        setManualLon(lon.toFixed(3));
        setError(null);
      },
      () => {
        setLocating(false);
        setError({ kind: "permission", message: "Location permission denied — type coordinates below instead." });
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function submitManual(): boolean {
    const lat = Number.parseFloat(manualLat);
    const lon = Number.parseFloat(manualLon);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      setError({ kind: "invalid", message: "Latitude must be within ±90° and longitude within ±180°." });
      return false;
    }
    setObserver({ lat, lon, source: "manual" });
    setError(null);
    return true;
  }

  return {
    observer,
    locating,
    error,
    manualLat,
    manualLon,
    setManualLat,
    setManualLon,
    locate,
    submitManual,
  };
}
