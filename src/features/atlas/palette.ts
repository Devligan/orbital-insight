import type { AtlasGroup } from "@/domain/catalog/atlas";

/**
 * Atlas colours. Three categorical hues + a recessive neutral — the most a
 * scatter can carry when every pair of colours meets somewhere on the plot.
 * Validated (dataviz validate_palette.js, --pairs all, dark, surface #0d1420):
 * lightness band, chroma floor, CVD ΔE ≥ 9.4, normal-vision ΔE ≥ 20.9, ≥ 3:1
 * contrast. Identity is never colour-alone: legend + table carry names.
 */
export const GROUP_COLORS: Record<AtlasGroup, string> = {
  starlink: "#3987e5",
  broadband: "#d95926",
  navigation: "#199e70",
  other: "#56657c",
};

export const GROUP_LABELS: Record<AtlasGroup, string> = {
  starlink: "Starlink",
  broadband: "Other broadband constellations",
  navigation: "Navigation",
  other: "Everything else",
};

/** Bottom-to-top stacking and back-to-front drawing order. */
export const GROUP_ORDER: readonly AtlasGroup[] = ["starlink", "broadband", "navigation", "other"];
