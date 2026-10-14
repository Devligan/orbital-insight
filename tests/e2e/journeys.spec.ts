import { expect, test } from "@playwright/test";

/**
 * Critical user journeys (no sign-in required at any step).
 * These tests exercise the real app over HTTP against the production build.
 * The public CelesTrak provider is the live dependency; assertions are
 * written to distinguish "app worked" from "provider marked down", so outage
 * behavior is verifiable honestly rather than flaky-red.
 */

test.describe("explorer journey", () => {
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
    // Real data pipeline ends in the info panel: characteristics + provenance.
    await expect(page.getByText(/Element epoch:/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Retrieved:/i)).toBeVisible();
    await expect(page.getByText(/Position shown is an SGP4 prediction/i)).toBeVisible();
  });

  test("time slider moves the displayed prediction timestamp", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "ISS (ZARYA)" }).first().click();
    await expect(page.getByText(/Element epoch:/i)).toBeVisible({ timeout: 30_000 });
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
    await expect(page).toHaveURL(/\/satellites\/\d+$/);
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

  test("overhead widget computes what's above a manual location", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /What's above you now/i })).toBeVisible();
    await page.getByLabel("Manual latitude").fill("28.5");
    await page.getByLabel("Manual longitude").fill("-80.6");
    await page.getByRole("button", { name: "Go" }).click();
    // Either named objects (stations above 15°) or the honest none-message —
    // never a spinner-forever state.
    await expect(page.getByText(/ISS|CSS|Nothing from the bright/i).first()).toBeVisible({ timeout: 30_000 });
    // The widget's own observer line — deliberately specific (other fallback
    // paragraphs on the share the word "computed").
    await expect(page.getByText(/Observer 28\.50°/)).toBeVisible({ timeout: 10_000 });
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
    // The globe failure message appears — an honest failure, not a spinner forever.
    await expect(page.getByText(/showing the computed 2D ground track/i)).toBeVisible({ timeout: 60_000 });
    // And the computed 2D ground track actually swaps in.
    await expect(page.locator("svg[role=img]").first()).toBeVisible({ timeout: 30_000 });
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
});

test.describe("methodology page", () => {
  test("documents limitations and data sources", async ({ page }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { name: "Data sources" })).toBeVisible();
    await expect(page.getByText(/Predictions, not measurements/i)).toBeVisible();
    await expect(page.getByText(/Not for collision avoidance/i)).toBeVisible();
  });
});
