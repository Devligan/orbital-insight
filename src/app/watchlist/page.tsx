"use client";

import Link from "next/link";
import { useWatchlist } from "@/features/watchlist/local-store";
import { EmptyState, Panel } from "@/components/ui/primitives";
import { PAGE, PageHeader } from "@/components/ui/page-header";
import { formatUtc } from "@/lib/units";

export default function WatchlistPage() {
  const watchlist = useWatchlist();

  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Watchlist" title="Saved satellites">
        The ones you&apos;ve starred, kept in this browser only. Nothing is sent to a server.
      </PageHeader>

      <Panel>

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
                      <Link href={`/satellites/${item.satelliteNumber}`} className="link">
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

      </Panel>
    </div>
  );
}
