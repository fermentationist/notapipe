import { describe, it, expect } from "vitest";
import { isOfferer } from "../src/rtc/peer.ts";

describe("isOfferer", () => {
  it("returns true when local UUID is lexicographically larger", () => {
    expect(isOfferer("z-peer", "a-peer")).toBe(true);
  });

  it("returns false when local UUID is lexicographically smaller", () => {
    expect(isOfferer("a-peer", "z-peer")).toBe(false);
  });

  it("returns false when UUIDs are equal (degenerate case)", () => {
    expect(isOfferer("same-id", "same-id")).toBe(false);
  });

  it("correctly compares real UUID-format strings", () => {
    const uuid_high = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const uuid_low = "00000000-0000-0000-0000-000000000000";
    expect(isOfferer(uuid_high, uuid_low)).toBe(true);
    expect(isOfferer(uuid_low, uuid_high)).toBe(false);
  });

  it("is antisymmetric: exactly one peer is the offerer", () => {
    const peer_a = "550e8400-e29b-41d4-a716-446655440000";
    const peer_b = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const a_is_offerer = isOfferer(peer_a, peer_b);
    const b_is_offerer = isOfferer(peer_b, peer_a);
    expect(a_is_offerer).not.toBe(b_is_offerer);
  });
});
