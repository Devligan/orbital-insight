import { ConjunctionsView } from "@/features/conjunctions/conjunctions-view";

export const metadata = {
  title: "Close approaches · Orbital Insight",
  description:
    "Screen any satellite against every active satellite for close approaches: time of closest approach, miss distance in the radial/in-track/cross-track frame, and closing speed, computed with SGP4 in your browser.",
};

export default async function ConjunctionsPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams;
  return <ConjunctionsView initialId={typeof id === "string" ? id : null} />;
}