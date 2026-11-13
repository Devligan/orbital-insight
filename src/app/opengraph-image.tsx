import { ImageResponse } from "next/og";
import { INK } from "@/lib/ink";

/** Link-preview card (LinkedIn, Slack, X): rendered once at build time. */

export const alt = "Orbital Insight: real satellites, real orbits. Tracking, pass prediction and close-approach screening";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Deterministic pseudo-random dots: a stylised low-orbit shell, the same on every build. */
function shellDots(count: number): { x: number; y: number; r: number; o: number; lit: boolean; farSide: boolean }[] {
  let seed = 7;
  const random = () => ((seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647);
  const dots = Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2;
    const shell = 1 + (random() - 0.5) * 0.06;
    return {
      x: 880 + Math.cos(angle) * 250 * shell,
      y: 315 + Math.sin(angle) * 250 * shell * 0.38 + Math.sin(angle * 3) * 6,
      r: random() < 0.15 ? 3 : 2,
      o: 0.35 + random() * 0.6,
      // A few are sunlit: the site's one accent, used for what you can see.
      lit: random() < 0.08,
      farSide: Math.sin(angle) < 0,
    };
  });
  // The far half of the ring passes behind the planet (disc: centre 880,315, radius 120).
  return dots.filter((d) => !(d.farSide && Math.hypot(d.x - 880, d.y - 315) < 122));
}

export default function OpengraphImage() {
  const dots = shellDots(220);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: INK.sky,
          color: INK.primary,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Earth */}
        <div
          style={{
            position: "absolute",
            left: 760,
            top: 195,
            width: 240,
            height: 240,
            borderRadius: 120,
            background: "#0d1119",
            border: `2px solid ${INK.primary}`,
          }}
        />
        {dots.map((d, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: d.x,
              top: d.y,
              width: d.r * 2,
              height: d.r * 2,
              borderRadius: d.r,
              background: d.lit ? INK.sunlit : INK.muted,
              opacity: d.lit ? 1 : d.o,
            }}
          />
        ))}
        <div style={{ display: "flex", flexDirection: "column", padding: "80px 72px", width: 660 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 600 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: INK.sunlit }} />
            Orbital Insight
          </div>
          <div style={{ marginTop: 56, fontSize: 64, fontWeight: 600, lineHeight: 1.08, letterSpacing: -1.5 }}>
            Real satellites. Real orbits.
          </div>
          <div style={{ marginTop: 28, fontSize: 28, lineHeight: 1.4, color: INK.secondary }}>
            Every active satellite on a live 3D globe, visible-pass prediction, and close-approach screening, computed
            with SGP4 in your browser.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
