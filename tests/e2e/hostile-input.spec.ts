/**
 * Hostile input: what a curious or malicious visitor can feed the app without
 * an account. That means hand-edited localStorage, mutated share links, junk
 * route params, and markup typed into search. Each case must render a page,
 * raise no uncaught error, open no dialog (an executed alert() is a dialog),
 * and never answer with a 5xx.
 *
 * Local-only by design: nothing here sends load to production, Vercel, or
 * CelesTrak.
 */

import { expect, test, type Page } from "@playwright/test";

const XSS = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;

/** Fails the test on any uncaught page error or dialog from here on. */
function guard(page: Page): { pageErrors: string[]; dialogs: string[] } {
  const seen = { pageErrors: [] as string[], dialogs: [] as string[] };
  page.on("pageerror", (error) => seen.pageErrors.push(error.message));
  page.on("dialog", (dialog) => {
    seen.dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
}

function seed(page: Page, entries: Record<string, string>) {
  return page.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) window.localStorage.setItem(key, value);
  }, entries);
}

test.describe("tampered localStorage", () => {
  test("a hand-edited watchlist renders only real catalog entries, as text", async ({ page }) => {
    const seen = guard(page);
    await seed(page, {
      "orbital-insight.watchlist": JSON.stringify([
        { satelliteNumber: "../../api/passes", name: "path traversal", addedAt: "2026-11-20T00:00:00Z" },
        { satelliteNumber: "25544", name: XSS, addedAt: "not a date" },
        { satelliteNumber: "25544", name: "duplicate key" },
        "junk",
        null,
        { satelliteNumber: "20580", name: "A".repeat(10_000), addedAt: "2026-11-20T00:00:00Z" },
      ]),
    });
    await page.goto("/watchlist");

    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(XSS); // shown as text, never parsed
    await expect(rows.nth(0)).toContainText("unknown"); // not "Invalid Date"
    await expect(page.locator("table img")).toHaveCount(0);
    const hrefs = await page.locator("table a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["/satellites/25544", "/satellites/20580"]);
    expect((await rows.nth(1).locator("a").textContent())?.length).toBe(120);

    // A tampered list still feeds /passes only catalog numbers.
    await page.goto("/passes");
    await expect(page.getByRole("button", { name: /^\+ / }).filter({ hasText: "path traversal" })).toHaveCount(0);

    expect(seen).toEqual({ pageErrors: [], dialogs: [] });
  });

  test("corrupt or non-list watchlist data reads as an empty list", async ({ page }) => {
    const seen = guard(page);
    for (const value of ["{not json", '{"satelliteNumber":"25544"}', "null", '"25544"']) {
      await seed(page, { "orbital-insight.watchlist": value });
      await page.goto("/watchlist");
      await expect(page.getByText("No saved satellites yet")).toBeVisible();
    }
    expect(seen).toEqual({ pageErrors: [], dialogs: [] });
  });

  test("an impossible remembered spot is ignored, not used", async ({ page }) => {
    const seen = guard(page);
    await seed(page, {
      "orbital-insight:observer:v1": JSON.stringify({ lat: 999, lon: -999, source: "manual", label: XSS }),
    });
    await page.goto("/passes");
    // Falls back to the default spot rather than sending lat 999 anywhere.
    await expect(page.getByTestId("passes-spot")).toHaveText("London, England, United Kingdom");
    await expect(page.getByLabel(/^Latitude/)).toHaveValue("51.5072");
    expect(seen).toEqual({ pageErrors: [], dialogs: [] });
  });

  test("blocked storage doesn't take the page down", async ({ page }) => {
    const seen = guard(page);
    // Safari and Firefox throw SecurityError on any storage access when site data is blocked.
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      Object.defineProperty(Storage.prototype, "getItem", { value: blocked });
      Object.defineProperty(Storage.prototype, "setItem", { value: blocked });
    });
    await page.goto("/watchlist");
    await expect(page.getByText("No saved satellites yet")).toBeVisible();
    await page.goto("/satellites/25544");
    await expect(page.locator("main")).toBeVisible();
    expect(seen).toEqual({ pageErrors: [], dialogs: [] });
  });
});

test.describe("mutated share links and route params", () => {
  const urls = [
    `/?cat=${encodeURIComponent(XSS)}&t=-5`,
    "/?cat=25544&t=1e309",
    "/?cat=25544&t=NaN",
    "/?cat=99999&t=99999999",
    "/?cat=25544&cat=20580&t=1&t=2", // repeated params arrive as arrays
    "/conjunctions?id=abc",
    `/conjunctions?id=${encodeURIComponent(XSS)}`,
    "/conjunctions?id=99999999999999999999",
    "/satellites/abc",
    `/satellites/${encodeURIComponent(XSS)}`,
    "/satellites/99999999999999999999",
  ];

  for (const url of urls) {
    test(`renders ${url.slice(0, 60)} without a crash or a script`, async ({ page }) => {
      const seen = guard(page);
      const response = await page.goto(url);
      expect(response?.status() ?? 0).toBeLessThan(500);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(1_500); // let client effects (link step, catalog load) run
      expect(seen).toEqual({ pageErrors: [], dialogs: [] });
      // The markup never became elements.
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
    });
  }
});

test.describe("markup typed into inputs", () => {
  test("satellite search and the place box treat markup as text", async ({ page }) => {
    const seen = guard(page);
    await page.route("https://geocoding-api.open-meteo.com/**", (route) => route.fulfill({ json: { results: [] } }));
    await page.goto("/");
    await page.getByPlaceholder("Search satellites").fill(XSS);
    await page.getByRole("region", { name: "What's in the sky" }).getByTestId("place-search").fill(XSS);
    await page.waitForTimeout(800);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(seen).toEqual({ pageErrors: [], dialogs: [] });
  });
});
