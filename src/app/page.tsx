import { ExplorerView } from "@/features/satellites/explorer-view";

/**
 * Home / Explorer — opens directly into a usable satellite explorer with the
 * ISS as the default real-data example. No marketing gate, no sign-in.
 */
export default function HomePage() {
  return (
    <ExplorerView
      initialSatellite={{ satelliteNumber: "25544", name: "ISS (ZARYA)" }}
    />
  );
}
