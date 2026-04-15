// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { VoiceCallManager } from "../src/rtc/voice_manager.ts";
import type { VoiceCallManagerDeps } from "../src/rtc/voice_manager.ts";

// ---------------------------------------------------------------------------
// Helper: mock navigator.mediaDevices.getUserMedia
// navigator is a getter-only property in Node — use Object.defineProperty.
// ---------------------------------------------------------------------------

function mock_get_user_media(result: Promise<MediaStream>): void {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: vi.fn().mockReturnValue(result),
      },
    },
    writable: true,
    configurable: true,
  });
}

function make_mock_stream(tracks: Array<{ kind: string }> = []): MediaStream {
  return {
    getTracks: () => tracks.map((t) => ({ ...t, stop: vi.fn() })),
  } as unknown as MediaStream;
}

// ---------------------------------------------------------------------------
// Helpers for building mock deps
// ---------------------------------------------------------------------------

function make_deps(overrides: Partial<VoiceCallManagerDeps> = {}): {
  deps: VoiceCallManagerDeps;
  state: {
    voice_active: boolean;
    voice_warning_visible: boolean;
    remote_voice_active: Map<string, string>;
    peers_with_audio: Set<string>;
  };
  toasts: string[];
  errors: string[];
  renegotiations: string[];
} {
  const state = {
    voice_active: false,
    voice_warning_visible: false,
    remote_voice_active: new Map<string, string>(),
    peers_with_audio: new Set<string>(),
  };
  const toasts: string[] = [];
  const errors: string[] = [];
  const renegotiations: string[] = [];

  const deps: VoiceCallManagerDeps = {
    get_local_handle: () => "Alice",
    get_data_channels: () => new Map(),
    get_peer_managers: () => new Map(),
    get_peer_states: () => new Map(),
    get_voice_active: () => state.voice_active,
    get_remote_voice_active: () => state.remote_voice_active,
    get_peers_with_audio: () => state.peers_with_audio,
    set_voice_active: (v) => {
      state.voice_active = v;
    },
    set_voice_warning_visible: (v) => {
      state.voice_warning_visible = v;
    },
    set_remote_voice_active: (m) => {
      state.remote_voice_active = m;
    },
    set_peers_with_audio: (s) => {
      state.peers_with_audio = s;
    },
    add_peer_toast: (msg) => {
      toasts.push(msg);
    },
    set_error: (msg) => {
      errors.push(msg);
    },
    trigger_renegotiation: (peer_id) => {
      renegotiations.push(peer_id);
    },
    ...overrides,
  };

  return { deps, state, toasts, errors, renegotiations };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoiceCallManager", () => {
  describe("start()", () => {
    it("sets voice_active to true after acquiring mic", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream([{ kind: "audio" }])));
      const { deps, state } = make_deps();
      const manager = new VoiceCallManager(deps);
      await manager.start();
      expect(state.voice_active).toBe(true);
    });

    it("sends voice-start message to all open data channels", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream()));
      const sent_messages: string[] = [];
      const mock_channel = {
        readyState: "open" as RTCDataChannelState,
        send: (msg: string) => {
          sent_messages.push(msg);
        },
      } as unknown as RTCDataChannel;

      const { deps } = make_deps({
        get_data_channels: () => new Map([["peer-1", mock_channel]]),
      });
      const manager = new VoiceCallManager(deps);
      await manager.start();

      expect(sent_messages).toHaveLength(1);
      const parsed = JSON.parse(sent_messages[0]) as { type: string; handle: string };
      expect(parsed.type).toBe("voice-start");
      expect(parsed.handle).toBe("Alice");
    });

    it("calls set_error and does not set voice_active if getUserMedia fails", async () => {
      mock_get_user_media(Promise.reject(new Error("denied")));
      const { deps, state, errors } = make_deps();
      const manager = new VoiceCallManager(deps);
      await manager.start();
      expect(state.voice_active).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Microphone permission");
    });
  });

  describe("stop()", () => {
    it("resets all voice state", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream([{ kind: "audio" }])));
      const { deps, state } = make_deps();
      const manager = new VoiceCallManager(deps);
      await manager.start();

      state.remote_voice_active.set("peer-1", "Bob");
      state.peers_with_audio.add("peer-1");
      manager.stop();

      expect(state.voice_active).toBe(false);
      expect(state.voice_warning_visible).toBe(false);
      expect(state.remote_voice_active.size).toBe(0);
      expect(state.peers_with_audio.size).toBe(0);
    });

    it("sends voice-stop message to all open data channels", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream()));
      const sent_messages: string[] = [];
      const mock_channel = {
        readyState: "open" as RTCDataChannelState,
        send: (msg: string) => {
          sent_messages.push(msg);
        },
      } as unknown as RTCDataChannel;

      const { deps } = make_deps({
        get_data_channels: () => new Map([["peer-1", mock_channel]]),
      });
      const manager = new VoiceCallManager(deps);
      await manager.start();
      sent_messages.length = 0;

      manager.stop();

      expect(sent_messages).toHaveLength(1);
      const parsed = JSON.parse(sent_messages[0]) as { type: string };
      expect(parsed.type).toBe("voice-stop");
    });
  });

  describe("toggle()", () => {
    it("starts when inactive, stops when active", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream()));
      const { deps, state } = make_deps();
      const manager = new VoiceCallManager(deps);

      await manager.toggle();
      expect(state.voice_active).toBe(true);

      await manager.toggle();
      expect(state.voice_active).toBe(false);
    });
  });

  describe("handle_data_message()", () => {
    it("adds peer to remote_voice_active on voice-start", () => {
      const { deps, state } = make_deps();
      const manager = new VoiceCallManager(deps);

      manager.handle_data_message("peer-1", { type: "voice-start", handle: "Bob" });

      expect(state.remote_voice_active.get("peer-1")).toBe("Bob");
    });

    it("shows toast when first peer starts a call and we are not active", () => {
      const { deps, toasts } = make_deps();
      const manager = new VoiceCallManager(deps);

      manager.handle_data_message("peer-1", { type: "voice-start", handle: "Bob" });

      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toContain("Bob");
      expect(toasts[0]).toContain("started a voice call");
    });

    it("does not show toast if someone is already calling", () => {
      const { deps, state, toasts } = make_deps();
      state.remote_voice_active.set("peer-1", "Bob");
      const manager = new VoiceCallManager(deps);

      manager.handle_data_message("peer-2", { type: "voice-start", handle: "Carol" });

      expect(toasts).toHaveLength(0);
    });

    it("removes peer from remote_voice_active on voice-stop", () => {
      const { deps, state } = make_deps();
      state.remote_voice_active.set("peer-1", "Bob");
      const manager = new VoiceCallManager(deps);

      manager.handle_data_message("peer-1", { type: "voice-stop" });

      expect(state.remote_voice_active.has("peer-1")).toBe(false);
    });

    it("auto-stops our own call when the last remote peer stops", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream()));
      const { deps, state } = make_deps();
      state.remote_voice_active.set("peer-1", "Bob");
      const manager = new VoiceCallManager(deps);
      await manager.start();

      manager.handle_data_message("peer-1", { type: "voice-stop" });

      expect(state.voice_active).toBe(false);
    });

    it("calls trigger_renegotiation when voice-start arrives and we are the offerer in a call", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream()));

      const mock_manager = {
        getIsOfferer: () => true,
        sendRenegotiationOffer: vi.fn(),
        addTrack: vi.fn(),
        removeAudioTracks: vi.fn(),
      };

      const renegotiations: string[] = [];
      const { deps, state } = make_deps({
        get_peer_managers: () => new Map([["peer-1", mock_manager as never]]),
        trigger_renegotiation: (peer_id) => {
          if (mock_manager.getIsOfferer() && state.voice_active) {
            renegotiations.push(peer_id);
          }
        },
      });
      const manager = new VoiceCallManager(deps);
      await manager.start();

      manager.handle_data_message("peer-1", { type: "voice-start", handle: "Bob" });

      expect(renegotiations).toContain("peer-1");
    });
  });

  describe("before_answer()", () => {
    it("adds mic track to peer connection when all conditions met", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream([{ kind: "audio" }])));
      const { deps, state } = make_deps();
      state.remote_voice_active.set("peer-1", "Bob");
      const manager = new VoiceCallManager(deps);
      await manager.start();

      const add_track_calls: Array<[unknown, unknown]> = [];
      const mock_pc = {
        addTrack: (track: unknown, stream: unknown) => {
          add_track_calls.push([track, stream]);
        },
      } as unknown as RTCPeerConnection;

      await manager.before_answer("peer-1", mock_pc);
      expect(add_track_calls).toHaveLength(1);
    });

    it("does not add track if voice not active", async () => {
      const { deps } = make_deps();
      const manager = new VoiceCallManager(deps);

      const add_track_calls: unknown[] = [];
      const mock_pc = {
        addTrack: (t: unknown) => {
          add_track_calls.push(t);
        },
      } as unknown as RTCPeerConnection;

      await manager.before_answer("peer-1", mock_pc);
      expect(add_track_calls).toHaveLength(0);
    });

    it("does not add track twice for the same peer in a call cycle", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream([{ kind: "audio" }])));
      const { deps, state } = make_deps();
      state.remote_voice_active.set("peer-1", "Bob");
      const manager = new VoiceCallManager(deps);
      await manager.start();

      const add_track_calls: unknown[] = [];
      const mock_pc = {
        addTrack: (t: unknown) => {
          add_track_calls.push(t);
        },
      } as unknown as RTCPeerConnection;

      await manager.before_answer("peer-1", mock_pc);
      await manager.before_answer("peer-1", mock_pc);
      expect(add_track_calls).toHaveLength(1);
    });
  });

  describe("cleanup_peer()", () => {
    it("removes peer from remote_voice_active and peers_with_audio", () => {
      const { deps, state } = make_deps();
      state.remote_voice_active.set("peer-1", "Bob");
      state.peers_with_audio.add("peer-1");
      const manager = new VoiceCallManager(deps);

      manager.cleanup_peer("peer-1");

      expect(state.remote_voice_active.has("peer-1")).toBe(false);
      expect(state.peers_with_audio.has("peer-1")).toBe(false);
    });

    it("is a no-op for a peer not in voice state", () => {
      const { deps, state } = make_deps();
      const manager = new VoiceCallManager(deps);

      // Should not throw.
      expect(() => manager.cleanup_peer("nonexistent-peer")).not.toThrow();
      expect(state.remote_voice_active.size).toBe(0);
    });
  });

  describe("initial_channel_voice_message()", () => {
    it("returns null when voice is not active", () => {
      const { deps } = make_deps();
      const manager = new VoiceCallManager(deps);

      expect(manager.initial_channel_voice_message()).toBeNull();
    });

    it("returns voice-start JSON when voice is active", async () => {
      mock_get_user_media(Promise.resolve(make_mock_stream()));
      const { deps } = make_deps();
      const manager = new VoiceCallManager(deps);
      await manager.start();

      const msg_str = manager.initial_channel_voice_message();
      expect(msg_str).not.toBeNull();
      const msg = JSON.parse(msg_str!) as { type: string; handle: string };
      expect(msg.type).toBe("voice-start");
      expect(msg.handle).toBe("Alice");
    });
  });
});
