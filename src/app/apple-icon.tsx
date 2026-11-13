import { ImageResponse } from "next/og";
import { INK } from "@/lib/ink";

/** Home-screen icon: the orbit mark, drawn large on the night sky. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: INK.sky }}>
        <svg viewBox="0 0 32 32" width="180" height="180">
          <circle cx="16" cy="16" r="5.6" fill="none" stroke={INK.primary} strokeWidth="1.6" />
          <ellipse
            cx="16"
            cy="16"
            rx="12.4"
            ry="5"
            fill="none"
            stroke={INK.muted}
            strokeWidth="1.2"
            transform="rotate(-28 16 16)"
          />
          <circle cx="26" cy="10.6" r="2.3" fill={INK.sunlit} />
        </svg>
      </div>
    ),
    size,
  );
}
