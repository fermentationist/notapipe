import { ICE_SERVERS, DATA_CHANNEL_LABEL } from "$lib/constants/rtc.ts";
import { FILE_TRANSFER_CHANNEL_LABEL } from "./file_transfer.ts";

// ---------------------------------------------------------------------------
// SignalTransport interface
// ---------------------------------------------------------------------------

export interface SignalTransport {
  sendOffer(sdp: RTCSessionDescriptionInit): void;
  sendAnswer(sdp: RTCSessionDescriptionInit): void;
  sendIceCandidate(candidate: RTCIceCandidate): void;
  onOffer(callback: (sdp: RTCSessionDescriptionInit) => void): void;
  onAnswer(callback: (sdp: RTCSessionDescriptionInit) => void): void;
  onIceCandidate(callback: (candidate: RTCIceCandidate) => void): void;
  close(): void;
}

// ---------------------------------------------------------------------------
// RTCPeerManager
// ---------------------------------------------------------------------------

export type PeerManagerState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface PeerManagerCallbacks {
  onDataChannel: (channel: RTCDataChannel) => void;
  onFileChannel: (channel: RTCDataChannel) => void;
  onStateChange: (state: PeerManagerState) => void;
  onError: (error: Error) => void;
  onTrack?: (event: RTCTrackEvent) => void;
  beforeAnswer?: (pc: RTCPeerConnection) => Promise<void>;
}

/**
 * Manages a single RTCPeerConnection using the provided SignalTransport.
 * The caller is responsible for determining the role (offerer vs answerer)
 * before calling start().
 *
 * If `peer_connection` is provided it will be used as-is instead of creating
 * a new one. This is required for QR mode, where the QrTransport must monitor
 * the same RTCPeerConnection that the manager drives.
 */
export class RTCPeerManager {
  private peer_connection: RTCPeerConnection | null = null;
  private transport: SignalTransport;
  private callbacks: PeerManagerCallbacks;
  private provided_peer_connection: RTCPeerConnection | null;
  private ice_servers: RTCIceServer[];
  private is_offerer = false;

  constructor(
    transport: SignalTransport,
    callbacks: PeerManagerCallbacks,
    peer_connection?: RTCPeerConnection,
    ice_servers?: RTCIceServer[],
  ) {
    this.transport = transport;
    this.callbacks = callbacks;
    this.provided_peer_connection = peer_connection ?? null;
    this.ice_servers = ice_servers ?? ICE_SERVERS;
  }

  /**
   * Start the connection as offerer. Creates the data channel, then the offer.
   * Uses trickle ICE: candidates are sent as they are discovered.
   */
  async startAsOfferer(): Promise<void> {
    this.is_offerer = true;
    const { pc, flush_pending } = this.createPeerConnection();

    const data_channel = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.callbacks.onDataChannel(data_channel);

    const file_channel = pc.createDataChannel(FILE_TRANSFER_CHANNEL_LABEL, { ordered: true });
    this.callbacks.onFileChannel(file_channel);

    // Handle renegotiation (e.g. when audio tracks are added/removed later).
    // Skip the initial trigger caused by createDataChannel: at that point
    // localDescription is still null (setLocalDescription hasn't been called),
    // and signalingState is "stable" — the same value it has during renegotiation.
    // Gating on localDescription !== null ensures we only renegotiate after the
    // first offer/answer exchange has fully completed.
    pc.onnegotiationneeded = async () => {
      if (pc.localDescription === null || pc.signalingState !== "stable") {
        return;
      }
      try {
        const offer = await pc.createOffer();
        // Re-check after the async gap — state may have changed.
        if (pc.signalingState !== "stable") {
          return;
        }
        await pc.setLocalDescription(offer);
        this.transport.sendOffer({ type: offer.type, sdp: offer.sdp ?? "" });
      } catch (err) {
        console.error("[RTCPeerManager] renegotiation offer failed:", err);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.transport.sendOffer({ type: offer.type, sdp: offer.sdp ?? "" });

    this.transport.onAnswer(async (answer_sdp) => {
      console.log(
        "[QR offerer] onAnswer fired, signalingState:",
        pc.signalingState,
        "sdp length:",
        answer_sdp.sdp?.length,
      );
      if (pc.signalingState !== "have-local-offer") {
        console.warn("[QR offerer] unexpected signalingState — ignoring answer");
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer_sdp));
        console.log(
          "[QR offerer] setRemoteDescription OK, iceConnectionState:",
          pc.iceConnectionState,
        );
        await flush_pending();
      } catch (err) {
        console.error("[QR offerer] setRemoteDescription failed:", err);
      }
    });
  }

  /**
   * Start the connection as answerer. Waits for an offer via the transport.
   */
  startAsAnswerer(): void {
    const { pc, flush_pending } = this.createPeerConnection();

    pc.ondatachannel = (event) => {
      if (event.channel.label === FILE_TRANSFER_CHANNEL_LABEL) {
        this.callbacks.onFileChannel(event.channel);
      } else {
        this.callbacks.onDataChannel(event.channel);
      }
    };

    this.transport.onOffer(async (offer_sdp) => {
      if (pc.signalingState !== "stable") {
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer_sdp));
      await flush_pending();
      if (this.callbacks.beforeAnswer !== undefined) {
        await this.callbacks.beforeAnswer(pc);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.transport.sendAnswer({ type: answer.type, sdp: answer.sdp ?? "" });
    });
  }

  close(): void {
    this.peer_connection?.close();
    this.peer_connection = null;
    this.transport.close();
    this.callbacks.onStateChange("closed");
  }

  getIsOfferer(): boolean {
    return this.is_offerer;
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    if (this.peer_connection === null) {
      throw new Error("No active peer connection");
    }
    return this.peer_connection.addTrack(track, stream);
  }

  removeTrack(sender: RTCRtpSender): void {
    this.peer_connection?.removeTrack(sender);
  }

  /** Remove all audio senders from the peer connection (used to end a voice call). */
  removeAudioTracks(): void {
    if (this.peer_connection === null) {
      return;
    }
    for (const sender of this.peer_connection.getSenders()) {
      if (sender.track?.kind === "audio") {
        this.peer_connection.removeTrack(sender);
      }
    }
  }

  private createPeerConnection(): {
    pc: RTCPeerConnection;
    flush_pending: () => Promise<void>;
  } {
    const pc =
      this.provided_peer_connection ?? new RTCPeerConnection({ iceServers: this.ice_servers });
    this.peer_connection = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate !== null) {
        this.transport.sendIceCandidate(event.candidate);
      }
    };

    pc.ontrack = (event) => {
      this.callbacks.onTrack?.(event);
    };

    // Buffer remote candidates that arrive before setRemoteDescription.
    // With trickle ICE this race is common: the remote peer starts sending
    // candidates immediately after its offer/answer is sent, which can
    // arrive before setRemoteDescription completes on this side.
    const pending_candidates: RTCIceCandidateInit[] = [];

    this.transport.onIceCandidate(async (candidate) => {
      if (pc.remoteDescription === null) {
        pending_candidates.push(candidate.toJSON());
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    const flush_pending = async (): Promise<void> => {
      for (const candidate of pending_candidates.splice(0)) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(
        "[QR ICE] iceConnectionState:",
        pc.iceConnectionState,
        "iceGatheringState:",
        pc.iceGatheringState,
      );
      // Some mobile browsers (iOS Safari) never fire connectionState="failed" —
      // iceConnectionState is more reliable for detecting terminal failures.
      if (pc.iceConnectionState === "failed") {
        this.callbacks.onStateChange("failed");
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[QR peer] connectionState:", pc.connectionState);
      const state_map: Record<RTCPeerConnectionState, PeerManagerState> = {
        new: "idle",
        connecting: "connecting",
        connected: "connected",
        disconnected: "disconnected",
        failed: "failed",
        closed: "closed",
      };
      const mapped_state = state_map[pc.connectionState] ?? "idle";
      this.callbacks.onStateChange(mapped_state);

      if (pc.connectionState === "failed") {
        this.callbacks.onError(new Error("WebRTC connection failed"));
      }
    };

    this.callbacks.onStateChange("connecting");
    return { pc, flush_pending };
  }
}

// ---------------------------------------------------------------------------
// Role determination
// ---------------------------------------------------------------------------

/**
 * Determine whether this peer should be the offerer.
 * The peer with the lexicographically larger UUID becomes the offerer.
 * This prevents the "glare" condition where both peers simultaneously create offers.
 */
export function isOfferer(local_peer_id: string, remote_peer_id: string): boolean {
  return local_peer_id > remote_peer_id;
}
