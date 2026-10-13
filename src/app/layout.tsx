import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Orbital Insight — Satellite Analysis Platform",
  description:
    "Explore real satellites, predict passes, and compare orbital element sets. Live CelesTrak data, SGP4 propagation, no sign-in required.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <a href="#main-content" className="sr-only focus:not-sr-only">
          Skip to content
        </a>
        <div id="main-content">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
