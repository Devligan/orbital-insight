"use client";

import { useEffect, useRef, useState } from "react";

interface SearchHit {
  satelliteNumber: string;
  name: string;
  group?: string;
}

/**
 * Top-bar catalog search. Debounced, accessible combobox; keyboard-navigable
 * result list. The public demo carries no account requirement.
 */
export function CatalogSearch({ onSelect }: { onSelect: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const q = query.trim();
      if (q.length === 0) {
        setHits([]);
        setBusy(false);
        return;
      }
      setBusy(true);
      try {
        const res = await fetch(`/api/satellites/search?q=${encodeURIComponent(q)}&limit=8`, {
          signal: controller.signal,
        });
        const body = (await res.json()) as { ok: boolean; data?: { results: SearchHit[] } };
        setHits(body.ok ? body.data?.results ?? [] : []);
        setActiveIndex(0);
        setOpen(true);
      } catch {
        // Aborted or network failure - leave stale results, don't fake success.
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function choose(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    setHits([]);
    onSelect(hit);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls="catalog-search-results"
        aria-autocomplete="list"
        // Short enough to fit a phone header; the full hint lives in the label.
        placeholder="Search satellites"
        aria-label="Search satellites by name or NORAD catalog number, for example ISS or 25544"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            const hit = hits[activeIndex];
            if (open && hit) choose(hit);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {busy ? <span className="sr-only">Searching…</span> : null}
      {open && hits.length > 0 ? (
        <ul
          id="catalog-search-results"
          role="listbox"
          className="panel absolute z-50 mt-1 max-h-80 w-full overflow-auto py-1 shadow-lg"
        >
          {hits.map((hit, i) => (
            <li key={hit.satelliteNumber} role="none">
              <button
                role="option"
                aria-selected={i === activeIndex}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-bg-inset)]"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(hit)}
              >
                <span className="truncate text-[var(--color-text-primary)]">{hit.name}</span>
                <span className="data-value text-[11px] text-[var(--color-text-muted)]">{hit.satelliteNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
