import { ICE_SERVERS, DATA_CHANNEL_LABEL } from "$lib/constants/rtc.ts";

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
  onStateChange: (state: PeerManagerState) => void;
  onError: (error: Error) => void;
}

/**
 * Manages a single RTCPeerConnection using the provided SignalTransport.
 * The caller is responsible for determining the role (offerer vs answerer)
 * before calling start().
 */
export class RTCPeerManager {
  private peer_connection: RTCPeerConnection | null = null;
  private transport: SignalTransport;
  private callbacks: PeerManagerCallbacks;

  constructor(transport: SignalTransport, callbacks: PeerManagerCallbacks) {
    this.transport = transport;
    this.callbacks = callbacks;
  }

  /**
   * Start the connection as offerer. Creates the data channel, then the offer.
   * Use trickle ICE (default): ICE candidates are sent as discovered.
   */
  async startAsOfferer(): Promise<void> {
    const pc = this.createPeerConnection();

    const data_channel = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.callbacks.onDataChannel(data_channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.transport.sendOffer({ type: offer.type, sdp: offer.sdp ?? "" });

    this.transport.onAnswer(async (answer_sdp) => {
      if (pc.signalingState !== "have-local-offer") {
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(answer_sdp));
    });
  }

  /**
   * Start the connection as answerer. Waits for an offer via the transport.
   */
  startAsAnswerer(): void {
    const pc = this.createPeerConnection();

    pc.ondatachannel = (event) => {
      this.callbacks.onDataChannel(event.channel);
    };

    this.transport.onOffer(async (offer_sdp) => {
      if (pc.signalingState !== "stable") {
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer_sdp));
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

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peer_connection = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate !== null) {
        this.transport.sendIceCandidate(event.candidate);
      }
    };

    this.transport.onIceCandidate(async (candidate) => {
      if (pc.remoteDescription === null) {
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    pc.onconnectionstatechange = () => {
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
    return pc;
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
