/**
 * The pass-prediction request's limits and the words for breaking them, in one
 * place for both sides of the wire: the /api/passes zod schema enforces them,
 * and the form checks them first so a person learns which field is wrong
 * before anything is sent.
 *
 * Plain TypeScript on purpose: the form runs in the browser, and zod there
 * costs ~27 kB gzip of the home-page budget.
 */

export const MAX_PASS_SATELLITES = 25;

interface Range {
  label: string;
  min: number;
  max: number;
  unit: string;
}

export const PASS_LIMITS = {
  latitudeDeg: { label: "Latitude", min: -90, max: 90, unit: "°" },
  longitudeDeg: { label: "Longitude", min: -180, max: 180, unit: "°" },
  altitudeMeters: { label: "Altitude", min: -1_000, max: 10_000, unit: " m" },
  windowHours: { label: "Prediction window", min: 1, max: 24 * 30, unit: " h" },
  minElevationDeg: { label: "Minimum elevation", min: 0, max: 85, unit: "°" },
} as const satisfies Record<string, Range>;

export type PassNumberField = keyof typeof PASS_LIMITS;

/** "Latitude must be between -90° and 90°." The same sentence from the form and the server. */
export function rangeMessage(field: PassNumberField): string {
  const { label, min, max, unit } = PASS_LIMITS[field];
  return `${label} must be between ${min.toLocaleString("en-US")}${unit} and ${max.toLocaleString("en-US")}${unit}.`;
}

export const CATALOG_ID_PATTERN = /^[0-9]{1,5}$/;

export const SATELLITE_LIST_MESSAGES = {
  empty: "Enter at least one catalog ID.",
  tooMany: `Enter at most ${MAX_PASS_SATELLITES} catalog IDs.`,
  notAnId: (token: string) => `"${token.length > 12 ? `${token.slice(0, 12)}…` : token}" isn't a catalog ID (1 to 5 digits).`,
} as const;

export type PassFormField = PassNumberField | "satellites";

export interface PassFormValues {
  satellites: string;
  latitude: string;
  longitude: string;
  altitudeMeters: string;
  windowHours: string;
  minElevationDeg: string;
}

export interface PassRequestFields {
  satelliteNumbers: string[];
  observer: { latitudeDeg: number; longitudeDeg: number; altitudeMeters: number };
  windowHours: number;
  minElevationDeg: number;
}

export type PassFormCheck =
  | { ok: true; request: PassRequestFields }
  | { ok: false; errors: Partial<Record<PassFormField, string>> };

/**
 * A decimal number as a person types one, or null. Stricter than Number():
 * an empty field is not 0, and hex, exponents and "Infinity" are not numbers
 * here. A typographic minus (copied from a label) counts as a minus.
 */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(/^−/, "-");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Catalog IDs from free text: space- or comma-separated, duplicates dropped, order kept. */
export function splitCatalogIds(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter((token) => token.length > 0))];
}

/** Check every field and say what's wrong with each one, not just the first. */
export function checkPassForm(values: PassFormValues): PassFormCheck {
  const errors: Partial<Record<PassFormField, string>> = {};

  const ids = splitCatalogIds(values.satellites);
  const bad = ids.find((id) => !CATALOG_ID_PATTERN.test(id));
  if (ids.length === 0) errors.satellites = SATELLITE_LIST_MESSAGES.empty;
  else if (bad !== undefined) errors.satellites = SATELLITE_LIST_MESSAGES.notAnId(bad);
  else if (ids.length > MAX_PASS_SATELLITES) errors.satellites = SATELLITE_LIST_MESSAGES.tooMany;

  const numbers = {} as Record<PassNumberField, number>;
  const raw: Record<PassNumberField, string> = {
    latitudeDeg: values.latitude,
    longitudeDeg: values.longitude,
    altitudeMeters: values.altitudeMeters,
    windowHours: values.windowHours,
    minElevationDeg: values.minElevationDeg,
  };
  for (const field of Object.keys(PASS_LIMITS) as PassNumberField[]) {
    const value = parseDecimal(raw[field]);
    const { label, min, max } = PASS_LIMITS[field];
    if (raw[field].trim() === "") errors[field] = `${label} is required.`;
    else if (value === null) errors[field] = `${label} must be a number.`;
    else if (value < min || value > max) errors[field] = rangeMessage(field);
    else numbers[field] = value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    request: {
      satelliteNumbers: ids,
      observer: {
        latitudeDeg: numbers.latitudeDeg,
        longitudeDeg: numbers.longitudeDeg,
        altitudeMeters: numbers.altitudeMeters,
      },
      windowHours: numbers.windowHours,
      minElevationDeg: numbers.minElevationDeg,
    },
  };
}
