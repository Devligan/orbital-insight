"use client";

import Link from "next/link";
import { useWatchlist } from "@/features/watchlist/local-store";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/units";

export default function WatchlistPage() {
  const watchlist = useWatchlist();

  return (
    <div className="mx-auto max-w-3xl p-3">
      <div className="mb-3">
        <h1 className="text-[16px] font-semibold">Watchlist</h1>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Saved satellites and quick links to their analysis pages.
        </p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <PanelHeader title="Saved in this browser (demo mode)" />
        </div>

        {watchlist.items.length === 0 ? (
          <EmptyState
            title="No saved satellites yet"
            hint="Open the explorer or any satellite detail page and use “Save to watchlist”."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-technical">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Catalog ID</th>
                  <th>Saved (local time)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.items.map((item) => (
                  <tr key={item.satelliteNumber}>
                    <td>
                      <Link href={`/satellites/${item.satelliteNumber}`} className="text-[var(--color-accent)] hover:underline">
                        {item.name}
                      </Link>
                    </td>
                    <td>{item.satelliteNumber}</td>
                    <td>{formatUtc(new Date(item.addedAt))}</td>
                    <td>
                      <button
                        className="btn btn-danger"
                        aria-label={`Remove ${item.name} from the watchlist`}
                        onClick={() => watchlist.remove(item.satelliteNumber)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
          This demo watchlist lives in your browser&apos;s local storage. It is not stored on any server. When the
          application is configured with Supabase and you sign in, watchlists persist server-side under Row Level
          Security instead. The difference is always labelled; nothing silently syncs without your intent.
        </p>
      </Panel>
    </div>
  );
}
