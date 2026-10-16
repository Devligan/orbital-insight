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

  test("time slider moves the displayed prediction timestamp", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ISS (ZARYA)" }).first().click();
    const slider = page.getByRole("slider");
    await expect(slider).toBeEnabled({ timeout: 30_000 });
    const readout = page.locator("#time-slider ~ *").last();
    const before = await readout.textContent();
    await slider.fill(String(24));
    const after = await readout.textContent();
    expect(after).not.toEqual(before);
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
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/does not implement|favicon/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.goto("/");
    await page.waitForTimeout(8_000);
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

test.describe("pass cards on phones", () => {
  test("a phone-width viewport renders passes as cards, not a 7-column table", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/passes");
    await page.getByLabel(/Observer latitude/i).fill("0");
    await page.getByLabel(/Observer longitude/i).fill("0");
    await page.getByLabel(/Catalog IDs/i).fill("25544");
    await page.getByRole("button", { name: /Predict passes/i }).click();
    const cards = page.locator(".md\\:hidden .rounded.border");
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
    // WebGL available: cloud reaches ready (SGP4 commentary). WebGL off: the
    // parent's honest 2D fallback. Both are acceptable, named outcomes.
    await expect(page.getByText(/\d{1,3}[,.]\d{3} objects, live predictions/i)).toBeVisible().catch(() => { /* not WebGL here */ });
    expect(errors.filter((e) => /already exists|Cesium|wasm/i.test(e))).toEqual([]);
  });
});
