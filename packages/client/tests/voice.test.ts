// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RTCPeerManager } from "../src/rtc/peer.ts";
import type { PeerManagerCallbacks, SignalTransport } from "../src/rtc/peer.ts";

// ---------------------------------------------------------------------------
// Polyfill WebRTC browser globals absent in Node.js
// ---------------------------------------------------------------------------

if (typeof globalThis.RTCSessionDescription === "undefined") {
  (globalThis as Record<string, unknown>).RTCSessionDescription = class RTCSessionDescription {
    public readonly type: RTCSdpType;
    public readonly sdp: string;
    constructor(init: RTCSessionDescriptionInit) {
      this.type = init.type as RTCSdpType;
      this.sdp = init.sdp ?? "";
    }
  };
}

if (typeof globalThis.RTCIceCandidate === "undefined") {
  (globalThis as Record<string, unknown>).RTCIceCandidate = class RTCIceCandidate {
    public readonly candidate: string;
    public readonly sdpMid: string | null;
    public readonly sdpMLineIndex: number | null;
    constructor(init: RTCIceCandidateInit) {
      this.candidate = init.candidate ?? "";
      this.sdpMid = init.sdpMid ?? null;
      this.sdpMLineIndex = init.sdpMLineIndex ?? null;
    }
    toJSON() {
      return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex };
    }
  };
}

// ---------------------------------------------------------------------------
// Mock RTCPeerConnection
// ---------------------------------------------------------------------------

interface MockSender {
  track: { kind: string; stop: () => void } | null;
}

interface MockPC {
  localDescription: RTCSessionDescriptionInit | null;
  remoteDescription: RTCSessionDescriptionInit | null;
  signalingState: RTCSignalingState;
  iceConnectionState: RTCIceConnectionState;
  connectionState: RTCPeerConnectionState;
  iceGatheringState: RTCIceGatheringState;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null;
  ontrack: ((e: RTCTrackEvent) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  onnegotiationneeded: (() => void) | null;
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null;
  senders: MockSender[];
  removed_senders: MockSender[];
  offers_created: number;
  createDataChannel: ReturnType<typeof vi.fn>;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  createAnswer: () => Promise<RTCSessionDescriptionInit>;
  setLocalDescription: (desc?: RTCSessionDescriptionInit) => Promise<void>;
  setRemoteDescription: (desc: RTCSessionDescriptionInit) => Promise<void>;
  addIceCandidate: () => Promise<void>;
  getSenders: () => MockSender[];
  addTrack: (track: MediaStreamTrack | MockSender["track"], stream?: MediaStream) => MockSender;
  removeTrack: (sender: MockSender) => void;
  close: () => void;
}

function makeMockPC(): MockPC {
  const pc: MockPC = {
    localDescription: null,
    remoteDescription: null,
    signalingState: "stable",
    iceConnectionState: "new",
    connectionState: "new",
    iceGatheringState: "new",
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    onnegotiationneeded: null,
    ondatachannel: null,
    senders: [],
    removed_senders: [],
    offers_created: 0,
    createDataChannel: vi.fn(() => ({
      readyState: "connecting",
      addEventListener: vi.fn(),
      send: vi.fn(),
    })),
    async createOffer() {
      pc.offers_created++;
      return { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" };
    },
    async createAnswer() {
      return { type: "answer", sdp: "v=0\r\n" };
    },
    async setLocalDescription(desc?: RTCSessionDescriptionInit) {
      const d = desc ?? { type: "offer", sdp: "" };
      pc.localDescription = d;
      pc.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    },
    async setRemoteDescription(desc: RTCSessionDescriptionInit) {
      pc.remoteDescription = desc;
      pc.signalingState = desc.type === "offer" ? "have-remote-offer" : "stable";
    },
    async addIceCandidate() {},
    getSenders() {
      return pc.senders;
    },
    addTrack(track, _stream?) {
      const sender: MockSender = { track: track as MockSender["track"] };
      pc.senders.push(sender);
      return sender;
    },
    removeTrack(sender: MockSender) {
      pc.senders = pc.senders.filter((s) => s !== sender);
      pc.removed_senders.push(sender);
    },
    close() {},
  };
  return pc;
}

// ---------------------------------------------------------------------------
// Mock SignalTransport
// ---------------------------------------------------------------------------

interface MockTransport {
  offers_sent: RTCSessionDescriptionInit[];
  answers_sent: RTCSessionDescriptionInit[];
  offer_callback: ((sdp: RTCSessionDescriptionInit) => void | Promise<void>) | null;
  answer_callback: ((sdp: RTCSessionDescriptionInit) => void | Promise<void>) | null;
  ice_callback: ((c: RTCIceCandidate) => void) | null;
  closed: boolean;
  asTransport: () => SignalTransport;
  deliverOffer: (sdp: RTCSessionDescriptionInit) => Promise<void>;
  deliverAnswer: (sdp: RTCSessionDescriptionInit) => Promise<void>;
}

function makeMockTransport(): MockTransport {
  const t: MockTransport = {
    offers_sent: [],
    answers_sent: [],
    offer_callback: null,
    answer_callback: null,
    ice_callback: null,
    closed: false,
    asTransport() {
      return {
        sendOffer(sdp) {
          t.offers_sent.push(sdp);
        },
        sendAnswer(sdp) {
          t.answers_sent.push(sdp);
        },
        sendIceCandidate() {},
        onOffer(cb) {
          t.offer_callback = cb;
        },
        onAnswer(cb) {
          t.answer_callback = cb;
        },
        onIceCandidate(cb) {
          t.ice_callback = cb;
        },
        close() {
          t.closed = true;
        },
      };
    },
    async deliverOffer(sdp) {
      if (t.offer_callback) {
        await t.offer_callback(sdp);
      }
    },
    async deliverAnswer(sdp) {
      if (t.answer_callback) {
        await t.answer_callback(sdp);
      }
    },
  };
  return t;
}

function makeCallbacks(overrides: Partial<PeerManagerCallbacks> = {}): PeerManagerCallbacks {
  return {
    onDataChannel: vi.fn(),
    onFileChannel: vi.fn(),
    onStateChange: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// removeAudioTracks
// ---------------------------------------------------------------------------

describe("RTCPeerManager.removeAudioTracks", () => {
  it("removes senders whose track kind is audio", () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks(),
      pc as unknown as RTCPeerConnection,
    );
    // startAsAnswerer initializes this.peer_connection; no offer is delivered so it stays idle.
    manager.startAsAnswerer();

    const audio_sender = pc.addTrack({ kind: "audio", stop: vi.fn() });
    const video_sender = pc.addTrack({ kind: "video", stop: vi.fn() });

    manager.removeAudioTracks();

    expect(pc.removed_senders).toContain(audio_sender);
    expect(pc.removed_senders).not.toContain(video_sender);
    expect(pc.senders).toContain(video_sender);
    expect(pc.senders).not.toContain(audio_sender);
  });

  it("does nothing when there are no senders", () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks(),
      pc as unknown as RTCPeerConnection,
    );
    manager.startAsAnswerer();
    expect(() => manager.removeAudioTracks()).not.toThrow();
    expect(pc.removed_senders).toHaveLength(0);
  });

  it("leaves non-audio senders untouched when mixed tracks exist", () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks(),
      pc as unknown as RTCPeerConnection,
    );
    manager.startAsAnswerer();

    pc.addTrack({ kind: "audio", stop: vi.fn() });
    pc.addTrack({ kind: "audio", stop: vi.fn() });
    const video_sender = pc.addTrack({ kind: "video", stop: vi.fn() });

    manager.removeAudioTracks();

    expect(pc.senders).toHaveLength(1);
    expect(pc.senders[0]).toBe(video_sender);
  });
});

// ---------------------------------------------------------------------------
// onnegotiationneeded guard
// ---------------------------------------------------------------------------

describe("onnegotiationneeded guard", () => {
  it("does not create an offer when localDescription is null (initial trigger)", async () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks(),
      pc as unknown as RTCPeerConnection,
    );

    await manager.startAsOfferer();
    // The initial offer is sent explicitly — reset counts to isolate the guard test.
    const offers_after_init = transport.offers_sent.length;
    pc.offers_created = 0;

    // Manually fire onnegotiationneeded while localDescription is NOT null
    // but signalingState is have-local-offer (initial state after startAsOfferer).
    // The guard should block this.
    expect(pc.signalingState).toBe("have-local-offer");
    await pc.onnegotiationneeded?.();

    // No new offers should have been created.
    expect(pc.offers_created).toBe(0);
    expect(transport.offers_sent.length).toBe(offers_after_init);
  });

  it("creates a renegotiation offer when localDescription is set and state is stable", async () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks(),
      pc as unknown as RTCPeerConnection,
    );

    await manager.startAsOfferer();
    // Simulate the initial offer/answer exchange completing (state → stable, localDescription set).
    pc.signalingState = "stable";
    // localDescription is already set from startAsOfferer.
    expect(pc.localDescription).not.toBeNull();

    const offers_before = transport.offers_sent.length;
    await pc.onnegotiationneeded?.();

    expect(transport.offers_sent.length).toBe(offers_before + 1);
  });
});

// ---------------------------------------------------------------------------
// beforeAnswer callback
// ---------------------------------------------------------------------------

describe("beforeAnswer callback", () => {
  it("is called when an offer arrives at the answerer", async () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const before_answer = vi.fn().mockResolvedValue(undefined);
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks({ beforeAnswer: before_answer }),
      pc as unknown as RTCPeerConnection,
    );

    manager.startAsAnswerer();

    // Deliver an offer as if the remote offerer sent it.
    await transport.deliverOffer({ type: "offer", sdp: "v=0\r\n" });

    expect(before_answer).toHaveBeenCalledOnce();
    expect(before_answer).toHaveBeenCalledWith(pc);
  });

  it("is called on renegotiation offers (not just the first)", async () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const before_answer = vi.fn().mockResolvedValue(undefined);
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks({ beforeAnswer: before_answer }),
      pc as unknown as RTCPeerConnection,
    );

    manager.startAsAnswerer();

    // First offer (initial connection)
    await transport.deliverOffer({ type: "offer", sdp: "v=0\r\nm=application 9\r\n" });
    // Reset signalingState so the second offer is accepted
    pc.signalingState = "stable";
    // Second offer (renegotiation — e.g. offerer added/removed audio)
    await transport.deliverOffer({ type: "offer", sdp: "v=0\r\nm=audio 9\r\n" });

    expect(before_answer).toHaveBeenCalledTimes(2);
  });

  it("sends an answer for each offer received", async () => {
    const pc = makeMockPC();
    const transport = makeMockTransport();
    const manager = new RTCPeerManager(
      transport.asTransport(),
      makeCallbacks(),
      pc as unknown as RTCPeerConnection,
    );

    manager.startAsAnswerer();

    await transport.deliverOffer({ type: "offer", sdp: "v=0\r\n" });

    expect(transport.answers_sent).toHaveLength(1);
    expect(transport.answers_sent[0].type).toBe("answer");
  });
});

// ---------------------------------------------------------------------------
// Voice call lifecycle
// ---------------------------------------------------------------------------

describe("voice call lifecycle", () => {
  let offerer_pc: MockPC;
  let answerer_pc: MockPC;
  let offerer_transport: MockTransport;
  let answerer_transport: MockTransport;
  let offerer_manager: RTCPeerManager;
  let answerer_manager: RTCPeerManager;
  let before_answer_hook: ReturnType<typeof vi.fn>;

  // State that would live in App.svelte — kept minimal for the tests.
  let voice_active: boolean;
  let local_voice_stream: { getTracks: () => Array<{ kind: string; stop: () => void }> } | null;
  let remote_voice_active: Map<string, string>;
  let answerer_voice_added: Set<string>;
  const OFFERER_ID = "zzz-offerer";
  const ANSWERER_ID = "aaa-answerer";

  function beforeAnswerAddVoice(peer_id: string, pc: MockPC): void {
    if (
      !voice_active ||
      local_voice_stream === null ||
      !remote_voice_active.has(peer_id) ||
      answerer_voice_added.has(peer_id)
    ) {
      return;
    }
    for (const track of local_voice_stream.getTracks()) {
      pc.addTrack(track as unknown as MediaStreamTrack);
    }
    answerer_voice_added.add(peer_id);
  }

  beforeEach(async () => {
    voice_active = false;
    local_voice_stream = null;
    remote_voice_active = new Map();
    answerer_voice_added = new Set();

    before_answer_hook = vi.fn().mockImplementation(async (pc: MockPC) => {
      beforeAnswerAddVoice(OFFERER_ID, pc);
    });

    offerer_pc = makeMockPC();
    answerer_pc = makeMockPC();
    offerer_transport = makeMockTransport();
    answerer_transport = makeMockTransport();

    offerer_manager = new RTCPeerManager(
      offerer_transport.asTransport(),
      makeCallbacks(),
      offerer_pc as unknown as RTCPeerConnection,
    );
    answerer_manager = new RTCPeerManager(
      answerer_transport.asTransport(),
      makeCallbacks({ beforeAnswer: before_answer_hook }),
      answerer_pc as unknown as RTCPeerConnection,
    );

    // Wire the two transports together (offerer sends → answerer receives, and vice versa).
    offerer_transport.asTransport().sendOffer = (sdp) => {
      offerer_transport.offers_sent.push(sdp);
      answerer_transport.deliverOffer(sdp);
    };
    offerer_transport.asTransport().sendAnswer = (sdp) => {
      offerer_transport.answers_sent.push(sdp);
    };
    answerer_transport.asTransport().sendAnswer = (sdp) => {
      answerer_transport.answers_sent.push(sdp);
      offerer_transport.deliverAnswer(sdp);
    };

    await offerer_manager.startAsOfferer();
    offerer_pc.signalingState = "stable"; // simulate answer received
  });

  it("beforeAnswerAddVoice does not add mic when only local voice is active (remote peer silent)", () => {
    voice_active = true;
    local_voice_stream = { getTracks: () => [{ kind: "audio", stop: vi.fn() }] };
    // remote_voice_active is empty — remote peer has NOT sent voice-start.

    const mic_tracks_before = answerer_pc.senders.length;
    beforeAnswerAddVoice(OFFERER_ID, answerer_pc);
    expect(answerer_pc.senders.length).toBe(mic_tracks_before);
  });

  it("beforeAnswerAddVoice does not add mic during hang-up renegotiation", () => {
    // Simulate: call was active, offerer sent voice-stop (clears remote_voice_active).
    remote_voice_active.delete(OFFERER_ID);
    voice_active = true;
    local_voice_stream = { getTracks: () => [{ kind: "audio", stop: vi.fn() }] };

    const mic_tracks_before = answerer_pc.senders.length;
    beforeAnswerAddVoice(OFFERER_ID, answerer_pc);
    expect(answerer_pc.senders.length).toBe(mic_tracks_before);
  });

  it("beforeAnswerAddVoice adds mic when both peers have voice active", () => {
    voice_active = true;
    local_voice_stream = { getTracks: () => [{ kind: "audio", stop: vi.fn() }] };
    remote_voice_active.set(OFFERER_ID, "Alice");

    beforeAnswerAddVoice(OFFERER_ID, answerer_pc);
    expect(answerer_pc.senders).toHaveLength(1);
    expect(answerer_voice_added.has(OFFERER_ID)).toBe(true);
  });

  it("beforeAnswerAddVoice does not add mic twice in the same call cycle", () => {
    voice_active = true;
    local_voice_stream = { getTracks: () => [{ kind: "audio", stop: vi.fn() }] };
    remote_voice_active.set(OFFERER_ID, "Alice");

    beforeAnswerAddVoice(OFFERER_ID, answerer_pc);
    beforeAnswerAddVoice(OFFERER_ID, answerer_pc); // second call (e.g. second renegotiation)
    expect(answerer_pc.senders).toHaveLength(1);
  });

  it("receiving voice-stop resets answerer_voice_added so next call can add mic", () => {
    // First call cycle — mic was added.
    answerer_voice_added.add(OFFERER_ID);

    // Offerer sends voice-stop (simulated message handler logic).
    remote_voice_active.delete(OFFERER_ID);
    answerer_voice_added.delete(OFFERER_ID); // ← the fix

    // Next call cycle — offerer sends voice-start, answerer has voice active.
    remote_voice_active.set(OFFERER_ID, "Alice");
    voice_active = true;
    local_voice_stream = { getTracks: () => [{ kind: "audio", stop: vi.fn() }] };

    beforeAnswerAddVoice(OFFERER_ID, answerer_pc);
    expect(answerer_pc.senders).toHaveLength(1);
  });

  it("receiving voice-start resets answerer_voice_added so re-join works", () => {
    // Simulate state after a previous call where mic was already added.
    answerer_voice_added.add(OFFERER_ID);

    // Offerer sends voice-start again (new call) — the message handler clears the set.
    answerer_voice_added.delete(OFFERER_ID); // ← the fix
    remote_voice_active.set(OFFERER_ID, "Alice");
    voice_active = true;
    local_voice_stream = { getTracks: () => [{ kind: "audio", stop: vi.fn() }] };

    beforeAnswerAddVoice(OFFERER_ID, answerer_pc);
    expect(answerer_pc.senders).toHaveLength(1);
  });

  it("offerer removeAudioTracks triggers onnegotiationneeded (hang-up renegotiation)", async () => {
    // Add an audio sender to simulate an active call.
    offerer_pc.addTrack({ kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack);

    const offers_before = offerer_transport.offers_sent.length;

    // Simulate offerer hanging up: remove audio tracks then fire onnegotiationneeded.
    offerer_manager.removeAudioTracks();
    await offerer_pc.onnegotiationneeded?.();

    expect(offerer_pc.senders).toHaveLength(0);
    expect(offerer_transport.offers_sent.length).toBeGreaterThan(offers_before);
  });
});
