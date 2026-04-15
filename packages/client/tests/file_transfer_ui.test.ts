// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileTransferUIManager } from "../src/rtc/file_transfer_ui.ts";
import type { FileTransferUIDeps, FtPeerEntry } from "../src/rtc/file_transfer_ui.ts";
import type { IncomingOffer } from "../src/rtc/file_transfer.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make_deps(overrides: Partial<FileTransferUIDeps> = {}): {
  deps: FileTransferUIDeps;
  state: {
    incoming_offers: Map<string, IncomingOffer>;
    progress: Map<string, { received: number; total: number }>;
    completed: Map<string, { url: string; filename: string }>;
    sent: Map<string, FtPeerEntry>;
    sending: Map<string, FtPeerEntry>;
    pending_sent: Map<string, FtPeerEntry>;
  };
  toasts: string[];
  errors: string[];
} {
  const state = {
    incoming_offers: new Map<string, IncomingOffer>(),
    progress: new Map<string, { received: number; total: number }>(),
    completed: new Map<string, { url: string; filename: string }>(),
    sent: new Map<string, FtPeerEntry>(),
    sending: new Map<string, FtPeerEntry>(),
    pending_sent: new Map<string, FtPeerEntry>(),
  };
  const toasts: string[] = [];
  const errors: string[] = [];

  const deps: FileTransferUIDeps = {
    get_incoming_offers: () => state.incoming_offers,
    get_progress: () => state.progress,
    get_completed: () => state.completed,
    get_sent: () => state.sent,
    get_sending: () => state.sending,
    get_pending_sent: () => state.pending_sent,
    set_incoming_offers: (v) => { state.incoming_offers = v; },
    set_progress: (v) => { state.progress = v; },
    set_completed: (v) => { state.completed = v; },
    set_sent: (v) => { state.sent = v; },
    set_sending: (v) => { state.sending = v; },
    set_pending_sent: (v) => { state.pending_sent = v; },
    get_file_transfer_managers: () => new Map(),
    get_peer_relay_status: (_peer_id) => false,
    has_custom_turn: () => false,
    get_remote_handle: (peer_id) => `handle-${peer_id}`,
    add_peer_toast: (msg) => { toasts.push(msg); },
    set_error: (msg) => { errors.push(msg); },
    ...overrides,
  };

  return { deps, state, toasts, errors };
}

function make_offer(transfer_id = "tid-1", filename = "test.txt"): IncomingOffer {
  return { transfer_id, filename, size: 1024 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileTransferUIManager.make_callbacks()", () => {
  describe("onIncomingOffer", () => {
    it("adds offer to incoming_offers", () => {
      const { deps, state } = make_deps();
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");
      const offer = make_offer("tid-1");

      callbacks.onIncomingOffer(offer);

      expect(state.incoming_offers.get("tid-1")).toEqual(offer);
    });
  });

  describe("onProgress", () => {
    it("updates progress map", () => {
      const { deps, state } = make_deps();
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");

      callbacks.onProgress("tid-1", 512, 1024);

      expect(state.progress.get("tid-1")).toEqual({ received: 512, total: 1024 });
    });

    it("removes offer from incoming_offers when progress starts", () => {
      const { deps, state } = make_deps();
      state.incoming_offers.set("tid-1", make_offer("tid-1"));
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");

      callbacks.onProgress("tid-1", 1, 1024);

      expect(state.incoming_offers.has("tid-1")).toBe(false);
    });
  });

  describe("onFileReceived", () => {
    it("adds entry to completed and removes from progress", () => {
      // Mock URL.createObjectURL
      globalThis.URL = {
        createObjectURL: vi.fn().mockReturnValue("blob:test/url"),
        revokeObjectURL: vi.fn(),
      } as unknown as typeof URL;

      const { deps, state } = make_deps();
      state.progress.set("tid-1", { received: 1024, total: 1024 });
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");

      const blob = new Blob(["data"]);
      callbacks.onFileReceived("tid-1", blob, "test.txt");

      expect(state.progress.has("tid-1")).toBe(false);
      expect(state.completed.get("tid-1")).toEqual({
        url: "blob:test/url",
        filename: "test.txt",
      });
    });
  });

  describe("onTransferAccepted", () => {
    it("moves transfer from pending_sent to sending", () => {
      const { deps, state } = make_deps();
      state.pending_sent.set("tid-1", { filename: "doc.pdf", handle: "handle-peer-1" });
      state.sending.set("tid-1", { filename: "doc.pdf", handle: "handle-peer-1" });
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");

      callbacks.onTransferAccepted("tid-1");

      expect(state.pending_sent.has("tid-1")).toBe(false);
      expect(state.sending.has("tid-1")).toBeTruthy();
    });
  });

  describe("onFileSent", () => {
    it("moves transfer from sending to sent", () => {
      const { deps, state } = make_deps();
      state.sending.set("tid-1", { filename: "file.zip", handle: "Bob" });
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");

      callbacks.onFileSent("tid-1");

      expect(state.sending.has("tid-1")).toBe(false);
      expect(state.sent.get("tid-1")).toEqual({ filename: "file.zip", handle: "Bob" });
    });
  });

  describe("onTransferCancelled", () => {
    it("removes the transfer from all state maps", () => {
      const { deps, state } = make_deps();
      state.incoming_offers.set("tid-1", make_offer("tid-1"));
      state.progress.set("tid-1", { received: 0, total: 100 });
      state.sending.set("tid-1", { filename: "file", handle: "Bob" });
      state.pending_sent.set("tid-1", { filename: "file", handle: "Bob" });
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");

      callbacks.onTransferCancelled("tid-1");

      expect(state.incoming_offers.has("tid-1")).toBe(false);
      expect(state.progress.has("tid-1")).toBe(false);
      expect(state.sending.has("tid-1")).toBe(false);
      expect(state.pending_sent.has("tid-1")).toBe(false);
    });
  });

  describe("onError", () => {
    it("calls set_error with the message", () => {
      const { deps, errors } = make_deps();
      const manager = new FileTransferUIManager(deps);
      const callbacks = manager.make_callbacks("peer-1");

      callbacks.onError("transfer failed");

      expect(errors).toContain("transfer failed");
    });
  });
});

describe("FileTransferUIManager.accept()", () => {
  it("calls acceptTransfer on each manager and removes from incoming_offers", () => {
    const accept_mock = vi.fn();
    const ft_manager = { acceptTransfer: accept_mock } as never;

    const { deps, state } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager]]),
    });
    state.incoming_offers.set("tid-1", make_offer("tid-1"));
    const manager = new FileTransferUIManager(deps);

    manager.accept("tid-1");

    expect(accept_mock).toHaveBeenCalledWith("tid-1");
    expect(state.incoming_offers.has("tid-1")).toBe(false);
  });
});

describe("FileTransferUIManager.decline()", () => {
  it("calls declineTransfer on each manager and removes from incoming_offers", () => {
    const decline_mock = vi.fn();
    const ft_manager = { declineTransfer: decline_mock } as never;

    const { deps, state } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager]]),
    });
    state.incoming_offers.set("tid-1", make_offer("tid-1"));
    const manager = new FileTransferUIManager(deps);

    manager.decline("tid-1");

    expect(decline_mock).toHaveBeenCalledWith("tid-1");
    expect(state.incoming_offers.has("tid-1")).toBe(false);
  });
});

describe("FileTransferUIManager.cancel()", () => {
  it("cancels outgoing transfer via specific peer manager", () => {
    const cancel_mock = vi.fn();
    const ft_manager = { cancelTransfer: cancel_mock } as never;

    const { deps, state } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager]]),
    });
    state.pending_sent.set("tid-1", { filename: "f", handle: "Bob" });
    state.sending.set("tid-1", { filename: "f", handle: "Bob" });

    const manager = new FileTransferUIManager(deps);
    // Simulate having sent to peer-1.
    const callbacks = manager.make_callbacks("peer-1");
    // Build outgoing state by simulating a sendFile result.
    // We register the transfer_to_peer mapping via send_to_all_peers with a mock.
    // Easier: just call cancel on a known-outgoing transfer_id by registering it manually
    // through the callbacks flow. Instead, let's test via send_to_all_peers.

    // Use send_to_all_peers to register the transfer_id.
    const transfer_id_returned = "tid-x";
    const send_file_mock = vi.fn().mockReturnValue(transfer_id_returned);
    const ft_manager2 = { sendFile: send_file_mock, cancelTransfer: cancel_mock } as never;

    const { deps: deps2, state: state2 } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager2]]),
    });
    const manager2 = new FileTransferUIManager(deps2);

    const file = new File(["data"], "test.txt");
    manager2.send_to_all_peers(file);

    // Now cancel the transfer that was just created.
    manager2.cancel(transfer_id_returned);

    expect(cancel_mock).toHaveBeenCalledWith(transfer_id_returned);
    expect(state2.pending_sent.has(transfer_id_returned)).toBe(false);
    expect(state2.sending.has(transfer_id_returned)).toBe(false);
  });

  it("cancels incoming transfer across all managers and removes from progress", () => {
    const cancel_mock = vi.fn();
    const ft_manager = { cancelTransfer: cancel_mock } as never;

    const { deps, state } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager]]),
    });
    state.progress.set("tid-incoming", { received: 100, total: 1000 });
    const manager = new FileTransferUIManager(deps);

    // An incoming transfer_id is not in transfer_to_peer, so cancel routes to all.
    manager.cancel("tid-incoming");

    expect(cancel_mock).toHaveBeenCalledWith("tid-incoming");
    expect(state.progress.has("tid-incoming")).toBe(false);
  });
});

describe("FileTransferUIManager.dismiss_completed()", () => {
  it("removes entry from completed and revokes the object URL", () => {
    const revoke_mock = vi.fn();
    globalThis.URL = {
      createObjectURL: vi.fn().mockReturnValue("blob:url"),
      revokeObjectURL: revoke_mock,
    } as unknown as typeof URL;

    const { deps, state } = make_deps();
    state.completed.set("tid-1", { url: "blob:url", filename: "file.pdf" });
    const manager = new FileTransferUIManager(deps);

    manager.dismiss_completed("tid-1");

    expect(state.completed.has("tid-1")).toBe(false);
    expect(revoke_mock).toHaveBeenCalledWith("blob:url");
  });
});

describe("FileTransferUIManager.dismiss_sent()", () => {
  it("removes entry from sent", () => {
    const { deps, state } = make_deps();
    state.sent.set("tid-1", { filename: "file.pdf", handle: "Bob" });
    const manager = new FileTransferUIManager(deps);

    manager.dismiss_sent("tid-1");

    expect(state.sent.has("tid-1")).toBe(false);
  });
});

describe("FileTransferUIManager.send_to_all_peers()", () => {
  it("sends file to each connected peer and adds to pending_sent", () => {
    const transfer_id = "tid-new";
    const send_mock = vi.fn().mockReturnValue(transfer_id);
    const ft_manager = { sendFile: send_mock } as never;

    const { deps, state } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager]]),
      get_remote_handle: (peer_id) => `handle-${peer_id}`,
    });
    const manager = new FileTransferUIManager(deps);

    const file = new File(["content"], "data.txt");
    manager.send_to_all_peers(file);

    expect(send_mock).toHaveBeenCalledWith(file);
    expect(state.pending_sent.has(transfer_id)).toBe(true);
    expect(state.pending_sent.get(transfer_id)?.filename).toBe("data.txt");
    expect(state.pending_sent.get(transfer_id)?.handle).toBe("handle-peer-1");
  });

  it("skips relayed peer when file exceeds 5 MB cap and no custom TURN", () => {
    const send_mock = vi.fn().mockReturnValue("tid-1");
    const ft_manager = { sendFile: send_mock } as never;

    const { deps, state, toasts } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager]]),
      get_peer_relay_status: (_id) => true,
      has_custom_turn: () => false,
    });
    const manager = new FileTransferUIManager(deps);

    // Create a 6 MB file (over the 5 MB limit).
    const big_content = new Uint8Array(6 * 1024 * 1024);
    const file = new File([big_content], "large.bin");
    manager.send_to_all_peers(file);

    expect(send_mock).not.toHaveBeenCalled();
    expect(state.pending_sent.size).toBe(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain("5 MB");
  });

  it("allows large file to relayed peer when custom TURN is configured", () => {
    const send_mock = vi.fn().mockReturnValue("tid-1");
    const ft_manager = { sendFile: send_mock } as never;

    const { deps } = make_deps({
      get_file_transfer_managers: () => new Map([["peer-1", ft_manager]]),
      get_peer_relay_status: (_id) => true,
      has_custom_turn: () => true,
    });
    const manager = new FileTransferUIManager(deps);

    const big_content = new Uint8Array(6 * 1024 * 1024);
    const file = new File([big_content], "large.bin");
    manager.send_to_all_peers(file);

    expect(send_mock).toHaveBeenCalledWith(file);
  });

  it("shows relay toast only once when multiple relayed peers are skipped", () => {
    const ft_manager1 = { sendFile: vi.fn().mockReturnValue(null) } as never;
    const ft_manager2 = { sendFile: vi.fn().mockReturnValue(null) } as never;

    const { deps, toasts } = make_deps({
      get_file_transfer_managers: () =>
        new Map([
          ["peer-1", ft_manager1],
          ["peer-2", ft_manager2],
        ]),
      get_peer_relay_status: (_id) => true,
      has_custom_turn: () => false,
    });
    const manager = new FileTransferUIManager(deps);

    const big_content = new Uint8Array(6 * 1024 * 1024);
    const file = new File([big_content], "large.bin");
    manager.send_to_all_peers(file);

    // Toast should only show once, not once per relayed peer.
    expect(toasts).toHaveLength(1);
  });
});
