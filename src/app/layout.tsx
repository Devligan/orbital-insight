import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

const description =
  "Every active satellite on a live 3D globe, visible-pass prediction, a constellation atlas, and close-approach screening. Real CelesTrak data, SGP4 propagation, no sign-in.";

// Self-hosted at build time by next/font: no request to Google at runtime.
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

// Absolute URLs for link previews: Vercel provides the production host; local builds fall back to localhost.
const siteHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteHost ? `https://${siteHost}` : "http://localhost:3000"),
  title: "Orbital Insight · the satellites over your sky",
  description,
  openGraph: {
    type: "website",
    siteName: "Orbital Insight",
    title: "Orbital Insight: real satellites, real orbits",
    description,
  },
  twitter: { card: "summary_large_image", title: "Orbital Insight: real satellites, real orbits", description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${plexSans.variable} ${plexMono.variable}`}>
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
