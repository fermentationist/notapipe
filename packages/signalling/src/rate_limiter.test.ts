import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, resetAllRateLimitState } from "./rate_limiter.ts";

const TEST_IP = "192.168.1.1";
const OTHER_IP = "10.0.0.1";

beforeEach(() => {
  resetAllRateLimitState();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows the first 10 attempts within a minute", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(checkRateLimit(TEST_IP)).toBe(true);
    }
  });

  it("blocks the 11th attempt within a minute", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      checkRateLimit(TEST_IP);
    }
    expect(checkRateLimit(TEST_IP)).toBe(false);
  });

  it("tracks different IPs independently", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      checkRateLimit(TEST_IP);
    }
    // TEST_IP is at limit, but OTHER_IP should be unaffected
    expect(checkRateLimit(OTHER_IP)).toBe(true);
  });

  it("allows attempts again after the sliding window expires", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      checkRateLimit(TEST_IP);
    }
    expect(checkRateLimit(TEST_IP)).toBe(false);

    // Advance time past the 1-minute window
    vi.advanceTimersByTime(61_000);

    expect(checkRateLimit(TEST_IP)).toBe(true);
  });

  it("uses a sliding window, not a fixed bucket", () => {
    // Make 5 attempts at t=0
    for (let attempt = 0; attempt < 5; attempt++) {
      checkRateLimit(TEST_IP);
    }

    // Advance 30s and make 5 more — still within limit
    vi.advanceTimersByTime(30_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(checkRateLimit(TEST_IP)).toBe(true);
    }

    // One more should be blocked (10 in last 60s)
    expect(checkRateLimit(TEST_IP)).toBe(false);

    // Advance 31s — the first 5 timestamps fall out of the window
    vi.advanceTimersByTime(31_000);
    expect(checkRateLimit(TEST_IP)).toBe(true);
  });
});
