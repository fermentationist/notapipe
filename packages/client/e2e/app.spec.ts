import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// Service worker registration fails with SSL errors on self-signed certs (dev/test only).
// These are not app bugs — filter them so they don't mask real errors.
const SW_NOISE_PATTERN = /SSL certificate error|service worker|ServiceWorker/i;

async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" && !SW_NOISE_PATTERN.test(msg.text())) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err: Error) => {
    if (!SW_NOISE_PATTERN.test(err.message)) {
      errors.push(`[pageerror] ${err.message}`);
    }
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
    await expect(page.locator(".room-name-btn")).toBeVisible();
    await expect(page.locator(".room-name-btn")).toHaveText(path);
  });

  test("preserves room ID from URL on reload", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const first_url = page.url();
    await page.goto(first_url);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe(new URL(first_url).pathname);
  });
});

test.describe("Dropdown menus", () => {
  test("Room menu opens and shows New random room item", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator(".room-name-btn").click();

    await expect(page.getByRole("menuitem", { name: "New random room" })).toBeVisible();
  });

  test("Room menu closes on backdrop click", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator(".room-name-btn").click();
    await expect(page.getByRole("menuitem", { name: "New random room" })).toBeVisible();

    // backdrop click — click outside the menu
    await page.mouse.click(10, 10);
    await expect(page.getByRole("menuitem", { name: "New random room" })).not.toBeVisible();
  });

  test("Selecting New random room generates a new room and updates the URL", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const original_path = new URL(page.url()).pathname;

    await page.locator(".room-name-btn").click();
    await page.getByRole("menuitem", { name: "New random room" }).click();

    // URL should change to a new random room
    await expect(async () => {
      expect(new URL(page.url()).pathname).not.toBe(original_path);
    }).toPass({ timeout: 3000 });
  });

  test("Connect to peer menu opens and items are visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Connect to peer/ }).click();

    const signalling = page.getByRole("menuitem", { name: "Use signalling server" });
    const qr = page.getByRole("menuitem", { name: /QR code/ });

    await expect(signalling).toBeVisible();
    await expect(qr).toBeVisible();
  });

  test("clicking Use QR code opens the QR overlay with role selection", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => { if (!SW_NOISE_PATTERN.test(err.message)) { errors.push(err.message); } });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Connect to peer/ }).click();
    await page.getByRole("menuitem", { name: /QR code/ }).click();

    const dialog = page.getByRole("dialog", { name: /QR/i });
    await expect(dialog).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole("button", { name: /Show my QR/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Scan their QR/ })).toBeVisible();
    expect(errors, `JS errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("QR canvas renders after choosing offerer role", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => { if (!SW_NOISE_PATTERN.test(err.message)) { errors.push(err.message); } });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Connect to peer/ }).click();
    await page.getByRole("menuitem", { name: /QR code/ }).click();
    await page.getByRole("button", { name: /Show my QR/ }).click();

    // Wait for the canvas to appear — it only renders once packet !== null,
    // which happens after iceGatheringState === "complete" or the 15s timeout.
    // ICE gathering in headless Chromium typically completes in < 2s for host candidates.
    const qr_canvas = page.locator(".qr-canvas");
    await expect(qr_canvas).toBeVisible({ timeout: 20_000 });

    // Verify the canvas has actually been painted (not just blank white pixels)
    const has_content = await qr_canvas.evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return false;
      }
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const first_pixel = data[0];
      return Array.from(data).some((byte) => byte !== first_pixel);
    });

    expect(has_content, "QR canvas should have rendered content, not a blank image").toBe(true);
    expect(errors, `JS errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("choosing answerer role opens the camera immediately", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => { if (!SW_NOISE_PATTERN.test(err.message)) { errors.push(err.message); } });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Connect to peer/ }).click();
    await page.getByRole("menuitem", { name: /QR code/ }).click();

    // Choosing "Scan first" should go straight to the camera view.
    // In Playwright there's no real camera, so we expect a camera error or the video element.
    await page.getByRole("button", { name: /Scan their QR/ }).click();

    // Either the video element appears (camera granted) or an error message (camera denied)
    // — either way, the scan step rendered without a JS crash.
    await expect(page.locator(".camera-preview, .error")).toBeVisible({ timeout: 5000 });

    expect(errors, `JS errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("cleanup menu opens and items are visible and interactable", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Actions" }).click();

    const items = ["Clear current document", "Clear all documents", "Clear settings", "Clear everything"];

    for (const name of items) {
      await expect(page.getByRole("menuitem", { name })).toBeVisible();
    }
  });

  test("cleanup menu items trigger a confirm dialog when clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Clear current document" }).click();

    // Confirm dialog should appear — proves menu item was not covered by another element
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 2000 });
  });

  test("confirm dialog Cancel closes it without clearing", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("do not delete me");

    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Clear current document" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await expect(page.locator("textarea")).toHaveValue("do not delete me");
  });

  test("confirm dialog Confirm clears the document", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("delete me");

    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Clear current document" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await expect(page.locator("textarea")).toHaveValue("");
  });
});

test.describe("Editor", () => {
  test("textarea is editable", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("hello world");
    await expect(page.locator("textarea")).toHaveValue("hello world");
  });

  test("focus mode button enters focus mode", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Enter focus mode" }).click();
    await expect(page.locator("header")).not.toBeVisible();
  });

  test("Escape key exits focus mode", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Enter focus mode" }).click();
    await expect(page.locator("header")).not.toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("header")).toBeVisible();
  });

  test("focus mode button exits focus mode when active", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Enter focus mode" }).click();
    await expect(page.locator("header")).not.toBeVisible();
    await page.getByRole("button", { name: "Exit focus mode" }).click();
    await expect(page.locator("header")).toBeVisible();
  });

  test("Cmd+F toggles focus mode", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+f");
    await expect(page.locator("header")).not.toBeVisible();
    await page.keyboard.press("Meta+f");
    await expect(page.locator("header")).toBeVisible();
  });
});

test.describe("Settings panel", () => {
  test("settings button opens the settings panel", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  test("persistence toggle is present and off by default", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const toggle = page.getByRole("checkbox", { name: /Save document/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });
});

test.describe("Signalling connection state", () => {
  test("shows 'waiting for peer' after connecting via signalling server", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Connect to peer/ }).click();
    await page.getByRole("menuitem", { name: "Use signalling server" }).click();

    // Once joined the room with no other peer present, status should say "waiting for peer…"
    await expect(page.locator(".status-label")).toHaveText("waiting for peer…", { timeout: 5000 });
  });
});
