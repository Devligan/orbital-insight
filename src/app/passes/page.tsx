import { PassPredictionsForm } from "@/features/pass-prediction/pass-form";

export const metadata = {
  title: "Pass predictions — Orbital Insight",
};

export default function PassesPage() {
  return (
    <div className="p-3">
      <div className="mb-3">
        <h1 className="text-[16px] font-semibold">Pass predictions</h1>
        <p className="text-[12px] text-[var(--color-text-muted)]">
          SGP4 pass predictions with modeled sunlight geometry (shadow + sky darkness + brightness estimate) —
          still not an observing forecast: weather and eyesight aren&apos;t modeled.
        </p>
      </div>
      <PassPredictionsForm />
    </div>
  );
}
