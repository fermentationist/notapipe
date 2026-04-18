// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ConnectionManager,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
} from "../src/rtc/connection_manager.ts";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ICE_RESTART_TIMEOUT_MS,
  VISIBILITY_PONG_WAIT_MS,
} from "../src/lib/constants/rtc.ts";
import type { RTCPeerManager, PeerManagerState } from "../src/rtc/peer.ts";

// ---------------------------------------------------------------------------
// Mock RTCDataChannel
// ---------------------------------------------------------------------------

type EventHandler = (event: Event | MessageEvent) => void;

interface MockChannel {
  readyState: RTCDataChannelState;
  sent: string[];
  listeners: Map<string, EventHandler[]>;
  addEventListener(type: string, handler: EventHandler, options?: AddEventListenerOptions): void;
  dispatchOpen(): void;
  send(data: string): void;
}

function makeMockChannel(ready_state: RTCDataChannelState = "open"): MockChannel {
  const listeners = new Map<string, EventHandler[]>();
  return {
    readyState: ready_state,
    sent: [],
    listeners,
    addEventListener(type: string, handler: EventHandler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatchOpen() {
      for (const handler of listeners.get("open") ?? []) {
        handler(new Event("open"));
      }
    },
    send(data: string) {
      this.sent.push(data);
    },
  };
}

function asChannel(mock: MockChannel): RTCDataChannel {
  return mock as unknown as RTCDataChannel;
}

// ---------------------------------------------------------------------------
// Mock RTCPeerManager
// ---------------------------------------------------------------------------

function makeMockPeerManager(): RTCPeerManager & { restart_ice_calls: number } {
  return {
    restart_ice_calls: 0,
    restartIce: vi.fn(function (this: { restart_ice_calls: number }) {
      this.restart_ice_calls += 1;
      return Promise.resolve();
    }),
  } as unknown as RTCPeerManager & { restart_ice_calls: number };
}

// ---------------------------------------------------------------------------
// Stub document for visibilitychange in Node environment
// ---------------------------------------------------------------------------

type VisibilityState = "visible" | "hidden";

interface MockDocument {
  visibilityState: VisibilityState;
  listeners: Map<string, EventHandler[]>;
  addEventListener(type: string, handler: EventHandler): void;
  removeEventListener(type: string, handler: EventHandler): void;
  dispatchVisibilityChange(state: VisibilityState): void;
}

function makeDocumentStub(): MockDocument {
  const listeners = new Map<string, EventHandler[]>();
  const doc: MockDocument = {
    visibilityState: "visible",
    listeners,
    addEventListener(type: string, handler: EventHandler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type: string, handler: EventHandler) {
      const list = listeners.get(type) ?? [];
      listeners.set(
        type,
        list.filter((h) => h !== handler),
      );
    },
    dispatchVisibilityChange(state: VisibilityState) {
      this.visibilityState = state;
      for (const handler of listeners.get("visibilitychange") ?? []) {
        handler(new Event("visibilitychange"));
      }
    },
  };
  return doc;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let mock_document: MockDocument;

beforeEach(() => {
  vi.useFakeTimers();
  mock_document = makeDocumentStub();
  Object.defineProperty(globalThis, "document", {
    value: mock_document,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper: create a ConnectionManager with common defaults
// ---------------------------------------------------------------------------

function makeManager(options: {
  is_offerer?: boolean;
  on_give_up?: () => void;
  peer_manager?: RTCPeerManager;
}): {
  manager: ConnectionManager;
  peer_manager: RTCPeerManager & { restart_ice_calls: number };
  on_give_up: ReturnType<typeof vi.fn>;
} {
  const peer_manager =
    (options.peer_manager as RTCPeerManager & { restart_ice_calls: number }) ??
    makeMockPeerManager();
  const on_give_up = options.on_give_up ? vi.fn(options.on_give_up) : vi.fn();
  const manager = new ConnectionManager(peer_manager, options.is_offerer ?? true, on_give_up);
  return { manager, peer_manager, on_give_up };
}

// ---------------------------------------------------------------------------
// handleDataMessage
// ---------------------------------------------------------------------------

describe("ConnectionManager.handleDataMessage", () => {
  it("returns false for unknown message types", () => {
    const { manager } = makeManager({});
    expect(manager.handleDataMessage("identity")).toBe(false);
    expect(manager.handleDataMessage("chat")).toBe(false);
    expect(manager.handleDataMessage("")).toBe(false);
  });

  it("returns true and sends a pong when it receives a ping", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    const result = manager.handleDataMessage(HEARTBEAT_PING);

    expect(result).toBe(true);
    expect(channel.sent).toHaveLength(1);
    expect(JSON.parse(channel.sent[0])).toEqual({ type: HEARTBEAT_PONG });
  });

  it("returns true and does not crash on pong when channel is closed", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("closed");
    manager.setDataChannel(asChannel(channel));

    expect(() => manager.handleDataMessage(HEARTBEAT_PING)).not.toThrow();
    expect(channel.sent).toHaveLength(0);
  });

  it("returns true and updates last_pong_at when it receives a pong", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    // Advance time so that the pong timestamp is distinguishably later.
    vi.advanceTimersByTime(5_000);

    const result = manager.handleDataMessage(HEARTBEAT_PONG);
    expect(result).toBe(true);

    // Heartbeat should NOT fire since pong was just received —
    // even if the full timeout window elapses from before the pong.
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(manager["peer_manager"].restartIce).not.toHaveBeenCalled();
  });

  it("returns false after destroy()", () => {
    const { manager } = makeManager({});
    manager.destroy();
    expect(manager.handleDataMessage(HEARTBEAT_PING)).toBe(false);
    expect(manager.handleDataMessage(HEARTBEAT_PONG)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat — ping scheduling and timeout
// ---------------------------------------------------------------------------

describe("ConnectionManager heartbeat", () => {
  it("starts the heartbeat once the data channel opens", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("connecting");
    manager.setDataChannel(asChannel(channel));

    // No pings yet — channel isn't open.
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(channel.sent).toHaveLength(0);

    // Simulate the channel opening.
    channel.readyState = "open";
    channel.dispatchOpen();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(channel.sent.length).toBeGreaterThan(0);
    expect(JSON.parse(channel.sent[0])).toEqual({ type: HEARTBEAT_PING });
  });

  it("sends a ping on each heartbeat interval", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

    const pings = channel.sent.filter((msg) => JSON.parse(msg).type === HEARTBEAT_PING);
    expect(pings).toHaveLength(3);
  });

  it("triggers ICE restart after HEARTBEAT_TIMEOUT_MS without a pong (offerer)", () => {
    const { manager, peer_manager } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS);

    expect(peer_manager.restartIce).toHaveBeenCalled();
  });

  it("does NOT trigger ICE restart before the timeout window elapses", () => {
    const { manager, peer_manager } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1);

    expect(peer_manager.restartIce).not.toHaveBeenCalled();
  });

  it("resets the timeout window after a pong", () => {
    const { manager, peer_manager } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    // Advance close to the timeout, then receive a pong.
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1_000);
    manager.handleDataMessage(HEARTBEAT_PONG);

    // Advance past the original timeout — should NOT restart.
    vi.advanceTimersByTime(2_000);
    expect(peer_manager.restartIce).not.toHaveBeenCalled();

    // But it SHOULD restart if we wait the full timeout again.
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(peer_manager.restartIce).toHaveBeenCalled();
  });

  it("does not call restartIce when not the offerer (answerer role)", () => {
    const { manager, peer_manager } = makeManager({ is_offerer: false });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS);

    expect(peer_manager.restartIce).not.toHaveBeenCalled();
  });

  it("stops sending pings after destroy()", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    const ping_count_before = channel.sent.length;

    manager.destroy();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 5);

    expect(channel.sent.length).toBe(ping_count_before);
  });
});

// ---------------------------------------------------------------------------
// onStateChange
// ---------------------------------------------------------------------------

describe("ConnectionManager.onStateChange", () => {
  it("returns false for 'connected' — caller should still record the state", () => {
    const { manager } = makeManager({});
    expect(manager.onStateChange("connected")).toBe(false);
  });

  it("returns false for 'failed' before first connect — caller handles teardown", () => {
    const { manager } = makeManager({});
    expect(manager.onStateChange("failed")).toBe(false);
  });

  it("returns false for 'disconnected' before first connect", () => {
    const { manager } = makeManager({});
    expect(manager.onStateChange("disconnected")).toBe(false);
  });

  it("returns true for 'disconnected' after connect — suppresses immediate disconnectPeer", () => {
    const { manager } = makeManager({});
    manager.onStateChange("connected");
    expect(manager.onStateChange("disconnected")).toBe(true);
  });

  it("triggers ICE restart on 'disconnected' after connect (offerer)", () => {
    const { manager, peer_manager } = makeManager({ is_offerer: true });
    manager.onStateChange("connected");
    manager.onStateChange("disconnected");

    expect(peer_manager.restartIce).toHaveBeenCalled();
  });

  it("returns true for 'failed' after connect — suppresses immediate disconnectPeer", () => {
    const { manager } = makeManager({});
    manager.onStateChange("connected");
    expect(manager.onStateChange("failed")).toBe(true);
  });

  it("calls on_give_up immediately on 'failed' after connect", () => {
    const { manager, on_give_up } = makeManager({});
    manager.onStateChange("connected");
    manager.onStateChange("failed");

    expect(on_give_up).toHaveBeenCalledOnce();
  });

  it("cancels the give-up timer when 'connected' arrives during ICE restart", () => {
    const { manager, on_give_up } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    manager.onStateChange("connected");
    manager.onStateChange("disconnected"); // triggers ICE restart + give-up timer

    // Connection recovers before the give-up timer fires.
    manager.onStateChange("connected");

    vi.advanceTimersByTime(ICE_RESTART_TIMEOUT_MS + 1_000);
    expect(on_give_up).not.toHaveBeenCalled();
  });

  it("calls on_give_up after ICE_RESTART_TIMEOUT_MS if recovery fails (offerer)", () => {
    const { manager, on_give_up } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    manager.onStateChange("connected");
    manager.onStateChange("disconnected");

    vi.advanceTimersByTime(ICE_RESTART_TIMEOUT_MS - 1);
    expect(on_give_up).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(on_give_up).toHaveBeenCalledOnce();
  });

  it("calls on_give_up after ICE_RESTART_TIMEOUT_MS for answerer too", () => {
    // Answerer can't restart ICE but still needs to give up if recovery doesn't come.
    const { manager, on_give_up, peer_manager } = makeManager({ is_offerer: false });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    manager.onStateChange("connected");
    manager.onStateChange("disconnected");

    expect(peer_manager.restartIce).not.toHaveBeenCalled(); // answerer can't restart
    vi.advanceTimersByTime(ICE_RESTART_TIMEOUT_MS + 1);
    expect(on_give_up).toHaveBeenCalledOnce();
  });

  it("does not fire give-up more than once for rapid state changes", () => {
    const { manager, on_give_up } = makeManager({});
    manager.onStateChange("connected");
    manager.onStateChange("disconnected");
    manager.onStateChange("failed"); // second terminal event

    expect(on_give_up).toHaveBeenCalledOnce();
  });

  it("returns false after destroy()", () => {
    const { manager } = makeManager({});
    manager.onStateChange("connected");
    manager.destroy();
    expect(manager.onStateChange("disconnected")).toBe(false);
    expect(manager.onStateChange("failed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Page Visibility probe
// ---------------------------------------------------------------------------

describe("ConnectionManager visibility probe", () => {
  it("sends a probe ping when the page becomes visible", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    mock_document.dispatchVisibilityChange("visible");

    const pings = channel.sent.filter((msg) => JSON.parse(msg).type === HEARTBEAT_PING);
    expect(pings.length).toBeGreaterThan(0);
  });

  it("triggers ICE restart after VISIBILITY_PONG_WAIT_MS with no pong (offerer)", () => {
    const { manager, peer_manager } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    mock_document.dispatchVisibilityChange("hidden");
    mock_document.dispatchVisibilityChange("visible");

    vi.advanceTimersByTime(VISIBILITY_PONG_WAIT_MS + 1);

    expect(peer_manager.restartIce).toHaveBeenCalled();
  });

  it("does NOT trigger ICE restart if a pong arrives within VISIBILITY_PONG_WAIT_MS", () => {
    const { manager, peer_manager } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    mock_document.dispatchVisibilityChange("visible");

    // Pong arrives quickly.
    vi.advanceTimersByTime(500);
    manager.handleDataMessage(HEARTBEAT_PONG);

    vi.advanceTimersByTime(VISIBILITY_PONG_WAIT_MS);

    expect(peer_manager.restartIce).not.toHaveBeenCalled();
  });

  it("does NOT probe when the page becomes hidden (only visible matters)", () => {
    const { manager } = makeManager({});
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));
    const sent_before = channel.sent.length;

    mock_document.dispatchVisibilityChange("hidden");

    expect(channel.sent.length).toBe(sent_before);
  });

  it("removes the visibility listener on destroy()", () => {
    const { manager } = makeManager({ is_offerer: true });
    manager.destroy();

    const listeners_after = mock_document.listeners.get("visibilitychange") ?? [];
    expect(listeners_after).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ICE restart — only one restart in flight at a time
// ---------------------------------------------------------------------------

describe("ConnectionManager ICE restart deduplication", () => {
  it("does not arm a second give-up timer if a restart is already in flight", () => {
    const { manager, peer_manager, on_give_up } = makeManager({ is_offerer: true });
    const channel = makeMockChannel("open");
    manager.setDataChannel(asChannel(channel));

    manager.onStateChange("connected");

    // Trigger restart twice in quick succession.
    manager.onStateChange("disconnected");
    manager.onStateChange("disconnected");

    // Only one restartIce call.
    expect(peer_manager.restartIce).toHaveBeenCalledOnce();

    // Give-up fires once, not twice.
    vi.advanceTimersByTime(ICE_RESTART_TIMEOUT_MS + 1);
    expect(on_give_up).toHaveBeenCalledOnce();
  });
});
