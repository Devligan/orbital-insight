import { AtlasView } from "@/features/atlas/atlas-view";

export const metadata = {
  title: "Who's in orbit · Orbital Insight",
  description:
    "Every active satellite in the public catalog, charted by altitude and inclination: Starlink's shells, the sun-synchronous band, navigation constellations, and the geostationary belt.",
};

export default function AtlasPage() {
  return <AtlasView />;
}
