// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileTransferManager } from "../src/rtc/file_transfer.ts";

// ---------------------------------------------------------------------------
// Mock RTCDataChannel
// ---------------------------------------------------------------------------

type EventHandler = (event: MessageEvent | Event) => void;

interface MockChannel {
  binaryType: string;
  bufferedAmountLowThreshold: number;
  bufferedAmount: number;
  readyState: RTCDataChannelState;
  sent: Array<string | ArrayBuffer>;
  listeners: Map<string, EventHandler[]>;
  addEventListener: (type: string, handler: EventHandler) => void;
  dispatchMessage: (data: string | ArrayBuffer) => void;
  dispatchBufferedAmountLow: () => void;
}

function makeMockChannel(ready_state: RTCDataChannelState = "open"): MockChannel {
  const listeners = new Map<string, EventHandler[]>();
  const mock: MockChannel = {
    binaryType: "blob",
    bufferedAmountLowThreshold: 0,
    bufferedAmount: 0,
    readyState: ready_state,
    sent: [],
    listeners,
    addEventListener(type: string, handler: EventHandler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchMessage(data: string | ArrayBuffer) {
      const event = { data } as MessageEvent;
      for (const handler of listeners.get("message") ?? []) {
        handler(event);
      }
    },
    dispatchBufferedAmountLow() {
      for (const handler of listeners.get("bufferedamountlow") ?? []) {
        handler(new Event("bufferedamountlow"));
      }
    },
  };
  // Patch send onto the object directly so tests can spy on it
  (mock as unknown as RTCDataChannel & { send: (data: string | ArrayBuffer) => void }).send = (
    data: string | ArrayBuffer,
  ) => {
    mock.sent.push(data);
  };
  return mock;
}

function asChannel(mock: MockChannel): RTCDataChannel {
  return mock as unknown as RTCDataChannel;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a JSON control message sent by the manager */
function parseControl(raw: string | ArrayBuffer): Record<string, unknown> {
  expect(typeof raw).toBe("string");
  return JSON.parse(raw as string) as Record<string, unknown>;
}

/** Normalise any binary data (ArrayBuffer or Buffer/Uint8Array) to a plain Uint8Array. */
function toBytes(data: ArrayBuffer | ArrayBufferLike | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data as ArrayBuffer);
}

/** Parse the JSON header from a binary chunk frame */
function parseChunkHeader(data: ArrayBuffer | ArrayBufferView): {
  type: string;
  transfer_id: string;
  index: number;
} {
  const bytes = toBytes(data);
  const header_length = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  const header_bytes = bytes.slice(4, 4 + header_length);
  return JSON.parse(new TextDecoder().decode(header_bytes)) as {
    type: string;
    transfer_id: string;
    index: number;
  };
}

/** Extract the chunk payload from a binary chunk frame */
function parseChunkData(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  const bytes = toBytes(data);
  const header_length = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  return bytes.slice(4 + header_length);
}

/** Build a binary chunk frame (mirrors FileTransferManager.sendChunks framing) */
function buildChunkFrame(transfer_id: string, index: number, data: Uint8Array): ArrayBuffer {
  const header = JSON.stringify({ type: "chunk", transfer_id, index });
  const header_bytes = new TextEncoder().encode(header);
  const frame = new ArrayBuffer(4 + header_bytes.byteLength + data.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, header_bytes.byteLength, false);
  new Uint8Array(frame, 4, header_bytes.byteLength).set(header_bytes);
  new Uint8Array(frame, 4 + header_bytes.byteLength).set(data);
  return frame;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileTransferManager — sending", () => {
  let channel: MockChannel;
  let manager: FileTransferManager;
  const noop_callbacks = {
    onIncomingOffer: vi.fn(),
    onProgress: vi.fn(),
    onFileReceived: vi.fn(),
    onTransferCancelled: vi.fn(),
    onTransferAccepted: vi.fn(),
    onFileSent: vi.fn(),
    onError: vi.fn(),
  };

  beforeEach(() => {
    channel = makeMockChannel("open");
    vi.clearAllMocks();
    manager = new FileTransferManager(asChannel(channel), noop_callbacks);
  });

  it("sets binaryType to arraybuffer on construction", () => {
    expect(channel.binaryType).toBe("arraybuffer");
  });

  it("returns null and calls onError when channel is closed", () => {
    channel.readyState = "closed";
    const result = manager.sendFile(new File(["hello"], "test.txt"));
    expect(result).toBeNull();
    expect(noop_callbacks.onError).toHaveBeenCalledOnce();
  });

  it("returns null and calls onError when file exceeds 100 MB", () => {
    const large_file = new File([new ArrayBuffer(104_857_601)], "huge.bin");
    const result = manager.sendFile(large_file);
    expect(result).toBeNull();
    expect(noop_callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("100 MB"));
  });

  it("sends an offer message when sendFile is called", () => {
    manager.sendFile(new File(["hello"], "hello.txt", { type: "text/plain" }));
    expect(channel.sent).toHaveLength(1);
    const offer = parseControl(channel.sent[0]);
    expect(offer.type).toBe("offer");
    expect(offer.filename).toBe("hello.txt");
    expect(offer.mime_type).toBe("text/plain");
    expect(offer.total_size).toBe(5);
    expect(offer.chunk_count).toBe(1);
  });

  it("returns a transfer_id string from sendFile", () => {
    const transfer_id = manager.sendFile(new File(["data"], "f.txt"));
    expect(typeof transfer_id).toBe("string");
    expect(transfer_id!.length).toBeGreaterThan(0);
  });

  it("sends chunks and done after receiving accept", async () => {
    const content = "hello world";
    manager.sendFile(new File([content], "greet.txt", { type: "text/plain" }));
    const offer = parseControl(channel.sent[0]);
    const transfer_id = offer.transfer_id as string;

    // Simulate receiver accepting
    channel.dispatchMessage(JSON.stringify({ type: "accept", transfer_id }));

    // Wait for async chunk reads — vi.waitFor polls until the callback doesn't throw
    await vi.waitFor(
      () => {
        if (channel.sent.length < 3) {
          throw new Error("waiting for chunks");
        }
      },
      { timeout: 2000 },
    );

    // Second message: the chunk frame (binary, not a string)
    const chunk_frame = channel.sent[1];
    expect(typeof chunk_frame).not.toBe("string");
    const header = parseChunkHeader(chunk_frame as ArrayBufferView);
    expect(header.type).toBe("chunk");
    expect(header.transfer_id).toBe(transfer_id);
    expect(header.index).toBe(0);

    const chunk_text = new TextDecoder().decode(parseChunkData(chunk_frame as ArrayBufferView));
    expect(chunk_text).toBe(content);

    // Third message: done
    const done_msg = parseControl(channel.sent[2]);
    expect(done_msg.type).toBe("done");
    expect(done_msg.transfer_id).toBe(transfer_id);
  });

  it("sends a decline message when declineTransfer is called", () => {
    const transfer_id = "fake-transfer-id";
    // Simulate an incoming offer so the manager knows about the transfer
    channel.dispatchMessage(
      JSON.stringify({
        type: "offer",
        transfer_id,
        filename: "x.bin",
        mime_type: "application/octet-stream",
        total_size: 10,
        chunk_count: 1,
      }),
    );
    channel.sent.length = 0; // clear the offer echo if any

    manager.declineTransfer(transfer_id);
    expect(channel.sent).toHaveLength(1);
    const msg = parseControl(channel.sent[0]);
    expect(msg.type).toBe("decline");
    expect(msg.transfer_id).toBe(transfer_id);
  });

  it("sends a cancel message when cancelTransfer is called on outgoing", () => {
    const transfer_id = manager.sendFile(new File(["data"], "f.txt"))!;
    channel.sent.length = 0;
    manager.cancelTransfer(transfer_id);
    expect(channel.sent).toHaveLength(1);
    const msg = parseControl(channel.sent[0]);
    expect(msg.type).toBe("cancel");
  });
});

describe("FileTransferManager — receiving", () => {
  let channel: MockChannel;
  let manager: FileTransferManager;
  let on_incoming_offer: ReturnType<typeof vi.fn>;
  let on_progress: ReturnType<typeof vi.fn>;
  let on_file_received: ReturnType<typeof vi.fn>;
  let on_cancelled: ReturnType<typeof vi.fn>;
  let on_error: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    channel = makeMockChannel("open");
    on_incoming_offer = vi.fn();
    on_progress = vi.fn();
    on_file_received = vi.fn();
    on_cancelled = vi.fn();
    on_error = vi.fn();
    manager = new FileTransferManager(asChannel(channel), {
      onIncomingOffer: on_incoming_offer,
      onProgress: on_progress,
      onFileReceived: on_file_received,
      onTransferCancelled: on_cancelled,
      onTransferAccepted: vi.fn(),
      onFileSent: vi.fn(),
      onError: on_error,
    });
  });

  it("calls onIncomingOffer when an offer is received", () => {
    channel.dispatchMessage(
      JSON.stringify({
        type: "offer",
        transfer_id: "t1",
        filename: "photo.jpg",
        mime_type: "image/jpeg",
        total_size: 1024,
        chunk_count: 1,
      }),
    );
    expect(on_incoming_offer).toHaveBeenCalledOnce();
    const offer = on_incoming_offer.mock.calls[0][0] as { filename: string };
    expect(offer.filename).toBe("photo.jpg");
  });

  it("assembles file and calls onFileReceived after all chunks + done", async () => {
    const transfer_id = "t2";
    const content = new Uint8Array([1, 2, 3, 4, 5]);

    channel.dispatchMessage(
      JSON.stringify({
        type: "offer",
        transfer_id,
        filename: "data.bin",
        mime_type: "application/octet-stream",
        total_size: content.byteLength,
        chunk_count: 1,
      }),
    );

    // Simulate acceptTransfer so the sender would start — but we're simulating
    // the sender side by delivering the chunk directly
    channel.dispatchMessage(buildChunkFrame(transfer_id, 0, content));
    channel.dispatchMessage(JSON.stringify({ type: "done", transfer_id }));

    expect(on_file_received).toHaveBeenCalledOnce();
    const [, blob, filename] = on_file_received.mock.calls[0] as [string, Blob, string];
    expect(filename).toBe("data.bin");
    const received_bytes = new Uint8Array(await blob.arrayBuffer());
    expect(received_bytes).toEqual(content);
  });

  it("calls onProgress as chunks arrive", () => {
    const transfer_id = "t3";
    channel.dispatchMessage(
      JSON.stringify({
        type: "offer",
        transfer_id,
        filename: "multi.bin",
        mime_type: "application/octet-stream",
        total_size: 4,
        chunk_count: 2,
      }),
    );

    channel.dispatchMessage(buildChunkFrame(transfer_id, 0, new Uint8Array([1, 2])));
    expect(on_progress).toHaveBeenLastCalledWith(transfer_id, 1, 2);

    channel.dispatchMessage(buildChunkFrame(transfer_id, 1, new Uint8Array([3, 4])));
    expect(on_progress).toHaveBeenLastCalledWith(transfer_id, 2, 2);
  });

  it("assembles multi-chunk file in correct order", async () => {
    const transfer_id = "t4";
    const chunk_a = new Uint8Array([10, 20]);
    const chunk_b = new Uint8Array([30, 40]);

    channel.dispatchMessage(
      JSON.stringify({
        type: "offer",
        transfer_id,
        filename: "ordered.bin",
        mime_type: "application/octet-stream",
        total_size: 4,
        chunk_count: 2,
      }),
    );

    // Deliver chunk 1 before chunk 0 (out of order)
    channel.dispatchMessage(buildChunkFrame(transfer_id, 1, chunk_b));
    channel.dispatchMessage(buildChunkFrame(transfer_id, 0, chunk_a));
    channel.dispatchMessage(JSON.stringify({ type: "done", transfer_id }));

    expect(on_file_received).toHaveBeenCalledOnce();
    const [, blob] = on_file_received.mock.calls[0] as [string, Blob];
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toEqual(new Uint8Array([10, 20, 30, 40]));
  });

  it("calls onTransferCancelled and removes transfer when cancel is received", () => {
    const transfer_id = "t5";
    channel.dispatchMessage(
      JSON.stringify({
        type: "offer",
        transfer_id,
        filename: "gone.bin",
        mime_type: "application/octet-stream",
        total_size: 10,
        chunk_count: 1,
      }),
    );
    channel.dispatchMessage(JSON.stringify({ type: "cancel", transfer_id }));
    expect(on_cancelled).toHaveBeenCalledWith(transfer_id);
    // A subsequent done should not trigger onFileReceived
    channel.dispatchMessage(JSON.stringify({ type: "done", transfer_id }));
    expect(on_file_received).not.toHaveBeenCalled();
  });

  it("calls onError if done arrives with incomplete chunks", () => {
    const transfer_id = "t6";
    channel.dispatchMessage(
      JSON.stringify({
        type: "offer",
        transfer_id,
        filename: "partial.bin",
        mime_type: "application/octet-stream",
        total_size: 4,
        chunk_count: 2,
      }),
    );
    // Only deliver one of two chunks before done
    channel.dispatchMessage(buildChunkFrame(transfer_id, 0, new Uint8Array([1, 2])));
    channel.dispatchMessage(JSON.stringify({ type: "done", transfer_id }));

    expect(on_error).toHaveBeenCalledOnce();
    expect(on_file_received).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON control messages without throwing", () => {
    expect(() => {
      channel.dispatchMessage("not valid json {{{{");
    }).not.toThrow();
  });

  it("ignores binary frames that are too short", () => {
    expect(() => {
      channel.dispatchMessage(new ArrayBuffer(2));
    }).not.toThrow();
  });
});
