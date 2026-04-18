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

/** Connect two peers to the same room and wait for both to reach connected state. */
async function connectTwoPeers(browser: Browser): Promise<{
  ctx_a: BrowserContext;
  ctx_b: BrowserContext;
  page_a: Page;
  page_b: Page;
}> {
  const ctx_a = await openPeer(browser);
  const ctx_b = await openPeer(browser);
  const page_a = await ctx_a.newPage();
  const page_b = await ctx_b.newPage();

  await page_a.goto("/");
  await page_a.waitForLoadState("networkidle");
  const room_url = page_a.url();

  await connectViaSignalling(page_a);
  await page_b.goto(room_url);
  await page_b.waitForLoadState("networkidle");
  await connectViaSignalling(page_b);

  await expect(page_a.locator(".status-label")).toContainText("connected", {
    timeout: CONNECTION_TIMEOUT,
  });
  await expect(page_b.locator(".status-label")).toContainText("connected", {
    timeout: CONNECTION_TIMEOUT,
  });

  return { ctx_a, ctx_b, page_a, page_b };
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

      await expect(page_a.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
      await expect(page_b.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
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

      await expect(page_a.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
      await expect(page_b.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });

      await page_a.locator("textarea").click();
      await page_a.locator("textarea").fill("hello from peer A");

      await expect(page_b.locator("textarea")).toHaveValue("hello from peer A", {
        timeout: SYNC_TIMEOUT,
      });
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

      await expect(page_a.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
      await expect(page_b.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });

      await page_b.locator("textarea").click();
      await page_b.locator("textarea").fill("hello from peer B");

      await expect(page_a.locator("textarea")).toHaveValue("hello from peer B", {
        timeout: SYNC_TIMEOUT,
      });
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

      await expect(page_a.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
      await expect(page_b.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });

      // A types a line, wait for B to receive it
      await page_a.locator("textarea").fill("line one");
      await expect(page_b.locator("textarea")).toHaveValue("line one", { timeout: SYNC_TIMEOUT });

      // B appends to it
      await page_b.locator("textarea").fill("line one\nline two");
      await expect(page_a.locator("textarea")).toHaveValue("line one\nline two", {
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("three peers all reach connected state (full mesh)", async ({ browser }) => {
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

      // Connect A and B and wait for them to establish before C joins
      await connectViaSignalling(page_a);
      await page_b.goto(room_url);
      await page_b.waitForLoadState("networkidle");
      await connectViaSignalling(page_b);
      await expect(page_a.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
      await expect(page_b.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });

      // C joins the established room
      await page_c.goto(room_url);
      await page_c.waitForLoadState("networkidle");
      await connectViaSignalling(page_c);

      await expect(page_c.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
      await ctx_c.close();
    }
  });

  test("text typed by peer A propagates to all peers in a 3-peer mesh", async ({ browser }) => {
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

      // Connect A and B and wait for them to establish before C joins
      await connectViaSignalling(page_a);
      await page_b.goto(room_url);
      await page_b.waitForLoadState("networkidle");
      await connectViaSignalling(page_b);
      await expect(page_a.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });
      await expect(page_b.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });

      // C joins the established room
      await page_c.goto(room_url);
      await page_c.waitForLoadState("networkidle");
      await connectViaSignalling(page_c);
      await expect(page_c.locator(".status-label")).toContainText("connected", {
        timeout: CONNECTION_TIMEOUT,
      });

      await page_a.locator("textarea").fill("hello from peer A");

      await expect(page_b.locator("textarea")).toHaveValue("hello from peer A", {
        timeout: SYNC_TIMEOUT,
      });
      await expect(page_c.locator("textarea")).toHaveValue("hello from peer A", {
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
      await ctx_c.close();
    }
  });
});

test.describe("Sync pause / resume", () => {
  test("pause sync button is hidden when not connected", async ({ browser }) => {
    const ctx = await openPeer(browser);
    try {
      const page = await ctx.newPage();
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("button", { name: "Pause document sync" })).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("pause sync button is visible when connected", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a } = await connectTwoPeers(browser);
    try {
      await expect(page_a.getByRole("button", { name: "Pause document sync" })).toBeVisible();
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  // Core feature: while A is paused, edits on each side stay local.
  // On resume, the CRDT merges both sets of changes on both sides.
  test("content diverges while paused and converges bidirectionally on resume", async ({
    browser,
  }) => {
    const { ctx_a, ctx_b, page_a, page_b } = await connectTwoPeers(browser);
    try {
      await page_a.getByRole("button", { name: "Pause document sync" }).click();

      // Both sides edit independently while A is paused.
      await page_a.locator("textarea").fill("from A");
      await page_b.locator("textarea").fill("from B");

      // Verify divergence before resume: each side only has its own content.
      await expect(page_a.locator("textarea")).toHaveValue("from A");
      await expect(page_b.locator("textarea")).toHaveValue("from B");

      // A resumes — confirm dialog appears, click Resume.
      await page_a.getByRole("button", { name: "Resume document sync" }).click();
      await page_a.getByRole("button", { name: "Resume" }).click();

      // Both sides must converge to the CRDT merge of both edits.
      await expect(page_a.locator("textarea")).toHaveValue(/from A/, {
        timeout: SYNC_TIMEOUT,
      });
      await expect(page_a.locator("textarea")).toHaveValue(/from B/, {
        timeout: SYNC_TIMEOUT,
      });
      await expect(page_b.locator("textarea")).toHaveValue(/from A/, {
        timeout: SYNC_TIMEOUT,
      });
      await expect(page_b.locator("textarea")).toHaveValue(/from B/, {
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("sync resumes normally after resume — subsequent edits propagate", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a, page_b } = await connectTwoPeers(browser);
    try {
      // Pause and immediately resume with no diverging edits.
      await page_a.getByRole("button", { name: "Pause document sync" }).click();
      await page_a.getByRole("button", { name: "Resume document sync" }).click();
      await page_a.getByRole("button", { name: "Resume" }).click();

      // Post-resume edits must sync normally.
      await page_a.locator("textarea").fill("post-resume from A");
      await expect(page_b.locator("textarea")).toHaveValue("post-resume from A", {
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  // Regression: the resume confirm button previously required two clicks because
  // resume() threw "Unexpected end of array" on the first click, preventing the
  // dialog from closing. Fixed by using writeUpdate instead of writeSyncStep2.
  test("resume confirm button closes dialog in a single click", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a } = await connectTwoPeers(browser);
    try {
      await page_a.getByRole("button", { name: "Pause document sync" }).click();
      await page_a.getByRole("button", { name: "Resume document sync" }).click();

      const dialog = page_a.getByRole("alertdialog");
      await expect(dialog).toBeVisible();

      await page_a.getByRole("button", { name: "Resume" }).click();

      // Dialog must close after exactly one click — not require a second.
      await expect(dialog).not.toBeVisible({ timeout: 2000 });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("peer B sees a resume toast when peer A resumes sync", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a, page_b } = await connectTwoPeers(browser);
    try {
      await page_a.getByRole("button", { name: "Pause document sync" }).click();
      await page_a.getByRole("button", { name: "Resume document sync" }).click();
      await page_a.getByRole("button", { name: "Resume" }).click();

      await expect(page_b.locator(".toast-message")).toContainText("resumed sync", {
        timeout: SYNC_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });
});
