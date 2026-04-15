import {
  VOICE_CALL_MAX_MS,
  VOICE_CALL_WARNING_MS,
} from "$lib/constants/rtc.ts";
import type { RTCPeerManager, PeerManagerState } from "./peer.ts";

// ---------------------------------------------------------------------------
// Dependency interface — injected by App.svelte so the manager can read
// current connection state and push reactive updates back to the component.
// ---------------------------------------------------------------------------

export interface VoiceCallManagerDeps {
  // Accessors for App.svelte state (always reflect current value at call time).
  get_local_handle(): string;
  get_data_channels(): Map<string, RTCDataChannel>;
  get_peer_managers(): Map<string, RTCPeerManager>;
  get_peer_states(): Map<string, PeerManagerState>;
  get_voice_active(): boolean;
  get_remote_voice_active(): Map<string, string>;
  get_peers_with_audio(): Set<string>;

  // Setters — App.svelte updates its $state vars when these are called.
  set_voice_active(value: boolean): void;
  set_voice_warning_visible(value: boolean): void;
  set_remote_voice_active(value: Map<string, string>): void;
  set_peers_with_audio(value: Set<string>): void;

  // Side-effect callbacks.
  add_peer_toast(message: string): void;
  set_error(message: string): void;

  // Called when a renegotiation offer needs to be sent to a specific peer
  // (e.g. when they send voice-start and we're already in a call as the offerer).
  trigger_renegotiation(peer_id: string): void;
}

// ---------------------------------------------------------------------------
// VoiceCallManager
//
// Owns all voice-call internal state and logic. Reactive state lives in
// App.svelte (so Svelte can drive the UI), but this class controls it
// entirely through the deps callbacks.
//
// Designed to be unit-testable: pass mock deps and call methods, assert
// the callbacks fired with the expected arguments.
// ---------------------------------------------------------------------------

export class VoiceCallManager {
  private local_voice_stream: MediaStream | null = null;
  // peer_id → <audio> element for remote audio playback.
  private remote_audio_nodes = new Map<string, HTMLAudioElement>();
  // peer_ids where we've already added our mic via beforeAnswer in this call cycle.
  private answerer_voice_added = new Set<string>();
  private voice_warning_timeout_id: ReturnType<typeof setTimeout> | null = null;
  private voice_max_timeout_id: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: VoiceCallManagerDeps) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Start a voice call: acquire mic, notify peers, add tracks to connections. */
  async start(): Promise<void> {
    try {
      this.local_voice_stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch {
      this.deps.set_error("Microphone permission denied or unavailable");
      return;
    }

    this.deps.set_voice_active(true);

    // Hard cap timers: warn at 3 h 45 min, auto-disconnect at 4 h.
    this.voice_warning_timeout_id = setTimeout(() => {
      this.deps.set_voice_warning_visible(true);
      this.voice_warning_timeout_id = null;
    }, VOICE_CALL_WARNING_MS);

    this.voice_max_timeout_id = setTimeout(() => {
      this.voice_max_timeout_id = null;
      this.stop();
      this.deps.add_peer_toast("Voice call ended automatically after 4 hours.");
    }, VOICE_CALL_MAX_MS);

    // Notify all connected peers.
    const msg = JSON.stringify({
      type: "voice-start",
      handle: this.deps.get_local_handle(),
    });
    this.deps.get_data_channels().forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(msg);
      }
    });

    // Add mic track to each connected peer where we are the offerer.
    // (Answerer peers get the track via beforeAnswer hook.)
    for (const [peer_id, manager] of this.deps.get_peer_managers()) {
      if (
        this.deps.get_peer_states().get(peer_id) === "connected" &&
        manager.getIsOfferer()
      ) {
        for (const track of this.local_voice_stream.getTracks()) {
          manager.addTrack(track, this.local_voice_stream);
        }
      }
    }
  }

  /** End the voice call: clean up all resources and notify peers. */
  stop(): void {
    this.deps.set_voice_active(false);
    this.deps.set_voice_warning_visible(false);

    if (this.voice_warning_timeout_id !== null) {
      clearTimeout(this.voice_warning_timeout_id);
      this.voice_warning_timeout_id = null;
    }
    if (this.voice_max_timeout_id !== null) {
      clearTimeout(this.voice_max_timeout_id);
      this.voice_max_timeout_id = null;
    }

    // Notify all connected peers.
    const msg = JSON.stringify({ type: "voice-stop" });
    this.deps.get_data_channels().forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(msg);
      }
    });

    // Remove all audio tracks from every peer connection.
    for (const manager of this.deps.get_peer_managers().values()) {
      manager.removeAudioTracks();
    }

    this.answerer_voice_added.clear();
    this.deps.set_remote_voice_active(new Map());
    this.deps.set_peers_with_audio(new Set());

    // Stop the local mic.
    this.local_voice_stream?.getTracks().forEach((track) => track.stop());
    this.local_voice_stream = null;

    // Detach remote audio elements.
    for (const audio_el of this.remote_audio_nodes.values()) {
      audio_el.srcObject = null;
      audio_el.remove();
    }
    this.remote_audio_nodes.clear();
  }

  /** Toggle voice call on/off. */
  async toggle(): Promise<void> {
    if (this.deps.get_voice_active()) {
      this.stop();
    } else {
      await this.start();
    }
  }

  /**
   * Handle an RTCTrackEvent from a remote peer connection.
   * Called by the onTrack callback in App.svelte.
   */
  handle_remote_track(peer_id: string, event: RTCTrackEvent): void {
    if (event.streams.length === 0) {
      return;
    }
    let audio_el = this.remote_audio_nodes.get(peer_id);
    if (audio_el === undefined) {
      audio_el = document.createElement("audio");
      audio_el.autoplay = true;
      document.body.appendChild(audio_el);
      this.remote_audio_nodes.set(peer_id, audio_el);
    }
    audio_el.srcObject = event.streams[0];
    // Mark this peer as having delivered audio — transitions icon: connecting → active.
    this.deps.set_peers_with_audio(
      new Set(this.deps.get_peers_with_audio()).add(peer_id),
    );
  }

  /**
   * Called from the peer connection's beforeAnswer hook.
   * Adds our local mic tracks to the peer connection if both sides have voice active.
   */
  async before_answer(peer_id: string, pc: RTCPeerConnection): Promise<void> {
    // Only add our mic when:
    // 1. We have voice active (user clicked the phone button)
    // 2. The remote peer also has voice active (they sent voice-start)
    //    — prevents auto-adding during a hang-up renegotiation where the
    //    offerer removed their tracks but voice-stop already cleared remote_voice_active
    // 3. We haven't already added our mic for this peer in the current call cycle
    if (
      !this.deps.get_voice_active() ||
      this.local_voice_stream === null ||
      !this.deps.get_remote_voice_active().has(peer_id) ||
      this.answerer_voice_added.has(peer_id)
    ) {
      return;
    }
    for (const track of this.local_voice_stream.getTracks()) {
      pc.addTrack(track, this.local_voice_stream);
    }
    this.answerer_voice_added.add(peer_id);
  }

  /**
   * Process a voice-related data channel message from a remote peer.
   * Called from the channel message handler in App.svelte.
   */
  handle_data_message(
    peer_id: string,
    msg: { type?: string; handle?: string },
  ): void {
    if (msg.type === "voice-start" && typeof msg.handle === "string") {
      const remote_voice = new Map(this.deps.get_remote_voice_active());
      const was_anyone_calling = remote_voice.size > 0;
      remote_voice.set(peer_id, msg.handle);
      // Reset so beforeAnswer can add our mic again on the next renegotiation.
      this.answerer_voice_added.delete(peer_id);
      this.deps.set_remote_voice_active(remote_voice);

      if (!was_anyone_calling && !this.deps.get_voice_active()) {
        this.deps.add_peer_toast(`${msg.handle} started a voice call`);
      }

      // If we are the offerer and already in a call, the answerer just joined.
      // Our original offer was sent before they had voice_active=true, so
      // beforeAnswer returned early without adding their mic. Trigger a fresh offer.
      this.deps.trigger_renegotiation(peer_id);
    } else if (msg.type === "voice-stop") {
      const remote_voice = new Map(this.deps.get_remote_voice_active());
      remote_voice.delete(peer_id);
      // Reset so the next call cycle can add our mic cleanly.
      this.answerer_voice_added.delete(peer_id);
      this.deps.set_remote_voice_active(remote_voice);

      // If we are the offerer for this peer, renegotiate to remove audio from SDP.
      // (Without this, the answerer's removeTrack fires onnegotiationneeded on
      // their side where there is no handler, leaving SDP out of sync.)
      const manager = this.deps.get_peer_managers().get(peer_id);
      if (manager?.getIsOfferer() === true) {
        manager.removeAudioTracks();
      }

      // If this was the last peer in the call, auto-stop so our icon returns to inactive.
      if (remote_voice.size === 0 && this.deps.get_voice_active()) {
        this.stop();
      }
    }
  }

  /**
   * Returns the JSON message string to send to a newly opened data channel if
   * voice is currently active. Returns null if voice is not active.
   * Called from registerDataChannel to include voice state in the initial handshake.
   */
  initial_channel_voice_message(): string | null {
    if (!this.deps.get_voice_active()) {
      return null;
    }
    return JSON.stringify({
      type: "voice-start",
      handle: this.deps.get_local_handle(),
    });
  }

  /**
   * Clean up all voice state associated with a peer that has disconnected.
   * Called from disconnectPeer in App.svelte.
   */
  cleanup_peer(peer_id: string): void {
    this.answerer_voice_added.delete(peer_id);

    const remote_voice = this.deps.get_remote_voice_active();
    if (remote_voice.has(peer_id)) {
      const updated = new Map(remote_voice);
      updated.delete(peer_id);
      this.deps.set_remote_voice_active(updated);
    }

    const peers_with_audio = this.deps.get_peers_with_audio();
    if (peers_with_audio.has(peer_id)) {
      const updated = new Set(peers_with_audio);
      updated.delete(peer_id);
      this.deps.set_peers_with_audio(updated);
    }

    const audio_el = this.remote_audio_nodes.get(peer_id);
    if (audio_el !== undefined) {
      audio_el.srcObject = null;
      audio_el.remove();
      this.remote_audio_nodes.delete(peer_id);
    }
  }
}
