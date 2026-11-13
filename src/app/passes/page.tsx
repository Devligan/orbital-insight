import { PassPredictionsForm } from "@/features/pass-prediction/pass-form";
import { PAGE, PageHeader } from "@/components/ui/page-header";

export const metadata = {
  title: "Pass predictions · Orbital Insight",
};

export default function PassesPage() {
  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Passes" title="Every pass, in detail">
        Rise, peak and set for any satellite from any place, with whether each pass can actually be seen. Clouds and
        eyesight aren&apos;t part of the calculation.
      </PageHeader>
      <PassPredictionsForm />
    </div>
  );
}