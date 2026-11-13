import { CompareView } from "@/features/comparisons/compare-view";
import { PAGE, PageHeader } from "@/components/ui/page-header";

export const metadata = {
  title: "Compare orbits · Orbital Insight",
};

export default function ComparePage() {
  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Compare" title="Two orbits, side by side">
        The published element sets for two objects, and how far apart SGP4 puts them over time.
      </PageHeader>
      <CompareView initialLeft="25544" initialRight="48274" />
    </div>
  );
}