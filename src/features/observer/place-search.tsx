"use client";

/**
 * "Where are you?" as a person would answer it: a town, a postcode, or (for
 * anyone who has them) coordinates. An accessible combobox over the
 * Open-Meteo geocoder; typed coordinates resolve locally without a request.
 *
 * Failures say so ("place search is unavailable") and point at the fallbacks
 * that still work, never an empty list that looks like "no such town".
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  parseCoordinates,
  placeLabel,
  PlaceSearchError,
  searchPlaces,
  type Place,
} from "@/integrations/open-meteo/geocoding";

export interface ChosenSpot {
  lat: number;
  lon: number;
  label: string | null;
  source: "place" | "manual";
}

type Option =
  | { kind: "coordinates"; lat: number; lon: number }
  | { kind: "place"; place: Place };

type Status = "idle" | "searching" | "done" | "failed";

const DEBOUNCE_MS = 300;

function formatCoordinates(lat: number, lon: number, digits = 4): string {
  return `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? "E" : "W"}`;
}

export function PlaceSearch({
  onChoose,
  label = "Search for a town, postcode, or coordinates",
  placeholder = "Town, postcode, or 40.7, -74",
  autoFocus = false,
}: {
  onChoose: (spot: ChosenSpot) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  // The text the current results answer; "no match" is only claimed for it.
  const [resultsFor, setResultsFor] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const text = query.trim();
  const coordinates = parseCoordinates(text);
  // Coordinates resolve locally; only a name of 2+ characters asks the geocoder.
  // Results from an earlier name are ignored (not cleared) while this holds.
  const searchable = text.length >= 2 && coordinates === null;
  const options: Option[] = coordinates
    ? [{ kind: "coordinates", lat: coordinates.latDeg, lon: coordinates.lonDeg }]
    : searchable
      ? places.map((place) => ({ kind: "place", place }))
      : [];
  const shownStatus: Status = searchable ? status : "idle";

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("searching");
      try {
        const found = await searchPlaces(text, { signal: controller.signal });
        setPlaces(found);
        setResultsFor(text);
        setActive(0);
        setFailure(null);
        setStatus("done");
      } catch (error) {
        if (controller.signal.aborted) return; // superseded by a newer keystroke
        setPlaces([]);
        setFailure(
          error instanceof PlaceSearchError
            ? `${error.message} Use your location, or type coordinates like 40.7, -74.`
            : "Place search failed. Use your location, or type coordinates like 40.7, -74.",
        );
        setStatus("failed");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, searchable]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function pick(option: Option) {
    setOpen(false);
    setQuery("");
    setPlaces([]);
    if (option.kind === "coordinates") {
      onChoose({ lat: option.lat, lon: option.lon, label: null, source: "manual" });
    } else {
      onChoose({ lat: option.place.latDeg, lon: option.place.lonDeg, label: placeLabel(option.place), source: "place" });
    }
  }

  const showList = open && options.length > 0;
  const noMatch = open && searchable && shownStatus === "done" && resultsFor === text && places.length === 0;
  const activeId = showList ? `${listId}-opt-${Math.min(active, options.length - 1)}` : undefined;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <input
        className="input w-full"
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        data-testid="place-search"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const option = options[Math.min(active, options.length - 1)];
            if (option) pick(option);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <p className="sr-only" aria-live="polite">
        {shownStatus === "searching"
          ? "Searching places"
          : showList
            ? `${options.length} ${options.length === 1 ? "match" : "matches"}`
            : noMatch
              ? "No matching places"
              : ""}
      </p>
      {showList ? (
        <ul id={listId} role="listbox" className="panel absolute z-50 mt-1 max-h-80 w-full overflow-auto py-1 shadow-lg">
          {options.map((option, i) => (
            <li
              key={option.kind === "place" ? option.place.id : "coordinates"}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={
                "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-left text-[13px] " +
                (i === active ? "bg-[var(--color-bg-inset)]" : "")
              }
              onMouseEnter={() => setActive(i)}
              // mousedown, not click: picking must win over the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
            >
              {option.kind === "coordinates" ? (
                <span className="text-[var(--color-text-primary)]">
                  Use {formatCoordinates(option.lat, option.lon)}
                </span>
              ) : (
                <>
                  <span className="min-w-0 truncate text-[var(--color-text-primary)]">
                    {option.place.name}
                    <span className="text-[var(--color-text-muted)]">
                      {[option.place.region, option.place.country].filter(Boolean).length > 0
                        ? `, ${[option.place.region, option.place.country].filter(Boolean).join(", ")}`
                        : ""}
                    </span>
                  </span>
                  <span className="data-value shrink-0 text-[11px] text-[var(--color-text-muted)]">
                    {formatCoordinates(option.place.latDeg, option.place.lonDeg, 1)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {noMatch ? (
        <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
          No place by that name. Try a nearby town, a postcode, or coordinates.
        </p>
      ) : null}
      {shownStatus === "failed" && failure ? (
        <p className="mt-1 text-[12px] text-[var(--color-status-warn)]" role="status">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
