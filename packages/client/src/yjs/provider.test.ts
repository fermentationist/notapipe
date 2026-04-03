import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { applyTextareaDiff } from "./provider.ts";

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
