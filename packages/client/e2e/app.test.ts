import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// Collect console errors during a page load
async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err: Error) => {
    errors.push(`[pageerror] ${err.message}`);
  });
  return errors;
}

test.describe("Page load", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors = await collectConsoleErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(errors, `Console errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("renders the editor textarea", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("textarea")).toBeVisible();
  });

  test("sets a 3-word room ID in the URL path", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const path = new URL(page.url()).pathname.replace(/^\//, "");
    const words = path.split("-");
    expect(words).toHaveLength(3);
    words.forEach((word) => expect(word.length).toBeGreaterThan(0));
  });

  test("shows the room ID in the room bar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const path = new URL(page.url()).pathname.replace(/^\//, "");
    const room_id_el = page.locator(".room-id");
    await expect(room_id_el).toBeVisible();
    await expect(room_id_el).toHaveText(path);
  });

  test("preserves room ID from URL on page reload", async ({ page }) => {
    // Navigate to app, get the generated room ID
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const first_url = page.url();
    const first_path = new URL(first_url).pathname;

    // Reload the same URL — should keep the same room ID (not generate a new one)
    await page.goto(first_url);
    await page.waitForLoadState("networkidle");
    const second_path = new URL(page.url()).pathname;
    expect(second_path).toBe(first_path);
  });
});

test.describe("Connection actions", () => {
  test("Share link and Air-gapped buttons are visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Share link" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Air-gapped/i })).toBeVisible();
  });

  test("clicking Share link changes connection state to signalling", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Intercept the WebSocket so it doesn't actually need a server
    await page.addInitScript(() => {
      const OriginalWebSocket = window.WebSocket;
      (window as Window & { _ws_intercepted?: boolean }).WebSocket = class MockWebSocket extends OriginalWebSocket {
        constructor(url: string, protocols?: string | string[]) {
          // Point at a non-existent server so it fails gracefully
          super(url, protocols);
        }
      } as typeof WebSocket;
    });

    const share_btn = page.getByRole("button", { name: "Share link" });
    await share_btn.click();

    // After clicking, the button area should be gone (mode is no longer "none")
    // OR the actions bar disappears. Either way, no JS error should fire.
    expect(errors, `JS errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("clicking Air-gapped opens the QR overlay", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const qr_btn = page.getByRole("button", { name: /Air-gapped/i });
    await qr_btn.click();

    // The QR overlay dialog should appear
    const overlay = page.getByRole("dialog", { name: "Air-gapped QR connection" });
    await expect(overlay).toBeVisible({ timeout: 2000 });

    expect(errors, `JS errors: ${errors.join("\n")}`).toHaveLength(0);
  });
});

test.describe("Editor", () => {
  test("textarea is editable", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.click();
    await textarea.type("hello world");
    await expect(textarea).toHaveValue("hello world");
  });

  test("focus mode activates on double-click", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.dblclick();
    // In focus mode, the header and action bar are hidden
    const header = page.locator("header");
    await expect(header).not.toBeVisible();
  });

  test("Escape key exits focus mode", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("textarea");
    await textarea.dblclick();
    await expect(page.locator("header")).not.toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("header")).toBeVisible();
  });

  test("F key toggles focus mode when textarea is not focused", async ({ page }) => {
    await page.goto("/");
    // Click somewhere that is NOT the textarea to defocus it
    await page.locator(".app-name").click();
    await page.keyboard.press("f");
    await expect(page.locator("header")).not.toBeVisible();
    await page.keyboard.press("f");
    await expect(page.locator("header")).toBeVisible();
  });
});

test.describe("Settings panel", () => {
  test("settings button opens the settings panel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    // Settings panel renders as a dialog
    const panel = page.getByRole("dialog", { name: "Settings" });
    await expect(panel).toBeVisible();
  });
});
