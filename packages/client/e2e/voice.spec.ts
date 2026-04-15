import { test, expect, type Browser, type BrowserContext } from "@playwright/test";

const CONNECTION_TIMEOUT = 20_000;
const VOICE_TIMEOUT = 8_000;

// ---------------------------------------------------------------------------
// Stubs getUserMedia with a fake silent audio stream so voice call logic runs
// without real microphone hardware or browser permission prompts.
// ---------------------------------------------------------------------------

const FAKE_AUDIO_SCRIPT = `
  (() => {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { return; }
    let fake_stream = null;
    function get_fake_stream() {
      if (!fake_stream) {
        const ctx = new AC();
        fake_stream = ctx.createMediaStreamDestination().stream;
      }
      return fake_stream;
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => get_fake_stream(),
        enumerateDevices: async () => [],
      },
      configurable: true,
      writable: true,
    });
  })();
`;

async function openPeerWithFakeAudio(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  await ctx.addInitScript(FAKE_AUDIO_SCRIPT);
  return ctx;
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

// ---------------------------------------------------------------------------
// Helper: connect two peers and return open contexts + pages
// ---------------------------------------------------------------------------

async function setupTwoPeers(browser: Browser) {
  const ctx_a = await openPeerWithFakeAudio(browser);
  const ctx_b = await openPeerWithFakeAudio(browser);

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

  return { ctx_a, ctx_b, page_a, page_b };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Voice call — UI state", () => {
  test("phone button becomes aria-pressed=true after starting a call", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a } = await setupTwoPeers(browser);
    try {
      const btn = page_a.getByRole("button", { name: /Start voice call/i });
      await expect(btn).toHaveAttribute("aria-pressed", "false");

      await btn.click();

      await expect(page_a.getByRole("button", { name: /End voice call/i })).toHaveAttribute(
        "aria-pressed",
        "true",
        { timeout: VOICE_TIMEOUT },
      );
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("button title changes to End voice call while active", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a } = await setupTwoPeers(browser);
    try {
      await page_a.getByRole("button", { name: /Start voice call/i }).click();

      await expect(page_a.getByRole("button", { name: /End voice call/i })).toBeVisible({
        timeout: VOICE_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("clicking End voice call returns button to inactive state", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a } = await setupTwoPeers(browser);
    try {
      await page_a.getByRole("button", { name: /Start voice call/i }).click();
      await expect(page_a.getByRole("button", { name: /End voice call/i })).toBeVisible({
        timeout: VOICE_TIMEOUT,
      });

      await page_a.getByRole("button", { name: /End voice call/i }).click();

      await expect(page_a.getByRole("button", { name: /Start voice call/i })).toHaveAttribute(
        "aria-pressed",
        "false",
        { timeout: VOICE_TIMEOUT },
      );
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("peer B sees Join voice call when peer A starts a call", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a, page_b } = await setupTwoPeers(browser);
    try {
      await page_a.getByRole("button", { name: /Start voice call/i }).click();

      await expect(page_b.getByRole("button", { name: /Join voice call/i })).toBeVisible({
        timeout: VOICE_TIMEOUT,
      });
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("4-hour warning banner appears when the warning timer fires", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a } = await setupTwoPeers(browser);
    try {
      // Warning banner must not be visible before a call starts.
      await expect(page_a.locator(".voice-warning-bar")).not.toBeVisible();

      // Install fake clock on page_a BEFORE starting the call so that the
      // voice-manager timers (set inside start()) are intercepted.
      await page_a.clock.install();

      await page_a.getByRole("button", { name: /Start voice call/i }).click();
      await expect(page_a.getByRole("button", { name: /End voice call/i })).toBeVisible({
        timeout: VOICE_TIMEOUT,
      });

      // Banner still hidden immediately after start.
      await expect(page_a.locator(".voice-warning-bar")).not.toBeVisible();

      // Advance to the warning threshold: 3 h 45 min.
      const MS_3H45M = (3 * 60 + 45) * 60 * 1000;
      await page_a.clock.fastForward(MS_3H45M);

      await expect(page_a.locator(".voice-warning-bar")).toBeVisible({ timeout: 3000 });
      await expect(page_a.locator(".voice-warning-bar")).toContainText("15 minutes");
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });

  test("call auto-ends when the 4-hour hard cap timer fires", async ({ browser }) => {
    const { ctx_a, ctx_b, page_a } = await setupTwoPeers(browser);
    try {
      await page_a.clock.install();

      await page_a.getByRole("button", { name: /Start voice call/i }).click();
      await expect(page_a.getByRole("button", { name: /End voice call/i })).toBeVisible({
        timeout: VOICE_TIMEOUT,
      });

      // Advance past both warning (3h45m) and hard cap (4h).
      const MS_4H = 4 * 60 * 60 * 1000;
      await page_a.clock.fastForward(MS_4H);

      // Call should auto-end.
      await expect(page_a.getByRole("button", { name: /Start voice call/i })).toHaveAttribute(
        "aria-pressed",
        "false",
        { timeout: 3000 },
      );

      // Warning banner should be gone.
      await expect(page_a.locator(".voice-warning-bar")).not.toBeVisible();
    } finally {
      await ctx_a.close();
      await ctx_b.close();
    }
  });
});
