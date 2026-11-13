import { describe, expect, it, vi } from "vitest";
import { CloudForecastError, fetchCloudForecast, parseCloudForecast, type CloudForecast } from "@/integrations/open-meteo/forecast";
import { cloudOutlookFor, cloudPhrase, skyFor } from "@/features/tonight/cloud-outlook";

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 13, 22); // 22:00 UTC

function forecast(values: Array<number | null>, startMs = T0): CloudForecast {
  return parseCloudForecast(
    {
      hourly: {
        time: values.map((_, i) => (startMs + i * H) / 1000),
        cloud_cover: values,
        cloud_cover_low: values.map(() => 0),
      },
    },
    startMs,
  );
}

describe("parseCloudForecast", () => {
  it("reads unix-second hours into instants with their layers", () => {
    const parsed = forecast([10, 40]);
    expect(parsed.hours).toEqual([
      { atMs: T0, totalPct: 10, lowPct: 0, midPct: null, highPct: null },
      { atMs: T0 + H, totalPct: 40, lowPct: 0, midPct: null, highPct: null },
    ]);
  });

  it("drops hours without a total instead of inventing one", () => {
    expect(forecast([10, null, 30]).hours.map((h) => h.totalPct)).toEqual([10, 30]);
  });

  it.each([
    ["no hourly block", {}],
    ["percent out of range", { hourly: { time: [1], cloud_cover: [140] } }],
    ["series of different lengths", { hourly: { time: [1, 2], cloud_cover: [10] } }],
    ["fractional times", { hourly: { time: [1.5], cloud_cover: [10] } }],
    ["a malformed optional layer", { hourly: { time: [1], cloud_cover: [10], cloud_cover_low: ["low"] } }],
    ["a string percentage", { hourly: { time: [1], cloud_cover: ["10"] } }],
  ])("rejects %s", (_why, body) => {
    expect(() => parseCloudForecast(body, 0)).toThrow(CloudForecastError);
  });
});

describe("cloudOutlookFor", () => {
  it("interpolates between the hours around the pass midpoint", () => {
    // Window 22:25–22:35 → midpoint 22:30, halfway from 20% to 60%.
    const outlook = cloudOutlookFor(forecast([20, 60]), T0 + 25 * 60_000, T0 + 35 * 60_000);
    expect(outlook).toEqual({ pct: 40, sky: "partly-cloudy" });
  });

  it("uses an hour's value exactly on the hour", () => {
    expect(cloudOutlookFor(forecast([5, 90]), T0 + H - 60_000, T0 + H + 60_000)?.pct).toBe(90);
  });

  it("says nothing outside the forecast's span", () => {
    const f = forecast([10, 10]);
    expect(cloudOutlookFor(f, T0 - 2 * H, T0 - H)).toBeNull();
    expect(cloudOutlookFor(f, T0 + 3 * H, T0 + 3 * H + 60_000)).toBeNull();
  });

  it("doesn't bridge a gap left by a missing hour", () => {
    // 23:00 is null, so 22:00 → 00:00 is two hours apart: no value at 23:00.
    const f = forecast([10, null, 90]);
    expect(cloudOutlookFor(f, T0 + H - 60_000, T0 + H + 60_000)).toBeNull();
  });
});

describe("words", () => {
  it.each([
    [0, "clear"],
    [20, "clear"],
    [21, "partly-cloudy"],
    [50, "partly-cloudy"],
    [51, "mostly-cloudy"],
    [80, "mostly-cloudy"],
    [81, "overcast"],
    [100, "overcast"],
  ] as const)("%i%% reads %s", (pct, sky) => {
    expect(skyFor(pct)).toBe(sky);
  });

  it("only overcast is called likely hidden", () => {
    expect(cloudPhrase({ pct: 75, sky: "mostly-cloudy" })).not.toMatch(/hidden/);
    expect(cloudPhrase({ pct: 95, sky: "overcast" })).toBe("Overcast forecast · 95% cloud, likely hidden");
    expect(cloudPhrase({ pct: 8, sky: "clear" })).toBe("Clear sky forecast · 8% cloud");
  });
});

describe("fetchCloudForecast", () => {
  it("asks for two days of hourly layers at ~1 km precision, in unix time", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ hourly: { time: [T0 / 1000], cloud_cover: [12] } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await fetchCloudForecast(40.65012, -73.94958, { fetchImpl, now: () => 42 });
    const url = new URL(String(vi.mocked(fetchImpl).mock.calls[0]![0]));
    expect(url.hostname).toBe("api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe("40.65");
    expect(url.searchParams.get("longitude")).toBe("-73.95");
    expect(url.searchParams.get("hourly")).toBe("cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(result).toEqual({ hours: [{ atMs: T0, totalPct: 12, lowPct: null, midPct: null, highPct: null }], retrievedAtMs: 42 });
  });

  it("types an HTTP failure and an unreachable provider", async () => {
    const http = vi.fn(async () => new Response("busy", { status: 429 })) as unknown as typeof fetch;
    await expect(fetchCloudForecast(0, 0, { fetchImpl: http })).rejects.toMatchObject({ reason: "server-error" });
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(fetchCloudForecast(0, 0, { fetchImpl: down })).rejects.toMatchObject({ reason: "network" });
  });
});
