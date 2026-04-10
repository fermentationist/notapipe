// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Provide a minimal window.location stub for parseId tests in node environment.
// Must be top-level so it runs before describe() callbacks are collected.
if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { location: { pathname: "/", hash: "" } },
    writable: true,
    configurable: true,
  });
}
import { generateId, generatePassphrase, geoId, parseId, isValidId } from "../src/id/generate.ts";
import { WORDLIST } from "../src/id/wordlist.ts";
import { ROOM_WORD_COUNT, PASSPHRASE_WORD_COUNT, GEO_GRID_PRECISION } from "$lib/constants/id.ts";

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe("generateId", () => {
  it("returns a hyphen-separated string", () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it(`returns exactly ${ROOM_WORD_COUNT} words`, () => {
    const id = generateId();
    expect(id.split("-")).toHaveLength(ROOM_WORD_COUNT);
  });

  it("each word is in the wordlist", () => {
    const wordlist_set = new Set(WORDLIST);
    const id = generateId();
    id.split("-").forEach((word) => {
      expect(wordlist_set.has(word)).toBe(true);
    });
  });

  it("produces different IDs on successive calls (probabilistic)", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()));
    expect(ids.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// generatePassphrase
// ---------------------------------------------------------------------------

describe("generatePassphrase", () => {
  it(`returns exactly ${PASSPHRASE_WORD_COUNT} words`, () => {
    const passphrase = generatePassphrase();
    expect(passphrase.split("-")).toHaveLength(PASSPHRASE_WORD_COUNT);
  });

  it("each word is in the wordlist", () => {
    const wordlist_set = new Set(WORDLIST);
    const passphrase = generatePassphrase();
    passphrase.split("-").forEach((word) => {
      expect(wordlist_set.has(word)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// geoId
// ---------------------------------------------------------------------------

describe("geoId", () => {
  const san_francisco = { latitude: 37.7749, longitude: -122.4194 };
  const paris = { latitude: 48.8566, longitude: 2.3522 };
  const passphrase = "forest-table";

  it("returns a valid 3-word ID", async () => {
    const id = await geoId(san_francisco, passphrase);
    expect(isValidId(id)).toBe(true);
  });

  it("is deterministic for the same coordinates and passphrase", async () => {
    const id_a = await geoId(san_francisco, passphrase);
    const id_b = await geoId(san_francisco, passphrase);
    expect(id_a).toBe(id_b);
  });

  it("produces different IDs for distant coordinates", async () => {
    const id_a = await geoId(san_francisco, passphrase);
    const id_b = await geoId(paris, passphrase);
    expect(id_a).not.toBe(id_b);
  });

  it("snaps coordinates within the same grid cell to the same ID", async () => {
    // Offset by less than half a grid cell — both round to the same quantized value
    const nearby = {
      latitude: san_francisco.latitude + GEO_GRID_PRECISION * 0.4,
      longitude: san_francisco.longitude + GEO_GRID_PRECISION * 0.4,
    };
    const id_a = await geoId(san_francisco, passphrase);
    const id_b = await geoId(nearby, passphrase);
    expect(id_a).toBe(id_b);
  });

  it("produces different IDs for coordinates in adjacent grid cells", async () => {
    const adjacent = {
      latitude: san_francisco.latitude + GEO_GRID_PRECISION * 1.5,
      longitude: san_francisco.longitude,
    };
    const id_a = await geoId(san_francisco, passphrase);
    const id_b = await geoId(adjacent, passphrase);
    expect(id_a).not.toBe(id_b);
  });

  it("returns a hyphen-separated string of exactly 3 words", async () => {
    const id = await geoId(san_francisco, passphrase);
    expect(id.split("-")).toHaveLength(3);
    expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("each word is in the wordlist", async () => {
    const wordlist_set = new Set(WORDLIST);
    const id = await geoId(san_francisco, passphrase);
    id.split("-").forEach((word) => {
      expect(wordlist_set.has(word)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// parseId
// ---------------------------------------------------------------------------

describe("parseId", () => {
  const original_location = window.location;

  function set_pathname(pathname: string): void {
    Object.defineProperty(window, "location", {
      value: { ...original_location, pathname },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: original_location,
      writable: true,
      configurable: true,
    });
  });

  it("returns the room ID from a normal path", () => {
    set_pathname("/apple-river-moon");
    expect(parseId()).toBe("apple-river-moon");
  });

  it("strips the leading slash", () => {
    set_pathname("/foo-bar-baz");
    expect(parseId()).toBe("foo-bar-baz");
  });

  it("returns null for root path", () => {
    set_pathname("/");
    expect(parseId()).toBeNull();
  });

  it("returns null for empty path", () => {
    set_pathname("");
    expect(parseId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isValidId
// ---------------------------------------------------------------------------

describe("isValidId", () => {
  it("accepts a valid 3-word ID", () => {
    const id = generateId();
    expect(isValidId(id)).toBe(true);
  });

  it("rejects a 2-word string", () => {
    expect(isValidId("apple-river")).toBe(false);
  });

  it("rejects a 4-word string", () => {
    expect(isValidId("apple-river-moon-lake")).toBe(false);
  });

  it("rejects a word not in the wordlist", () => {
    const valid_words = WORDLIST.slice(0, 2).join("-");
    expect(isValidId(`${valid_words}-zzzznotaword`)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidId("")).toBe(false);
  });

  it("accepts all 3 words being the same wordlist entry", () => {
    const word = WORDLIST[0]!;
    expect(isValidId(`${word}-${word}-${word}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WORDLIST integrity
// ---------------------------------------------------------------------------

describe("WORDLIST", () => {
  it("has exactly 2048 entries", () => {
    expect(WORDLIST).toHaveLength(2048);
  });

  it("is a power of 2 in length (required for bias-free masking)", () => {
    expect(WORDLIST.length & (WORDLIST.length - 1)).toBe(0);
  });

  it("contains no duplicates", () => {
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
  });

  it("contains only lowercase letters and hyphens", () => {
    WORDLIST.forEach((word) => {
      expect(word).toMatch(/^[a-z-]+$/);
    });
  });
});
