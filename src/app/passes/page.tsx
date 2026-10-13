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
          SGP4 pass predictions for a ground observer. Geometry only — not an optical-visibility forecast.
        </p>
      </div>
      <PassPredictionsForm />
    </div>
  );
}
