import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { applyTextareaDiff, adjustCursor } from "../src/yjs/provider.ts";

function makeDocAndText(): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  return { doc, ytext };
}

describe("applyTextareaDiff", () => {
  it("inserts text into an empty document", () => {
    const { doc, ytext } = makeDocAndText();
    applyTextareaDiff(ytext, doc, "", "hello");
    expect(ytext.toString()).toBe("hello");
  });

  it("appends characters at the end", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "hello");
    applyTextareaDiff(ytext, doc, "hello", "hello world");
    expect(ytext.toString()).toBe("hello world");
  });

  it("prepends characters at the start", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "world");
    applyTextareaDiff(ytext, doc, "world", "hello world");
    expect(ytext.toString()).toBe("hello world");
  });

  it("replaces a character in the middle", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "cat");
    applyTextareaDiff(ytext, doc, "cat", "car");
    expect(ytext.toString()).toBe("car");
  });

  it("deletes characters from the middle", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "hello world");
    applyTextareaDiff(ytext, doc, "hello world", "hello");
    expect(ytext.toString()).toBe("hello");
  });

  it("clears the whole document", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "all gone");
    applyTextareaDiff(ytext, doc, "all gone", "");
    expect(ytext.toString()).toBe("");
  });

  it("is a no-op when old and new values are identical", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "unchanged");
    const before = ytext.toString();
    applyTextareaDiff(ytext, doc, "unchanged", "unchanged");
    expect(ytext.toString()).toBe(before);
  });

  it("handles insertion in the middle of a word", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "hllo");
    applyTextareaDiff(ytext, doc, "hllo", "hello");
    expect(ytext.toString()).toBe("hello");
  });

  it("handles multiline text correctly", () => {
    const { doc, ytext } = makeDocAndText();
    const original = "line one\nline two\nline three";
    const updated = "line one\nline TWO\nline three";
    ytext.insert(0, original);
    applyTextareaDiff(ytext, doc, original, updated);
    expect(ytext.toString()).toBe(updated);
  });

  it("handles unicode characters without corrupting surrogate pairs", () => {
    const { doc, ytext } = makeDocAndText();
    ytext.insert(0, "hello 🌍");
    applyTextareaDiff(ytext, doc, "hello 🌍", "hello 🌎");
    expect(ytext.toString()).toBe("hello 🌎");
  });
});

describe("adjustCursor", () => {
  it("cursor before remote insert is unchanged", () => {
    // "hello world" → "hello beautiful world", cursor at 5 (after "hello")
    expect(adjustCursor("hello world", "hello beautiful world", 5)).toBe(5);
  });

  it("cursor after remote insert shifts forward", () => {
    // Remote prepends "abc" to "hello" — cursor was at end (5), should move to 8
    expect(adjustCursor("hello", "abchello", 5)).toBe(8);
  });

  it("cursor after remote insert in middle shifts forward", () => {
    // "hello world", remote inserts "beautiful " at position 6
    // cursor was at 11 (end), should become 21
    expect(adjustCursor("hello world", "hello beautiful world", 11)).toBe(21);
  });

  it("cursor at exact insert point stays put (before semantics)", () => {
    // "ab", insert "X" at position 1 → "aXb", cursor at 1 → stays at 1
    expect(adjustCursor("ab", "aXb", 1)).toBe(1);
  });

  it("cursor inside deleted region is clamped to start of change", () => {
    // "hello world", remote deletes "lo wo" (positions 3-8)
    // cursor at 5 (inside deleted region) → clamped to 3
    expect(adjustCursor("hello world", "helrld", 5)).toBe(3);
  });

  it("cursor after deletion shifts backward", () => {
    // "hello world", remote deletes " world" (positions 5-11)
    // cursor at 11 (end) → becomes 5
    expect(adjustCursor("hello world", "hello", 11)).toBe(5);
  });

  it("cursor at position 0 is always unchanged", () => {
    expect(adjustCursor("hello", "xyz hello", 0)).toBe(0);
  });

  it("no-op edit leaves cursor unchanged", () => {
    expect(adjustCursor("hello", "hello", 3)).toBe(3);
  });

  it("remote replace before cursor adjusts correctly (net zero change)", () => {
    // "abcde", replace "ab" with "XY" — cursor at 5, net change = 0
    expect(adjustCursor("abcde", "XYcde", 5)).toBe(5);
  });

  it("remote replace shrinks text before cursor — cursor shifts back", () => {
    // "hello world", replace "hello" with "hi" (save 3 chars), cursor at 11
    expect(adjustCursor("hello world", "hi world", 11)).toBe(8);
  });
});
