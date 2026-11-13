import { IdentifyView } from "@/features/identify/identify-view";

export const metadata = {
  title: "What did I just see? — Orbital Insight",
  description:
    "Saw a steady light glide across the night sky? Say when and which way you looked, and every satellite in the public catalog is checked against your sky, with SGP4 in your browser.",
};

export default function IdentifyPage() {
  return <IdentifyView />;
}
