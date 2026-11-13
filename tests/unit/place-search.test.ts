import { describe, expect, it, vi } from "vitest";
import {
  MAX_PLACE_RESULTS,
  parseCoordinates,
  parsePlaceResponse,
  placeLabel,
  PlaceSearchError,
  searchPlaces,
} from "@/integrations/open-meteo/geocoding";
import { parseSpot } from "@/features/observer/spot-store";

// Trimmed from a real answer for "Brooklyn" (2026-11-13).
const BROOKLYN = {
  results: [
    {
      id: 5110302,
      name: "Brooklyn",
      latitude: 40.6501,
      longitude: -73.94958,
      elevation: 15.0,
      feature_code: "PPLA2",
      country_code: "US",
      timezone: "America/New_York",
      population: 2736074,
      postcodes: ["11201"],
      country: "United States",
      admin1: "New York",
      admin2: "Kings",
    },
    { id: 4254985, name: "Brooklyn", latitude: 39.53921, longitude: -86.36916, country: "United States", admin1: "Indiana" },
  ],
  generationtime_ms: 0.19,
};

function respond(body: unknown, init: ResponseInit = { status: 200 }): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), init)) as unknown as typeof fetch;
}

describe("parsePlaceResponse", () => {
  it("keeps name, region, country, coordinates and zone", () => {
    const [first, second] = parsePlaceResponse(BROOKLYN);
    expect(first).toEqual({
      id: 5110302,
      name: "Brooklyn",
      region: "New York",
      country: "United States",
      latDeg: 40.6501,
      lonDeg: -73.94958,
      timeZone: "America/New_York",
      population: 2736074,
    });
    expect(second?.timeZone).toBeNull();
    expect(second?.population).toBeNull();
  });

  it("reads a missing results array as no match, not an error", () => {
    expect(parsePlaceResponse({ generationtime_ms: 0.1 })).toEqual([]);
  });

  it("drops a region that only repeats the place name (city-states)", () => {
    const [singapore] = parsePlaceResponse({
      results: [{ id: 1, name: "Singapore", latitude: 1.29, longitude: 103.85, admin1: "Singapore", country: "Singapore" }],
    });
    expect(singapore?.region).toBeNull();
    expect(placeLabel(singapore!)).toBe("Singapore, Singapore");
  });

  it.each([
    ["a body that isn't an object", "nope"],
    ["results that aren't a list", { results: { id: 1 } }],
    ["an entry without a name", { results: [{ id: 1, latitude: 1, longitude: 2 }] }],
    ["a country that isn't text", { results: [{ id: 1, name: "X", latitude: 1, longitude: 2, country: 7 }] }],
    ["a string latitude", { results: [{ id: 1, name: "X", latitude: "1", longitude: 2 }] }],
  ])("rejects %s", (_why, body) => {
    expect(() => parsePlaceResponse(body)).toThrow(PlaceSearchError);
  });

  it("rejects out-of-range coordinates instead of passing them on", () => {
    expect(() => parsePlaceResponse({ results: [{ id: 1, name: "Nowhere", latitude: 123, longitude: 0 }] })).toThrow(
      PlaceSearchError,
    );
  });
});

describe("placeLabel", () => {
  it("joins what's known", () => {
    expect(placeLabel({ name: "Brooklyn", region: "New York", country: "United States" })).toBe(
      "Brooklyn, New York, United States",
    );
    expect(placeLabel({ name: "Null Island", region: null, country: null })).toBe("Null Island");
  });
});

describe("parseCoordinates", () => {
  it.each([
    ["40.7, -74", 40.7, -74],
    ["40.7 -74", 40.7, -74],
    ["-33.87,151.21", -33.87, 151.21],
    ["40.7N 74W", 40.7, -74],
    ["40.7°N, 74.0°W", 40.7, -74],
    ["33.9 S, 18.4 E", -33.9, 18.4],
  ])("reads %s", (text, lat, lon) => {
    expect(parseCoordinates(text)).toEqual({ latDeg: lat, lonDeg: lon });
  });

  it.each(["Brooklyn", "11201", "91, 0", "0, 181", "-40N 74W", "40.7", ""])("treats %s as not coordinates", (text) => {
    expect(parseCoordinates(text)).toBeNull();
  });
});

describe("searchPlaces", () => {
  it("asks for a bounded, English answer and returns validated places", async () => {
    const fetchImpl = respond(BROOKLYN);
    const places = await searchPlaces("  Brooklyn ", { fetchImpl });
    expect(places).toHaveLength(2);
    const url = new URL(String(vi.mocked(fetchImpl).mock.calls[0]![0]));
    expect(url.hostname).toBe("geocoding-api.open-meteo.com");
    expect(url.searchParams.get("name")).toBe("Brooklyn");
    expect(url.searchParams.get("count")).toBe(String(MAX_PLACE_RESULTS));
    expect(url.searchParams.get("language")).toBe("en");
  });

  it("doesn't call the provider for one character", async () => {
    const fetchImpl = respond(BROOKLYN);
    expect(await searchPlaces("B", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("types an HTTP failure", async () => {
    await expect(searchPlaces("Brooklyn", { fetchImpl: respond({}, { status: 503 }) })).rejects.toMatchObject({
      reason: "server-error",
    });
  });

  it("types an unreachable provider", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(searchPlaces("Brooklyn", { fetchImpl })).rejects.toMatchObject({ reason: "network" });
  });

  it("types a body that isn't JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    await expect(searchPlaces("Brooklyn", { fetchImpl })).rejects.toMatchObject({ reason: "schema" });
  });

  it("times out instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ) as unknown as typeof fetch;
      const pending = searchPlaces("Brooklyn", { fetchImpl });
      const outcome = expect(pending).rejects.toMatchObject({ reason: "timeout" });
      await vi.advanceTimersByTimeAsync(8_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a caller's cancel through as an abort, not a provider failure", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;
    const pending = searchPlaces("Brooklyn", { fetchImpl, signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(PlaceSearchError);
    expect((error as DOMException).name).toBe("AbortError");
  });
});

describe("remembered spot", () => {
  it("round-trips a chosen place", () => {
    const spot = { lat: 40.6501, lon: -73.94958, source: "place", label: "Brooklyn, New York, United States" } as const;
    expect(parseSpot(JSON.stringify(spot))).toEqual(spot);
  });

  it.each([
    ["not JSON", "{"],
    ["missing coordinates", JSON.stringify({ source: "place" })],
    ["out of range", JSON.stringify({ lat: 95, lon: 0, source: "manual" })],
    ["unknown source", JSON.stringify({ lat: 1, lon: 2, source: "gps" })],
    ["nothing stored", null],
  ])("ignores %s", (_why, raw) => {
    expect(parseSpot(raw)).toBeNull();
  });

  it("caps an oversized label and blanks an empty one", () => {
    expect(parseSpot(JSON.stringify({ lat: 1, lon: 2, source: "place", label: "x".repeat(500) }))?.label).toHaveLength(120);
    expect(parseSpot(JSON.stringify({ lat: 1, lon: 2, source: "place", label: "" }))?.label).toBeNull();
  });
});
