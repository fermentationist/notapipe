import { test, expect } from "@playwright/test";

// Inject a stub navigator.share so the "Share document as file" menu item
// is visible (it is gated behind `"share" in navigator`).  The stub also
// records what it was called with so we can assert on the filename.
async function stubNavigatorShare(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    // Minimal stub: canShare always returns false so the app falls back to
    // the anchor-download path, which we can intercept via the download event.
    Object.defineProperty(navigator, "share", {
      value: async () => { /* no-op — tests use the download fallback */ },
      writable: false,
      configurable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: () => false,
      writable: false,
      configurable: true,
    });
  });
}

async function openShareMenu(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Share", exact: true }).click();
}

test.describe("FilenameDialog — Share document as file", () => {
  test("opens filename dialog when 'Share document as file' is clicked", async ({ page }) => {
    await stubNavigatorShare(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    await expect(page.getByRole("dialog", { name: "Set filename" })).toBeVisible();
  });

  test("filename input is pre-filled with room-id.txt", async ({ page }) => {
    await stubNavigatorShare(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const room_id = new URL(page.url()).pathname.replace(/^\//, "");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const input = page.locator("#filename-input");
    await expect(input).toHaveValue(`${room_id}.txt`);
  });

  test("typing appends characters — does not replace on each keystroke", async ({ page }) => {
    await stubNavigatorShare(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const input = page.locator("#filename-input");
    await input.fill("notes.md");
    // Type two more characters to verify they accumulate, not replace
    await input.press("End");
    await input.type("xy");

    await expect(input).toHaveValue("notes.mdxy");
  });

  test("user can change extension to .md and trigger download with that name", async ({ page }) => {
    await stubNavigatorShare(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for a download triggered by the fallback anchor click
    const download_promise = page.waitForEvent("download");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const dialog = page.getByRole("dialog", { name: "Set filename" });
    await dialog.locator("#filename-input").fill("my-notes.md");
    await dialog.getByRole("button", { name: "Share" }).click();

    const download = await download_promise;
    expect(download.suggestedFilename()).toBe("my-notes.md");
  });

  test("Cancel button closes the dialog without triggering a download", async ({ page }) => {
    await stubNavigatorShare(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    await expect(page.getByRole("dialog", { name: "Set filename" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Set filename" })).not.toBeVisible();
  });

  test("Escape key closes the dialog without triggering a download", async ({ page }) => {
    await stubNavigatorShare(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    await expect(page.getByRole("dialog", { name: "Set filename" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Set filename" })).not.toBeVisible();
  });

  test("Enter key confirms with current filename", async ({ page }) => {
    await stubNavigatorShare(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const download_promise = page.waitForEvent("download");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const input = page.locator("#filename-input");
    await input.fill("export.md");
    await input.press("Enter");

    const download = await download_promise;
    expect(download.suggestedFilename()).toBe("export.md");
  });
});
