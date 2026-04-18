// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { RTCDataChannelProvider } from "../src/yjs/provider.ts";

// ---------------------------------------------------------------------------
// Mock RTCDataChannel infrastructure
// ---------------------------------------------------------------------------

type MessageData = string | ArrayBuffer | Uint8Array;
type EventHandler = (event: Event | MessageEvent) => void;

interface MockChannel {
  readyState: RTCDataChannelState;
  binaryType: string;
  sent: MessageData[];
  listeners: Map<string, EventHandler[]>;
  addEventListener(type: string, handler: EventHandler, options?: { once?: boolean }): void;
  send(data: MessageData): void;
}

function makeMockChannel(ready_state: RTCDataChannelState = "open"): MockChannel {
  const listeners = new Map<string, EventHandler[]>();
  const channel: MockChannel = {
    readyState: ready_state,
    binaryType: "blob",
    sent: [],
    listeners,
    addEventListener(type, handler, options) {
      if (options?.once) {
        // Wrap so it auto-removes after firing once.
        const wrapped = (e: Event | MessageEvent) => {
          const list = listeners.get(type) ?? [];
          listeners.set(
            type,
            list.filter((h) => h !== wrapped),
          );
          handler(e);
        };
        const list = listeners.get(type) ?? [];
        list.push(wrapped);
        listeners.set(type, list);
      } else {
        const list = listeners.get(type) ?? [];
        list.push(handler);
        listeners.set(type, list);
      }
    },
    send(data) {
      this.sent.push(data);
    },
  };
  return channel;
}

/**
 * Simulate the browser DataChannel behaviour: binary data sent as Uint8Array
 * arrives as ArrayBuffer when binaryType="arraybuffer" (which the provider sets).
 */
function asArrayBuffer(data: MessageData): string | ArrayBuffer {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return data as ArrayBuffer;
}

/**
 * Deliver a message to all "message" listeners on a channel.
 * Converts binary data to ArrayBuffer (matching binaryType="arraybuffer").
 */
function deliverMessage(to: MockChannel, data: MessageData): void {
  const converted = asArrayBuffer(data);
  for (const handler of to.listeners.get("message") ?? []) {
    handler({ data: converted } as MessageEvent);
  }
}

/**
 * Create a linked pair of mock channels.
 * Messages sent on A are immediately delivered to B's message listeners, and
 * vice versa — simulating a connected RTCDataChannel pair.
 */
function makeChannelPair(): [MockChannel, MockChannel] {
  const a = makeMockChannel("open");
  const b = makeMockChannel("open");

  const send_a = a.send.bind(a);
  const send_b = b.send.bind(b);

  a.send = (data) => {
    send_a(data);
    deliverMessage(b, data);
  };
  b.send = (data) => {
    send_b(data);
    deliverMessage(a, data);
  };

  return [a, b];
}

function asChannel(mock: MockChannel): RTCDataChannel {
  return mock as unknown as RTCDataChannel;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(initial_text?: string): Y.Doc {
  const doc = new Y.Doc();
  if (initial_text !== undefined) {
    doc.getText("content").insert(0, initial_text);
  }
  return doc;
}

function text(doc: Y.Doc): string {
  return doc.getText("content").toString();
}

/**
 * Create two providers with linked channels and wait for the initial SyncStep1
 * exchange to complete (synchronous in the mock — both sides send SyncStep1 in
 * their constructors, which delivers immediately via the linked channels).
 */
function makeSyncedPair(
  doc_a: Y.Doc,
  doc_b: Y.Doc,
): [RTCDataChannelProvider, RTCDataChannelProvider] {
  const [chan_a, chan_b] = makeChannelPair();
  const provider_a = new RTCDataChannelProvider(doc_a, asChannel(chan_a));
  const provider_b = new RTCDataChannelProvider(doc_b, asChannel(chan_b));
  return [provider_a, provider_b];
}

// ---------------------------------------------------------------------------
// pause() behaviour
// ---------------------------------------------------------------------------

describe("RTCDataChannelProvider.pause()", () => {
  it("stops outgoing updates from being sent to the peer", () => {
    const [chan_a] = makeChannelPair();
    const doc_a = makeDoc();
    const provider_a = new RTCDataChannelProvider(doc_a, asChannel(chan_a));
    const sent_before = chan_a.sent.length;

    provider_a.pause();
    doc_a.getText("content").insert(0, "local edit while paused");

    expect(chan_a.sent.length).toBe(sent_before); // no new messages sent
  });

  it("stops incoming updates from being applied to the local doc", () => {
    const doc_a = makeDoc("initial");
    const doc_b = makeDoc("initial");
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();

    // B edits — A should not apply it.
    doc_b.getText("content").delete(0, doc_b.getText("content").length);
    doc_b.getText("content").insert(0, "peer edit");

    expect(text(doc_a)).toBe("initial"); // A unchanged while paused
    expect(text(doc_b)).toBe("peer edit");
  });

  it("is idempotent — calling pause() twice does not double-remove the listener", () => {
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a, provider_b] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();
    expect(() => provider_a.pause()).not.toThrow();

    provider_a.resume();

    // After resume, syncing should still work.
    doc_a.getText("content").insert(0, "hello");
    expect(text(doc_b)).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// resume() — regression: must not throw regardless of doc state
// ---------------------------------------------------------------------------

describe("RTCDataChannelProvider.resume() — regression: no throw", () => {
  // Previously, resume() called writeSyncStep2(encoder, doc, new Uint8Array()),
  // which passed a zero-length buffer as the encoded state vector.
  // Y.encodeStateAsUpdate tried to decode it and threw "Unexpected end of array".
  // This caused confirm_dialog = null never to run, requiring a second click.

  it("does not throw when the doc is empty", () => {
    const [chan_a] = makeChannelPair();
    const doc_a = new Y.Doc();
    const provider_a = new RTCDataChannelProvider(doc_a, asChannel(chan_a));
    provider_a.pause();
    expect(() => provider_a.resume()).not.toThrow();
  });

  it("does not throw when the doc has content", () => {
    const [chan_a] = makeChannelPair();
    const doc_a = makeDoc("some content that was already in the doc");
    const provider_a = new RTCDataChannelProvider(doc_a, asChannel(chan_a));
    provider_a.pause();
    expect(() => provider_a.resume()).not.toThrow();
  });

  it("does not throw when resumed after local edits were made while paused", () => {
    const [chan_a] = makeChannelPair();
    const doc_a = makeDoc("starting text");
    const provider_a = new RTCDataChannelProvider(doc_a, asChannel(chan_a));
    provider_a.pause();
    doc_a.getText("content").insert(0, "edit while paused — ");
    expect(() => provider_a.resume()).not.toThrow();
  });

  it("is idempotent — calling resume() on an already-running provider does not throw", () => {
    const [chan_a] = makeChannelPair();
    const doc_a = new Y.Doc();
    const provider_a = new RTCDataChannelProvider(doc_a, asChannel(chan_a));
    expect(() => provider_a.resume()).not.toThrow(); // never paused
  });
});

// ---------------------------------------------------------------------------
// resume() — regression: full-state message is decodable by peer
// ---------------------------------------------------------------------------

describe("RTCDataChannelProvider.resume() — regression: peer decodes full-state without error", () => {
  // Previously, sendFullState() sent a writeSyncStep2 with an empty Uint8Array
  // as the state vector. The peer's decoding of that message threw
  // "Unexpected end of array" in lib0's readVarUint8Array.
  //
  // The fix: use writeUpdate(Y.encodeStateAsUpdate(doc)) instead, which sends
  // the full doc state as a sync-update message that applies idempotently.

  it("peer applies the full-state message without throwing", () => {
    const doc_a = makeDoc("content that A had while paused");
    const doc_b = makeDoc("content that A had while paused");
    const [provider_a, provider_b] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();
    doc_a.getText("content").insert(0, "A's addition — ");

    // resume() sends writeUpdate(encodeStateAsUpdate(doc_a)) to peer.
    // If the peer throws on decode, the test will fail here.
    expect(() => provider_a.resume()).not.toThrow();
  });

  it("peer's doc converges after receiving the full-state message", () => {
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();
    doc_a.getText("content").insert(0, "from A");
    provider_a.resume();

    // B must receive A's changes via the full-state push on resume.
    expect(text(doc_b)).toContain("from A");
  });

  it("full-state message is idempotent — peer with same state does not corrupt its doc", () => {
    // Start empty on both sides, let A's insert sync to B so both truly share
    // the same Yjs state (same client ID and clock). Then pause + resume should
    // not duplicate the content.
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    doc_a.getText("content").insert(0, "shared");
    expect(text(doc_b)).toBe("shared"); // confirm sync before pausing

    provider_a.pause();
    provider_a.resume();

    // Sending our full state to B must be idempotent — B already has it.
    expect(text(doc_b)).toBe("shared");
    expect(text(doc_a)).toBe("shared");
  });
});

// ---------------------------------------------------------------------------
// Bidirectional convergence after pause — the core feature
// ---------------------------------------------------------------------------

describe("RTCDataChannelProvider pause/resume — bidirectional sync convergence", () => {
  it("A gets B's edits and B gets A's edits after A resumes", () => {
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();

    // Both sides edit independently while A is paused.
    doc_a.getText("content").insert(0, "from A");
    doc_b.getText("content").insert(0, "from B");

    // Before resume: A has only its own edit, B has only its own.
    expect(text(doc_a)).toBe("from A");
    expect(text(doc_b)).toBe("from B");

    provider_a.resume();

    // After resume: both sides must have both edits (CRDT merge).
    expect(text(doc_a)).toContain("from A");
    expect(text(doc_a)).toContain("from B");
    expect(text(doc_b)).toContain("from A");
    expect(text(doc_b)).toContain("from B");
  });

  it("sync resumes correctly after multiple pause/resume cycles", () => {
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    // Cycle 1
    provider_a.pause();
    doc_a.getText("content").insert(0, "A1 ");
    doc_b.getText("content").insert(0, "B1 ");
    provider_a.resume();

    expect(text(doc_a)).toContain("A1");
    expect(text(doc_a)).toContain("B1");
    expect(text(doc_b)).toContain("A1");
    expect(text(doc_b)).toContain("B1");

    // Cycle 2
    provider_a.pause();
    doc_a.getText("content").insert(0, "A2 ");
    doc_b.getText("content").insert(0, "B2 ");
    provider_a.resume();

    expect(text(doc_a)).toContain("A2");
    expect(text(doc_a)).toContain("B2");
    expect(text(doc_b)).toContain("A2");
    expect(text(doc_b)).toContain("B2");
  });

  it("A gets B's edits even when A made no edits while paused", () => {
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();
    doc_b.getText("content").insert(0, "only B edited");
    provider_a.resume();

    expect(text(doc_a)).toContain("only B edited");
    expect(text(doc_b)).toContain("only B edited");
  });

  it("B gets A's edits even when B made no edits while A was paused", () => {
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();
    doc_a.getText("content").insert(0, "only A edited");
    provider_a.resume();

    expect(text(doc_b)).toContain("only A edited");
    expect(text(doc_a)).toContain("only A edited");
  });

  it("live edits sync normally after resume", () => {
    const doc_a = makeDoc();
    const doc_b = makeDoc();
    const [provider_a] = makeSyncedPair(doc_a, doc_b);

    provider_a.pause();
    provider_a.resume();

    // Post-resume edit from A → B should sync immediately.
    doc_a.getText("content").insert(0, "post-resume from A");
    expect(text(doc_b)).toContain("post-resume from A");

    // Post-resume edit from B → A should sync immediately.
    doc_b.getText("content").insert(0, "post-resume from B ");
    expect(text(doc_a)).toContain("post-resume from B");
  });
});
