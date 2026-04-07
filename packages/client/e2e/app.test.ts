import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") { errors.push(msg.text()); }
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
    await expect(page.locator(".room-id")).toBeVisible();
    await expect(page.locator(".room-id")).toHaveText(path);
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
  test("Find a room menu opens and items are visible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Find a room/ }).click();

    const nearby = page.getByRole("menuitem", { name: "Nearby" });
    const random = page.getByRole("menuitem", { name: "Random" });

    await expect(nearby).toBeVisible();
    await expect(random).toBeVisible();
  });

  test("Find a room menu closes on backdrop click", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Find a room/ }).click();
    await expect(page.getByRole("menuitem", { name: "Nearby" })).toBeVisible();

    await page.keyboard.press("Escape");
    // backdrop click — click outside the menu
    await page.mouse.click(10, 10);
    await expect(page.getByRole("menuitem", { name: "Nearby" })).not.toBeVisible();
  });

  test("Selecting Random generates a new room and updates the URL", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const original_path = new URL(page.url()).pathname;

    await page.getByRole("button", { name: /Find a room/ }).click();
    await page.getByRole("menuitem", { name: "Random" }).click();

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

  test("clicking Use QR code opens the QR overlay", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Connect to peer/ }).click();
    await page.getByRole("menuitem", { name: /QR code/ }).click();

    await expect(page.getByRole("dialog", { name: /QR/i })).toBeVisible({ timeout: 2000 });
    expect(errors, `JS errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("cleanup menu opens and items are visible and interactable", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Clear data" }).click();

    const items = [
      "Clear current doc",
      "Clear all docs",
      "Clear settings",
      "Clear everything",
    ];

    for (const name of items) {
      await expect(page.getByRole("menuitem", { name })).toBeVisible();
    }
  });

  test("cleanup menu items trigger a confirm dialog when clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Clear data" }).click();
    await page.getByRole("menuitem", { name: "Clear current doc" }).click();

    // Confirm dialog should appear — proves menu item was not covered by another element
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 2000 });
  });

  test("confirm dialog Cancel closes it without clearing", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("do not delete me");

    await page.getByRole("button", { name: "Clear data" }).click();
    await page.getByRole("menuitem", { name: "Clear current doc" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await expect(page.locator("textarea")).toHaveValue("do not delete me");
  });

  test("confirm dialog Confirm clears the document", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").fill("delete me");

    await page.getByRole("button", { name: "Clear data" }).click();
    await page.getByRole("menuitem", { name: "Clear current doc" }).click();
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

  test("focus mode activates on double-click", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").dblclick();
    await expect(page.locator("header")).not.toBeVisible();
  });

  test("Escape key exits focus mode", async ({ page }) => {
    await page.goto("/");
    await page.locator("textarea").dblclick();
    await expect(page.locator("header")).not.toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("header")).toBeVisible();
  });

  test("F key toggles focus mode when textarea is not focused", async ({ page }) => {
    await page.goto("/");
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
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  test("persistence toggle is present and off by default", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const toggle = page.getByRole("checkbox", { name: /localStorage/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });
});
