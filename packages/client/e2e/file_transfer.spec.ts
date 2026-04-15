import { test, expect, type Browser } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const CONNECTION_TIMEOUT = 20_000;
const TRANSFER_TIMEOUT = 15_000;

async function openPeer(browser: Browser) {
  return browser.newContext({ ignoreHTTPSErrors: true });
}

async function connectViaSignalling(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Connect to peer/ }).click();
  await page.getByRole("menuitem", { name: "Use signalling server" }).click();
}

async function waitForConnected(page: import("@playwright/test").Page) {
  await expect(page.locator(".status-label")).toContainText("connected", {
    timeout: CONNECTION_TIMEOUT,
  });
}

// Creates a small temp file and returns its path. Cleaned up in afterEach.
function makeTempFile(content: string, filename: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notapipe-ft-"));
  const file_path = path.join(dir, filename);
  fs.writeFileSync(file_path, content, "utf8");
  return file_path;
}

test.describe("File transfer — send → accept → save", () => {
  test("sender sees pending strip; receiver sees offer strip", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);
    const tmp_path = makeTempFile("hello from notapipe", "test.txt");

    try {
      const page_a = await ctx_a.newPage();
      const page_b = await ctx_b.newPage();

      await page_a.goto("/");
      await page_a.waitForLoadState("networkidle");
      const room_url = page_a.url();

      await connectViaSignalling(page_a);
      await page_b.goto(room_url);
      await page_b.waitForLoadState("networkidle");
      await connectViaSignalling(page_b);

      await waitForConnected(page_a);
      await waitForConnected(page_b);

      // Trigger file selection on peer A via the hidden input.
      await page_a.locator("#file-transfer-input").setInputFiles(tmp_path);

      // Peer A should show a "waiting" pending strip.
      await expect(page_a.locator(".strip.pending").filter({ hasText: "test.txt" })).toBeVisible({
        timeout: TRANSFER_TIMEOUT,
      });

      // Peer B should see an incoming offer strip.
      await expect(page_b.locator(".strip.incoming").filter({ hasText: "test.txt" })).toBeVisible({
        timeout: TRANSFER_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
      fs.rmSync(path.dirname(tmp_path), { recursive: true, force: true });
    }
  });

  test("receiver clicks Save and file completes", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);
    const tmp_path = makeTempFile("transfer content abc123", "payload.txt");

    try {
      const page_a = await ctx_a.newPage();
      const page_b = await ctx_b.newPage();

      await page_a.goto("/");
      await page_a.waitForLoadState("networkidle");
      const room_url = page_a.url();

      await connectViaSignalling(page_a);
      await page_b.goto(room_url);
      await page_b.waitForLoadState("networkidle");
      await connectViaSignalling(page_b);

      await waitForConnected(page_a);
      await waitForConnected(page_b);

      // Send the file from peer A.
      await page_a.locator("#file-transfer-input").setInputFiles(tmp_path);

      // Wait for offer to appear on peer B, then accept it.
      const offer_strip = page_b.locator(".strip.incoming").filter({ hasText: "payload.txt" });
      await expect(offer_strip).toBeVisible({ timeout: TRANSFER_TIMEOUT });
      await offer_strip.getByRole("button", { name: "Save" }).click();

      // Peer B should show a completed strip (✓ … saved).
      await expect(
        page_b.locator(".strip.complete").filter({ hasText: "payload.txt" }),
      ).toBeVisible({ timeout: TRANSFER_TIMEOUT });

      // Peer A should show a sent strip (✓ … →).
      await expect(page_a.locator(".strip.sent").filter({ hasText: "payload.txt" })).toBeVisible({
        timeout: TRANSFER_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
      fs.rmSync(path.dirname(tmp_path), { recursive: true, force: true });
    }
  });

  test("receiver clicks Decline and strips are removed", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);
    const tmp_path = makeTempFile("data", "declined.txt");

    try {
      const page_a = await ctx_a.newPage();
      const page_b = await ctx_b.newPage();

      await page_a.goto("/");
      await page_a.waitForLoadState("networkidle");
      const room_url = page_a.url();

      await connectViaSignalling(page_a);
      await page_b.goto(room_url);
      await page_b.waitForLoadState("networkidle");
      await connectViaSignalling(page_b);

      await waitForConnected(page_a);
      await waitForConnected(page_b);

      await page_a.locator("#file-transfer-input").setInputFiles(tmp_path);

      const offer_strip = page_b.locator(".strip.incoming").filter({ hasText: "declined.txt" });
      await expect(offer_strip).toBeVisible({ timeout: TRANSFER_TIMEOUT });
      await offer_strip.getByRole("button", { name: "Decline" }).click();

      // Strip should disappear from peer B.
      await expect(offer_strip).not.toBeVisible({ timeout: TRANSFER_TIMEOUT });

      // Pending strip should disappear from peer A after cancellation propagates.
      await expect(page_a.locator(".strip").filter({ hasText: "declined.txt" })).not.toBeVisible({
        timeout: TRANSFER_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
      fs.rmSync(path.dirname(tmp_path), { recursive: true, force: true });
    }
  });
});
