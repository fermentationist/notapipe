import { test, expect } from "@playwright/test";

type PageType = import("@playwright/test").Page;

// Stub: navigator.share resolves immediately (simulates a successful share).
// The share sheet never actually appears in the test browser; tests that use
// this stub verify the call was made and the dialog closed.
async function stubShareSucceeds(page: PageType): Promise<void> {
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
  });
}

// Stub: navigator.share throws TypeError (simulates "file sharing not supported").
// Tests that use this stub verify the download fallback runs.
async function stubShareThrows(page: PageType): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: async () => { throw new TypeError("Share not supported"); },
      writable: false,
      configurable: true,
    });
  });
}

// Stub: navigator.share throws AbortError (simulates user dismissing the sheet).
// No download should occur.
async function stubShareAborted(page: PageType): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: async () => {
        const err = new DOMException("Share aborted", "AbortError");
        throw err;
      },
      writable: false,
      configurable: true,
    });
  });
}

async function openShareMenu(page: PageType): Promise<void> {
  await page.getByRole("button", { name: "Share", exact: true }).click();
}

test.describe("FilenameDialog — Share document as file", () => {
  test("opens filename dialog when 'Share document as file' is clicked", async ({ page }) => {
    await stubShareSucceeds(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    await expect(page.getByRole("dialog", { name: "Set filename" })).toBeVisible();
  });

  test("filename input is pre-filled with room-id.txt", async ({ page }) => {
    await stubShareSucceeds(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const room_id = new URL(page.url()).pathname.replace(/^\//, "");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    await expect(page.locator("#filename-input")).toHaveValue(`${room_id}.txt`);
  });

  test("typing appends characters — does not replace on each keystroke", async ({ page }) => {
    await stubShareSucceeds(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const input = page.locator("#filename-input");
    await input.fill("notes.md");
    await input.press("End");
    await input.type("xy");

    await expect(input).toHaveValue("notes.mdxy");
  });

  test("navigator.share() is called with the user-supplied filename", async ({ page }) => {
    await stubShareSucceeds(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const dialog = page.getByRole("dialog", { name: "Set filename" });
    await dialog.locator("#filename-input").fill("my-notes.md");
    await dialog.getByRole("button", { name: "Share" }).click();

    await expect(dialog).not.toBeVisible({ timeout: 2000 });

    const share_calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__share_calls,
    ) as Array<{ filenames: string[] }>;
    expect(share_calls).toHaveLength(1);
    expect(share_calls[0].filenames).toEqual(["my-notes.md"]);
  });

  test("falls back to download when navigator.share() throws", async ({ page }) => {
    await stubShareThrows(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const download_promise = page.waitForEvent("download");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const dialog = page.getByRole("dialog", { name: "Set filename" });
    await dialog.locator("#filename-input").fill("export.md");
    await dialog.getByRole("button", { name: "Share" }).click();

    const download = await download_promise;
    expect(download.suggestedFilename()).toBe("export.md");
  });

  test("no download when user dismisses share sheet (AbortError)", async ({ page }) => {
    await stubShareAborted(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const dialog = page.getByRole("dialog", { name: "Set filename" });
    await dialog.locator("#filename-input").fill("notes.md");

    // Trigger share and expect dialog to close, no download event
    let download_fired = false;
    page.on("download", () => { download_fired = true; });

    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
    expect(download_fired).toBe(false);
  });

  test("Cancel button closes the dialog without triggering a download", async ({ page }) => {
    await stubShareSucceeds(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    await expect(page.getByRole("dialog", { name: "Set filename" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog", { name: "Set filename" })).not.toBeVisible();
  });

  test("Escape key closes the dialog without triggering a download", async ({ page }) => {
    await stubShareSucceeds(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    await expect(page.getByRole("dialog", { name: "Set filename" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Set filename" })).not.toBeVisible();
  });

  test("Enter key confirms with current filename", async ({ page }) => {
    await stubShareThrows(page);
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

  // Regression: canShare() returning false (or not existing) must not prevent
  // navigator.share() from being called. Previously the code used canShare() as
  // a gate, so on browsers where canShare() is absent/false but share() works,
  // the share sheet was silently skipped and only a download occurred.
  test("regression: navigator.share() is called even when canShare() returns false", async ({ page }) => {
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
      // canShare explicitly returns false — share() should still be called
      Object.defineProperty(navigator, "canShare", {
        value: () => false,
        writable: false,
        configurable: true,
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openShareMenu(page);
    await page.getByRole("menuitem", { name: "Share document as file" }).click();

    const dialog = page.getByRole("dialog", { name: "Set filename" });
    await dialog.locator("#filename-input").fill("notes.md");
    await dialog.getByRole("button", { name: "Share" }).click();

    await expect(dialog).not.toBeVisible({ timeout: 2000 });

    const share_calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__share_calls,
    ) as Array<{ filenames: string[] }>;
    expect(share_calls).toHaveLength(1);
    expect(share_calls[0].filenames).toEqual(["notes.md"]);
  });
});
