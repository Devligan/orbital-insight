/**
 * The palette for places CSS variables can't reach: canvas drawing and Cesium.
 * Keep in step with the tokens in src/app/globals.css; SVG and HTML should use
 * the CSS variables directly.
 */
export const INK = {
  sky: "#05070b",
  primary: "#e9e7e1",
  secondary: "#a7acb8",
  muted: "#7c8394",
  hairline: "#1a2030",
  rule: "#2a3244",
  sunlit: "#f2b544",
} as const;
