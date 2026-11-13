import { CompareView } from "@/features/comparisons/compare-view";

export const metadata = {
  title: "Orbital comparison · Orbital Insight",
};

export default function ComparePage() {
  return (
    <div className="p-3">
      <div className="mb-3">
        <h1 className="text-[16px] font-semibold">Orbital comparison</h1>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Element sets and SGP4 predictions for two catalog objects. Deltas are computed at common timestamps.
        </p>
      </div>
      <CompareView initialLeft="25544" initialRight="48274" />
    </div>
  );
}
