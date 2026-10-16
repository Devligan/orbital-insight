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
    // The fallback reserves a full screen: a one-line placeholder let the
    // footer paint in view and then jump (CLS 0.108 on phones).
    <Suspense
      fallback={
        <div className="min-h-[calc(100svh-56px)]">
          <Loading label="Loading explorer…" />
        </div>
      }
    >
      <ExplorerView
        initialSatellite={{ satelliteNumber: "25544", name: "ISS (ZARYA)" }}
      />
    </Suspense>
  );
}
