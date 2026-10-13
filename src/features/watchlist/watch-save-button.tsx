"use client";

import { useWatchlist } from "./local-store";

export function WatchSaveButton({ satelliteNumber, name }: { satelliteNumber: string; name: string }) {
  const watchlist = useWatchlist();
  const saved = watchlist.has(satelliteNumber);

  return (
    <button
      className={saved ? "btn btn-secondary" : "btn btn-primary"}
      aria-pressed={saved}
      onClick={() => (saved ? watchlist.remove(satelliteNumber) : watchlist.add(satelliteNumber, name))}
    >
      {saved ? "★ In watchlist (saved in this browser)" : "☆ Save to watchlist (this browser)"}
    </button>
  );
}
