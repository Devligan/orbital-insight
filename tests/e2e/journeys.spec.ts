import { expect, test } from "@playwright/test";

/**
 * Critical user journeys (no sign-in required at any step).
 * These tests exercise the real app over HTTP against the production build.
 * The public CelesTrak provider is the live dependency; assertions are
 * written to distinguish "app worked" from "provider marked down", so outage
 * behavior is verifiable honestly rather than flaky-red.
 */

test.describe("explorer journey", () => {
  test("switching satellites repeatedly never crashes the globe entity collection", async ({ page }) => {
    // Crash receipt from production: the fixed-id "ground-track" entity was
    // re-added over a stale one (Cesium DeveloperError). This journey pins
    // the remove-then-add contract under the rapid user path.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto("/");
    // Redesigned surface: the default satellite's engineering prose stays
    // collapsed until opened. The enabled slider is the "default satellite is
    // loaded" sentinel (same data dependency as the epoch line).
    await expect(page.getByRole("slider")).toBeEnabled({ timeout: 60_000 });
    for (const name of ["CSS (TIANHE)", "HST (Hubble)", "STARLINK-30423", "ISS (ZARYA)"]) {
      await page.getByRole("button", { name }).first().click();
      await page.waitForTimeout(700);
    }
    // Engineering prose is collapsed by default in the redesigned surface —
    // open the technical panel to reach epoch/provenance assertions.
    await page.getByText(/Technical details & provenance/i).click();
    await expect(page.getByText(/Element epoch:/i)).toBeVisible({ timeout: 30_000 });
    expect(errors.filter((e) => /already exists/i.test(e))).toEqual([]);
  });

  test("opens the explorer without signing in and shows the default satellite", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Orbital Insight/i);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The curated examples strip and search are immediately usable.
    await expect(page.getByRole("button", { name: /ISS \(ZARYA\)/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search satellites/i)).toBeVisible();
  });

  test("loads a real satellite with orbital characteristics and provenance", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ISS (ZARYA)" }).first().click();
    // Engineering prose is collapsed by default in the redesigned surface —
    // open the technical panel, then verify the full data contract.
    await page.getByText(/Technical details & provenance/i).click();
    await expect(page.getByText(/Element epoch:/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Retrieved:/i)).toBeVisible();
    // Plain-language honesty line (rephrased deliberately — same contract:
    // a prediction, not live telemetry).
    await expect(page.getByText(/Position shown is calculated/i)).toBeVisible();
    // Provenance link is always visible (uncollapsed) on the redesigned aside.
    await expect(page.getByRole("link", { name: /source record/i })).toBeVisible();
  });

  test("time slider moves the globe itself, not just the readout", async ({ page }) => {
    // The slider once changed only a text readout while the globe sat frozen
    // at page-load time; a readout-only assertion passed throughout. This
    // reads the instant back from Cesium's own clock.
    await page.goto("/");
    await page.getByRole("button", { name: "ISS (ZARYA)" }).first().click();
    const slider = page.getByRole("slider");
    await expect(slider).toBeEnabled({ timeout: 30_000 });
    const globe = page.locator('[aria-label^="3D globe showing"]');
    await expect(globe).toHaveAttribute("data-clock-rate", "1", { timeout: 60_000 });
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    // The station is drawn where it is: ~400 km up, read back from Cesium.
    // (km samples once went in as metres, putting it inside the Earth.)
    await expect(globe).toHaveAttribute("data-satellite-altitude-km", /\d+/, { timeout: 30_000 });
    const altitudeKm = Number(await globe.getAttribute("data-satellite-altitude-km"));
    expect(altitudeKm).toBeGreaterThan(350);
    expect(altitudeKm).toBeLessThan(460);
    const readout = page.locator("#time-slider ~ *").last();
    const readoutBefore = await readout.textContent();
    const before = Date.parse((await globe.getAttribute("data-clock-instant")) ?? "");

    await slider.fill(String(24)); // 24 steps of the 6 h / 72-sample window ≈ 2 h
    await expect(globe).toHaveAttribute("data-clock-rate", "0");
    const after = Date.parse((await globe.getAttribute("data-clock-instant")) ?? "");
    const aheadMinutes = (after - before) / 60_000;
    expect(aheadMinutes).toBeGreaterThan(100);
    expect(aheadMinutes).toBeLessThan(140);
    expect(await readout.textContent()).not.toEqual(readoutBefore);

    await page.getByRole("button", { name: /Back to live/i }).click();
    await expect(globe).toHaveAttribute("data-clock-rate", "1");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
  });

  test("wheel-zooming at the very centre of the globe never stops its rendering", async ({ page }) => {
    // Zoom aims with exact ray–ellipsoid picks (no GPU depth readback), and
    // with the cursor on the centre pixel Cesium's zoom rotated the camera
    // about a zero-length axis, threw, and stopped rendering for good.
    await page.goto("/");
    const canvas = page.locator('[aria-label^="3D globe showing"] canvas');
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[aria-label^="3D globe showing"]')).toHaveAttribute("data-satellite-altitude-km", /\d+/, {
      timeout: 60_000,
    });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // A few steps suffice: the zero-axis case hit on the first one. (The
    // test browser renders on the CPU at ~1 frame/s, so keep this short.)
    for (let step = 0; step < 6; step++) {
      await page.mouse.wheel(0, step < 4 ? -240 : 240);
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(2_000);
    await expect(page.locator(".cesium-widget-errorPanel")).toHaveCount(0);
  });
});

test.describe("detail + search journey", () => {
  test("search returns real catalog hits and navigates to detail", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder(/Search satellites/i).fill("ISS");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole("option").first().click();
    // The detail route is server-rendered with provider-backed data; under
    // full-suite load the transition can exceed the default 15 s — every
    // other provider-dependent assertion here already uses longer timeouts.
    await expect(page).toHaveURL(/\/satellites\/\d+$/, { timeout: 60_000 });
    await expect(page.getByText(/Original GP record on CelesTrak/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Element epoch/i)).toBeVisible();
  });

  test("search answers instantly from the shipped catalog snapshot", async ({ page }) => {
    // The curated catalog ships with the deployment, so options appear without
    // waiting on any provider call — verified even minutes after a cold boot.
    await page.goto("/");
    await page.getByPlaceholder(/Search satellites/i).fill("ZARYA");
    await expect(page.getByRole("option", { name: /ISS \(ZARYA\)/ })).toBeVisible({ timeout: 5_000 });
  });

  test("overhead computation answers from the hero's manual coordinates", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /What's flying over you tonight/i })).toBeVisible();
    const hero = page.getByRole("region", { name: "What's in the sky" });
    await hero.getByLabel("Manual latitude").fill("28.5");
    await hero.getByLabel("Manual longitude").fill("-80.6"); // Florida
    await hero.getByRole("button", { name: "Go" }).click();
    // The observer chip appears either way; the honest named-or-empty lines
    // follow (never a spinner forever).
    await expect(page.getByText(/watching from 28\.5/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/ISS|CSS|Nothing bright is above 15/i).first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("pass prediction journey", () => {
  test("calculates passes for a location and satellite", async ({ page }) => {
    await page.goto("/passes");
    await page.getByLabel(/Observer latitude/i).fill("28.5");
    await page.getByLabel(/Observer longitude/i).fill("-80.6"); // Florida
    await page.getByLabel(/Catalog IDs/i).fill("25544");
    await page.getByRole("button", { name: /Predict passes/i }).click();
    const outcome = page.getByText(/No passes above/i).or(page.getByRole("table"));
    await expect(outcome.first()).toBeVisible({ timeout: 60_000 });
    // Every enriched pass row carries its sky chart ("where to look").
    if (await page.getByRole("table").count()) {
      const rows = page.locator("table tbody tr");
      await expect(rows.first().locator('[data-testid="sky-chart"]')).toBeVisible();
      expect(await page.locator('table [data-testid="sky-chart"]').count()).toBe(await rows.count());
    }
  });

  test("exports pass predictions as a CSV download", async ({ page }) => {
    await page.goto("/passes");
    await page.getByLabel(/Observer latitude/i).fill("28.5");
    await page.getByLabel(/Observer longitude/i).fill("-80.6");
    await page.getByLabel(/Catalog IDs/i).fill("25544");
    await page.getByRole("button", { name: /Predict passes/i }).click();
    // The export fires the download synchronously with the click — register
    // the listener BEFORE clicking so the event cannot be missed.
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: /Export CSV/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test("the compute-budget guard rejects oversized requests with a clear message", async ({ page }) => {
    await page.goto("/passes");
    await page.getByLabel(/Catalog IDs/i).fill("25544 21452 22877 23223 23969 24876 25954 26360 26879 27704 28361 28480 28626 29601 32252 32382 32772 32953 33417 35752 36585 37846 38833 39166 40730");
    await page.getByLabel(/Prediction window/i).fill("720");
    await page.getByRole("button", { name: /Predict passes/i }).click();
    await expect(page.getByText(/compute-bounded/i)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("watchlist journey", () => {
  test("saves a satellite to the browser watchlist and lists it", async ({ page }) => {
    await page.goto("/satellites/25544");
    const save = page.getByRole("button", { name: /Save to watchlist/i }).first();
    await expect(save).toBeVisible({ timeout: 30_000 });
    await save.click();
    await page.goto("/watchlist");
    await expect(page.getByRole("table")).toContainText("25544");
  });
});

test.describe("comparison journey", () => {
  test("compares the two default satellites and renders the delta chart", async ({ page }) => {
    await page.goto("/compare");
    // Both defaults (ISS 25544, CSS 48274) sit in the curated station group.
    await expect(page.getByText(/Left: ISS/i)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Right: CSS/i)).toBeVisible({ timeout: 90_000 });
    // Recharts renders its SVG wrapper once data arrives.
    await expect(page.locator(".recharts-wrapper").first()).toBeVisible({ timeout: 30_000 });
    // Explicit interpretation notes must be visible (elements-≠-physics guard).
    await expect(page.getByText(/differing epochs, fitting procedures/i)).toBeVisible();
  });
});

test.describe("2D fallback journey", () => {
  test("swaps in the computed 2D ground track when WebGL is unavailable", async ({ page }) => {
    // Force every WebGL context request (and the canvas itself) to fail, the
    // way a blocked/absent GPU stack behaves.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args: unknown[]) {
        const type = String(args[0]);
        if (type === "webgl" || type === "webgl2" || type.includes("webgl")) {
          return null;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any).apply(this, args as any);
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "ISS (ZARYA)" }).first().click();
    // The globe failure fallback appears — an honest failure message naming the
    // 2D swap-in, not a spinner forever.
    await expect(page.getByText(/same orbit drawn in 2D/i)).toBeVisible({ timeout: 60_000 });
    // And the computed 2D ground track actually swaps in.
    await expect(page.locator("svg[role=img]").first()).toBeVisible({ timeout: 30_000 });
    // The prediction-time slider must visibly act on the 2D fallback: the
    // accent marker rides along the track as time moves.
    const marker = page.locator('[data-testid="ground-track-marker"]').first();
    await expect(marker).toBeVisible({ timeout: 30_000 });
    await page.getByRole("slider").fill("0");
    const before = await marker.locator("circle").first().getAttribute("cx");
    await page.getByRole("slider").fill("71");
    const after = await marker.locator("circle").first().getAttribute("cx");
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });
});

test.describe("provider failure handling", () => {
  test("shows real data or an honest failure — never fabricated data", async ({ page }) => {
    // The provider (CelesTrak) may be up or down when this runs; both states
    // are honest outcomes. What must NEVER happen is fake/simulated data.
    await page.goto("/satellites/25544");
    // The detail page labels fields without a trailing colon (styled
    // uppercase) — the colon form only exists on the explorer aside.
    const loaded = page.getByText(/Element epoch/i);
    const honestFailure = page.getByText(/Satellite data unavailable/i);
    await expect(loaded.or(honestFailure).first()).toBeVisible({ timeout: 60_000 });
    // When data loaded, provenance is present; when it failed, the outage is
    // named specifically, not hidden behind a spinner or a generic error.
    if (await loaded.count()) {
      await expect(page.getByText(/Retrieved/i)).toBeVisible();
    } else {
      await expect(page.getByText(/upstream provider \(CelesTrak\) may be unreachable/i)).toBeVisible();
    }
  });

  test("no unexplained console errors on the explorer during provider outage", async ({ page }) => {
    // Honest-but-error states must stay console-clean: real provider failures
    // surface in the UI, not as page crashes or unexpected exceptions.
    const errors: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/does not implement|favicon/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.goto("/");
    await page.waitForTimeout(8_000);
    // Uncaught page errors are never acceptable, whatever their wording — a
    // filtered check here once let a SyntaxError that killed the globe ship.
    expect(pageErrors).toEqual([]);
    expect(errors.filter((entry) => /exception|Error:/.test(entry))).toEqual([]);
  });
});

test.describe("location-first + shareable moments", () => {
  test("one click on 'my location' yields tonight's passes from that spot", async ({ page }) => {
    // Grant a fixed device location (equator — the ISS crosses it twice per
    // orbit, so a 24 h window reliably contains passes above 10°).
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ latitude: 0, longitude: 0 });
    await page.goto("/");
    await page.getByRole("button", { name: /Show me tonight's passes/i }).click();
    // The headline answer arrives: visible passes, or the truthful reason
    // there are none — never a spinner forever and never fabricated times.
    await expect(
      page.locator('[data-testid="tonight-visible-list"]').or(page.locator('[data-testid="tonight-visible-empty"]')).first(),
    ).toBeVisible({ timeout: 90_000 });
    // Every geometric pass stays one click away: real cards, or the honest
    // per-satellite no-pass message.
    await page.getByText(/Every pass in the next 24 hours/i).click();
    await expect(
      page.locator('[data-testid="tonight-pass-cards"]').or(page.getByText(/Doesn't clear your horizon/i)).first(),
    ).toBeVisible({ timeout: 10_000 });
    if (await page.locator('[data-testid="pass-card"]').count()) {
      await expect(page.locator('[data-testid="pass-card"] [data-testid="sky-chart"]').first()).toBeVisible();
    }
  });

  test("a visible pass shows where to look on a sky chart and goes into the calendar", async ({ page }) => {
    // Whether a real pass is visible depends on the date, so this pins the
    // UI half with a contract-shaped response; the physics behind it is
    // unit-tested (visible-window, sky-chart, pass-calendar).
    const now = Date.now();
    const at = (seconds: number) => new Date(now + 30 * 60_000 + seconds * 1000).toISOString();
    const skyTrack = Array.from({ length: 24 }, (_, i) => {
      const f = i / 23;
      return { timeIso: at(f * 360), azimuthDeg: 225 - 135 * f, elevationDeg: 10 + 53 * Math.sin(Math.PI * f) };
    });
    const visibleWindow = {
      start: skyTrack[0],
      end: { timeIso: at(280), azimuthDeg: 120, elevationDeg: 35 },
      startsFromShadow: false,
      endsInShadow: true,
    };
    await page.route("**/api/passes", (route) =>
      route.fulfill({
        json: {
          ok: true,
          data: {
            windowStart: new Date(now).toISOString(),
            windowEnd: new Date(now + 24 * 3_600_000).toISOString(),
            minElevationDeg: 10,
            observerTimeZone: "Etc/GMT",
            results: [
              {
                satelliteNumber: "25544",
                name: "ISS (ZARYA)",
                lineage: "live",
                passes: [
                  {
                    riseTime: at(0),
                    maxTime: at(180),
                    maxElevationDeg: 63,
                    setTime: at(360),
                    truncated: "none",
                    azimuthAtRiseDeg: 225,
                    azimuthAtMaxDeg: 157.5,
                    azimuthAtSetDeg: 90,
                    visibility: {
                      fromGround: true,
                      bestEstimatedMagnitude: -3.4,
                      bestTimeIso: at(180),
                      sunElevationDegAtApex: -14,
                      satelliteInShadowAtApex: false,
                      reasonIfNotVisible: null,
                      visibleWindow,
                      skyTrack,
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({ latitude: 40.7, longitude: -74 });
    await page.goto("/");
    await page.getByRole("button", { name: /Show me tonight's passes/i }).click();

    const row = page.locator('[data-testid="tonight-visible-pass"]').first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    const chart = row.locator('[data-testid="sky-chart"]');
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute("data-visible", "true");
    await expect(chart.locator('[data-testid="sky-chart-visible"]')).toHaveCount(1);
    await expect(chart.locator('[data-testid="sky-chart-shadow-entry"]')).toHaveCount(1);
    await expect(chart).toHaveAttribute("aria-label", /highest 63° in the S.*visible from 10° up in the SW to 35° up in the SE/);

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await row.getByRole("button", { name: /Add to calendar/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^iss-pass-\d{4}-\d{2}-\d{2}\.ics$/);
    const { readFile } = await import("node:fs/promises");
    const ics = (await readFile((await download.path()) as string, "utf8")).replace(/\r\n /g, "");
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("SUMMARY:ISS visible — look SW");
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(ics).toContain("LOCATION:40.7°N\\, 74.0°W");
  });

  test("the URL names the viewed object and instant, and reopening reproduces it", async ({ page }) => {
    // Clipboard access is granted so the copy-link affordance can be verified
    // end-to-end: the copied URL is the shareable artifact users actually pass
    // around.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    // Engineering prose is collapsed in the redesigned surface; the enabled
    // slider is the "object loaded" sentinel before switching.
    await expect(page.getByRole("slider")).toBeEnabled({ timeout: 60_000 });
    // Switching satellites rewrites the share param through the router.
    await page.getByRole("button", { name: "HST (Hubble)" }).first().click();
    await expect(page).toHaveURL(/\?cat=20580/, { timeout: 60_000 });
    // The prediction instant joins the share URL via the copy-link action.
    await page.getByRole("slider").fill("12");
    await page.getByRole("button", { name: /Copy share link/i }).click();
    await expect(page.getByRole("button", { name: /Link copied/i })).toBeVisible({ timeout: 10_000 });
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toMatch(/\/?cat=20580&t=12$/);
    // Deep-linking the shared URL lands on that object at that offset: the
    // slider starts at step 12, not 0. (ISS 25544 for the deep link — it must
    // always have loadable elements; curated neighbors may rotate over time.)
    await page.goto("/?cat=25544&t=12");
    const slider = page.getByRole("slider");
    await expect(slider).toBeEnabled({ timeout: 60_000 });
    await expect(slider).toHaveValue("12");
  });
});

test.describe("phone layout", () => {
  test("no page scrolls sideways at phone width", async ({ page }) => {
    // A single unbreakable line (TLE text, a wide table) inside an `auto`
    // grid column once pushed the whole detail page off-screen on phones.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/", "/passes", "/satellites/25544", "/compare", "/watchlist", "/methodology"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {
        /* long-lived requests (catalog, imagery) may keep the network busy; layout is settled by now */
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("pass cards on phones", () => {
  test("a phone-width viewport renders passes as cards, not a 7-column table", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/passes");
    await page.getByLabel(/Observer latitude/i).fill("0");
    await page.getByLabel(/Observer longitude/i).fill("0");
    await page.getByLabel(/Catalog IDs/i).fill("25544");
    await page.getByRole("button", { name: /Predict passes/i }).click();
    // A stable test id, not styling classes: a visual redesign once broke a
    // `.rounded.border` selector here without changing behaviour.
    const cards = page.locator('.md\\:hidden [data-testid="pass-card"]');
    const table = page.getByRole("table");
    await expect(cards.or(page.getByText(/No passes above/i)).first()).toBeVisible({ timeout: 90_000 });
    if (await cards.count()) {
      // The table stays out of the mobile layout entirely.
      await expect(table).toBeHidden();
      // Cards speak plain language: peak height and a compass point.
      await expect(cards.first().getByText(/peaks \d+°/)).toBeVisible();
    }
  });
});

test.describe("constellation atlas", () => {
  test("holds its layout while the catalog loads (no lurch when the charts arrive)", async ({ page }) => {
    // A slow catalog response is when the jump happened: Lighthouse measured
    // CLS 0.85 as ~3 000 px of charts replaced a one-line spinner and threw
    // the footer out of view. Delay the API the way a slow network would.
    await page.route("**/api/sky/catalog", async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({ response });
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/atlas");
    await expect(page.getByTestId("atlas-plot")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_000);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    // Measured here: 0 with the space held, 0.11 without. Half of Core Web
    // Vitals' 0.1 "good" bound, so a regression fails clearly, not by a hair.
    expect(cls).toBeLessThan(0.05);
  });

  test("charts the catalog, spotlights a constellation, and opens a dot's satellite", async ({ page }) => {
    await page.goto("/atlas");
    const plot = page.getByTestId("atlas-plot");
    await expect(plot).toHaveAttribute("data-plotted", /^[1-9]\d{3,}$/, { timeout: 60_000 });
    // Headline stats and the accessible table carry the same numbers as the plot.
    await expect(page.getByText("active objects tracked")).toBeVisible();
    await expect(page.getByRole("cell", { name: /Starlink/ })).toBeVisible();

    // Spotlight Starlink: only spotlighted dots answer the pointer.
    await page.getByRole("button", { name: /^Starlink/ }).click();
    await expect(page.getByRole("button", { name: /^Starlink/ })).toHaveAttribute("aria-pressed", "true");

    // Take a real Starlink from the same feed and click exactly where it must
    // be drawn: inclination and mean altitude straight from its TLE line 2,
    // mapped through the plot's published scales. (Data-driven on purpose —
    // a hardcoded "550 km shell" went stale when SpaceX lowered the shell.)
    const catalog = await (await page.request.get("/api/sky/catalog")).json();
    const starlink = (catalog.data.entries as { n: string; l2: string }[]).find((e) => e.n.startsWith("STARLINK"))!;
    const inclination = Number(starlink.l2.slice(8, 16));
    const nRadPerSec = (Number(starlink.l2.slice(52, 63)) * 2 * Math.PI) / 86_400;
    const meanAltitudeKm = Math.cbrt(398_600.7996 / nRadPerSec ** 2) - 6_378.135; // mean of perigee & apogee
    await plot.scrollIntoViewIfNeeded(); // mouse.click doesn't scroll; the plot starts below the fold
    const box = (await plot.boundingBox())!;
    const [left, right, top, bottom] = ((await plot.getAttribute("data-margins")) ?? "").split(",").map(Number);
    const xMax = Number(await plot.getAttribute("data-x-max"));
    const [yMinLog, yMaxLog] = ((await plot.getAttribute("data-y-log-domain")) ?? "").split(",").map(Number);
    const plotH = box.height - top! - bottom!;
    const x = left! + (inclination / xMax) * (box.width - left! - right!);
    const y = top! + plotH - ((Math.log10(meanAltitudeKm) - yMinLog!) / (yMaxLog! - yMinLog!)) * plotH;
    await page.mouse.click(box.x + x, box.y + y);

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("Starlink");
    await tooltip.getByRole("link", { name: /Open details/ }).click();
    await expect(page).toHaveURL(/\/satellites\/\d+$/);
  });
});

test.describe("close-approach screening", () => {
  test("screens the ISS against the catalog and opens an encounter profile", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    // Entry point from a satellite's detail page.
    await page.goto("/satellites/25544");
    await page.getByRole("link", { name: /Screen for close approaches/ }).click();
    await expect(page).toHaveURL(/\/conjunctions\?id=25544$/);

    // The worker reports the funnel; CI runners are slower than laptops.
    const funnel = page.getByTestId("screening-funnel");
    await expect(funnel).toBeVisible({ timeout: 120_000 });
    await expect(funnel).toContainText("active objects");
    await expect(page.getByText(/SGP4 propagations in/)).toBeVisible();

    // Real data decides whether anything comes close: either a table whose
    // first row expands into the profile, or the honest empty state.
    const table = page.getByTestId("approaches-table");
    if (await table.isVisible()) {
      await table.locator("tbody tr").first().click();
      await expect(page.getByRole("img", { name: /Separation between ISS/ })).toBeVisible();
    } else {
      await expect(page.getByTestId("no-approaches")).toBeVisible();
    }
    // Docked modules share the ISS's element set: never reported as approaches.
    await expect(table.getByText("ISS (ZVEZDA)")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("methodology page", () => {
  test("documents limitations and data sources", async ({ page }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { name: "Data sources" })).toBeVisible();
    await expect(page.getByText(/Predictions, not measurements/i)).toBeVisible();
    await expect(page.getByText(/Not for collision avoidance/i)).toBeVisible();
  });
});

test.describe("whole-sky globe", () => {
  test("the active-catalog API serves the full sky with compact propagation-ready rows", async ({ page }) => {
    // The provider is the live dependency; a rate-limited IP gets the typed
    // provider failure (honest 502, no fabricated sky). Both states assert
    // their shape — full data must be compact and complete wherever it is
    // present.
    const res = await page.request.get("/api/sky/catalog", { timeout: 120_000 });
    const body = (await res.json()) as {
      ok: boolean;
      data?: { stale: boolean; count: number; entries: Record<string, unknown>[] };
      error?: { kind: string; message: string };
    };
    if (body.ok) {
      const data = body.data!;
      expect(data.count).toBeGreaterThanOrEqual(5_000);
      expect(data.entries).toHaveLength(data.count);
      const first = data.entries[0]; // noUncheckedIndexedAccess
      // Compact shape: catalog number, name, both TLE lines — and nothing else.
      expect(Object.keys(first!).sort()).toEqual(["i", "l1", "l2", "n"]);
      expect(String(first!.l1)).toMatch(/^1 \d{5}/);
      expect(String(first!.l2)).toMatch(/^2 \d{5}/);
    } else {
      expect(res.status()).toBe(502);
      expect(body.error?.kind).toBe("provider");
    }
  });

  test("the whole-sky toggle keeps the orbit view honest on any GPU outcome", async ({ page }) => {
    // Environments differ: headless runners often lack WebGL entirely. What
    // must hold everywhere: no crashes on toggle, and either the animated
    // cloud commentary or the honest 3D-unavailable fallback — never blank.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto("/");
    await expect(page.getByRole("slider")).toBeEnabled({ timeout: 60_000 });
    // The toggle starts "on" (the hero visual); flip it both ways.
    await page.getByRole("button", { name: "Whole sky: on" }).click();
    await page.getByRole("button", { name: "Whole sky: off" }).click();
    // WebGL available: Cesium's canvas renders. WebGL off: the parent's honest
    // 2D fallback. Both are acceptable, named outcomes — the "couldn't start"
    // panel is not: it means the 3D runtime itself is broken.
    await expect(
      page.locator('[aria-label^="3D globe showing"] canvas').or(page.locator('[data-testid="ground-track-marker"]')).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="globe-failed"]')).toHaveCount(0);
    // Cesium reports render-loop failures in its own panel, not as page
    // errors — a date-line geometry crash once froze the globe this way.
    await page.waitForTimeout(15_000);
    await expect(page.locator(".cesium-widget-errorPanel")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
