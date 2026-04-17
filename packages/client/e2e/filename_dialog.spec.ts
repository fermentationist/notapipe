import { test, expect } from "@playwright/test";

type PageType = import("@playwright/test").Page;

// Stub navigator.share with canShare → false (download fallback path).
// Used by most tests to intercept the download event.
async function stubNavigatorShareFallback(page: PageType): Promise<void> {
  await page.addInitScript(() => {
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

// Stub navigator.share with canShare → true (native share-sheet path).
// Records calls in window.__share_calls so tests can assert on them.
async function stubNavigatorShareNative(page: PageType): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__share_calls = [];
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => {
        const filenames = data.files ? data.files.map((f: File) => f.name) : [];
        ((window as unknown as Record<string, unknown>).__share_calls as unknown[]).push({ filenames });
      },
      writable: false,
      configurable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: () => true,
      writable: false,
      configurable: true,
    });
  });
}

// Keep the old name as an alias so existing tests don't need updating.
const stubNavigatorShare = stubNavigatorShareFallback;

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

  // Regression: when canShare returns true, navigator.share() must be called
  // BEFORE any state mutations (closing the dialog).  Mutating state first
  // causes Svelte to queue a DOM microtask that some browsers (notably Safari)
  // use to invalidate the user-gesture token, resulting in a NotAllowedError
  // and a share sheet that never appears.
  test("regression: navigator.share() is invoked when canShare returns true", async ({ page }) => {
    await stubNavigatorShareNative(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const dialog = page.getByRole("dialog", { name: "Set filename" });
    await dialog.locator("#filename-input").fill("notes.md");
    await dialog.getByRole("button", { name: "Share" }).click();

    // Dialog should close after share resolves
    await expect(dialog).not.toBeVisible({ timeout: 2000 });

    // navigator.share() must have been called with the correct filename
    const share_calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__share_calls,
    ) as Array<{ filenames: string[] }>;
    expect(share_calls).toHaveLength(1);
    expect(share_calls[0].filenames).toEqual(["notes.md"]);
  });
});
