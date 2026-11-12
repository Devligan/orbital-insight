import { expect, test, type Page } from "@playwright/test";

/**
 * Deployment smoke tests — run by post-deploy.yml against every Vercel
 * deployment (E2E_BASE_URL), and locally with the rest of the suite.
 *
 * Read-only and quick. Unlike the journeys, these are strict about data: a
 * deployment that cannot serve the sky is a broken deployment, whatever the
 * reason. The headline check is "no uncaught page errors": the globe once
 * shipped to production with a minifier-mangled chunk that threw a
 * SyntaxError on load while every other test was green.
 */

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test.describe("deployment smoke", () => {
  test("home renders the hero and the globe without uncaught errors", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The globe mounts lazily once visible; its canvas proves the Cesium
    // chunk loaded and parsed (the exact failure that once shipped).
    await expect(page.locator('[aria-label^="3D globe showing"] canvas')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
    expect(errors).toEqual([]);
  });

  test("the whole-sky catalog API serves the full active catalog", async ({ request }) => {
    const response = await request.get("/api/sky/catalog");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBeGreaterThan(5_000);
    expect(Date.now() - Date.parse(body.data.generatedAt)).toBeLessThan(48 * 60 * 60 * 1000);
  });

  test("a satellite detail page serves real elements", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/satellites/25544");
    await expect(page.getByRole("heading", { name: /ISS/ })).toBeVisible();
    await expect(page.getByText(/Element epoch/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the atlas charts the catalog", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/atlas");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("atlas-plot")).toHaveAttribute("data-plotted", /^[1-9]\d{3,}$/, { timeout: 60_000 });
    expect(errors).toEqual([]);
  });

  test("methodology is reachable", async ({ page }) => {
    await page.goto("/methodology");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
