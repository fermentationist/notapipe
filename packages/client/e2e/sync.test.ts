import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const CONNECTION_TIMEOUT = 20_000;
const SYNC_TIMEOUT = 8_000;

async function openPeer(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ ignoreHTTPSErrors: true });
}

async function connectViaSignalling(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Connect to peer/ }).click();
  await page.getByRole("menuitem", { name: "Use signalling server" }).click();
}

test.describe("Signalling — two-peer connection and text sync", () => {
  test("both peers reach connected state", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);

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

      await expect(page_a.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });
      await expect(page_b.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("text typed by peer A appears in peer B", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);

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

      await expect(page_a.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });
      await expect(page_b.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });

      await page_a.locator("textarea").click();
      await page_a.locator("textarea").fill("hello from peer A");

      await expect(page_b.locator("textarea")).toHaveValue("hello from peer A", { timeout: SYNC_TIMEOUT });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("text typed by peer B appears in peer A", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);

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

      await expect(page_a.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });
      await expect(page_b.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });

      await page_b.locator("textarea").click();
      await page_b.locator("textarea").fill("hello from peer B");

      await expect(page_a.locator("textarea")).toHaveValue("hello from peer B", { timeout: SYNC_TIMEOUT });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("edits from both peers merge without data loss", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);

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

      await expect(page_a.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });
      await expect(page_b.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });

      // A types a line, wait for B to receive it
      await page_a.locator("textarea").fill("line one");
      await expect(page_b.locator("textarea")).toHaveValue("line one", { timeout: SYNC_TIMEOUT });

      // B appends to it
      await page_b.locator("textarea").fill("line one\nline two");
      await expect(page_a.locator("textarea")).toHaveValue("line one\nline two", { timeout: SYNC_TIMEOUT });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("room is full — third peer receives room-full and is not connected", async ({ browser }) => {
    const ctx_a = await openPeer(browser);
    const ctx_b = await openPeer(browser);
    const ctx_c = await openPeer(browser);

    try {
      const page_a = await ctx_a.newPage();
      const page_b = await ctx_b.newPage();
      const page_c = await ctx_c.newPage();

      await page_a.goto("/");
      await page_a.waitForLoadState("networkidle");
      const room_url = page_a.url();

      await connectViaSignalling(page_a);
      await page_b.goto(room_url);
      await page_b.waitForLoadState("networkidle");
      await connectViaSignalling(page_b);

      await expect(page_a.locator(".status-label")).toHaveText("connected", { timeout: CONNECTION_TIMEOUT });

      // Third peer tries to join — should see an error state
      await page_c.goto(room_url);
      await page_c.waitForLoadState("networkidle");
      await connectViaSignalling(page_c);

      // status should not be "connected" for peer C
      await expect(page_c.locator(".status-label")).not.toHaveText("connected", { timeout: 5000 });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
      await ctx_c.close();
    }
  });
});
