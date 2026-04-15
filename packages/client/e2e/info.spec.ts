import { test, expect } from "@playwright/test";

test.describe("/info page", () => {
  test("serves the info marketing page at /info", async ({ page }) => {
    const response = await page.goto("/info");
    expect(response?.status()).toBe(200);
    // The info page has a distinct title — confirms we got the right document
    await expect(page).toHaveTitle(/notapipe/);
    // The Svelte app injects a <textarea> — the info page must NOT have one
    await expect(page.locator("textarea")).toHaveCount(0);
  });

  test("serves the info page at /info/ (trailing slash)", async ({ page }) => {
    const response = await page.goto("/info/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("textarea")).toHaveCount(0);
  });

  test("does not redirect /info to a random room", async ({ page }) => {
    await page.goto("/info");
    // If the SPA caught it, it would replace the URL with a 3-word room path
    expect(page.url()).toMatch(/\/info\/?$/);
  });
});
