import { Suspense } from "react";
import { ExplorerView } from "@/features/satellites/explorer-view";
import { Loading } from "@/components/ui/primitives";

/**
 * Home / Explorer — opens directly into a usable satellite explorer with the
 * ISS as the default real-data example. No marketing gate, no sign-in.
 *
 * Suspense boundary: the explorer reads share-link query params
 * (?cat=&t=) via useSearchParams, which must be wrapped for prerendering.
 */
export default function HomePage() {
  return (
    <Suspense fallback={<Loading label="Loading explorer…" />}>
      <ExplorerView
        initialSatellite={{ satelliteNumber: "25544", name: "ISS (ZARYA)" }}
      />
    </Suspense>
  );
}
