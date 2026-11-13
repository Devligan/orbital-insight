import { Suspense } from "react";
import { Loading } from "@/components/ui/primitives";
import { ConjunctionsView } from "@/features/conjunctions/conjunctions-view";

export const metadata = {
  title: "Close approaches · Orbital Insight",
  description:
    "Screen any satellite against every active satellite for close approaches: time of closest approach, miss distance in the radial/in-track/cross-track frame, and closing speed, computed with SGP4 in your browser.",
};

export default function ConjunctionsPage() {
  // useSearchParams (the ?id= target) needs a Suspense boundary on a static page.
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <ConjunctionsView />
    </Suspense>
  );
}
