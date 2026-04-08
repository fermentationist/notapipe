import type { SignalTransport } from "./peer.ts";
import { SIGNAL_PING_INTERVAL_MS } from "$lib/constants/rtc.ts";

type OfferCallback = (sdp: RTCSessionDescriptionInit) => void;
type AnswerCallback = (sdp: RTCSessionDescriptionInit) => void;
type IceCandidateCallback = (candidate: RTCIceCandidate) => void;

export type WebSocketTransportState =
  | "connecting"
  | "joined"
  | "peer-present"
  | "disconnected"
  | "rate-limited"
  | "room-full";

export interface WebSocketTransportCallbacks {
  onStateChange: (state: WebSocketTransportState) => void;
  onPeerJoined: (peer_id: string) => void;
  onPeerLeft: (peer_id: string) => void;
  onError: (error: Error) => void;
}

interface ServerMessage {
  type: string;
  roomId?: string;
  peerId?: string;
  peers?: string[];
  from?: string;
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// PerPeerChannel — implements SignalTransport for one specific remote peer.
// Created by WebSocketTransport.createPeerChannel(); not exported directly.
// ---------------------------------------------------------------------------

class PerPeerChannel implements SignalTransport {
  private offer_callback: OfferCallback | null = null;
  private answer_callback: AnswerCallback | null = null;
  private ice_candidate_callback: IceCandidateCallback | null = null;

  constructor(
    private readonly ws: WebSocketTransport,
    private readonly remote_peer_id: string,
  ) {}

  sendOffer(sdp: RTCSessionDescriptionInit): void {
    this.ws.sendSignalToPeer(this.remote_peer_id, { sdpType: sdp.type, sdp: sdp.sdp });
  }

  sendAnswer(sdp: RTCSessionDescriptionInit): void {
    this.ws.sendSignalToPeer(this.remote_peer_id, { sdpType: sdp.type, sdp: sdp.sdp });
  }

  sendIceCandidate(candidate: RTCIceCandidate): void {
    this.ws.sendSignalToPeer(this.remote_peer_id, {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    });
  }

  onOffer(callback: OfferCallback): void { this.offer_callback = callback; }
  onAnswer(callback: AnswerCallback): void { this.answer_callback = callback; }
  onIceCandidate(callback: IceCandidateCallback): void { this.ice_candidate_callback = callback; }

  close(): void {
    this.ws.removePeerChannel(this.remote_peer_id);
  }

  /** Called by WebSocketTransport when a signal arrives from this peer. */
  handleIncoming(payload: unknown): void {
    if (payload === null || typeof payload !== "object") {
      return;
    }
    const signal = payload as Record<string, unknown>;

    if ("sdpType" in signal) {
      const sdp_type = signal["sdpType"];
      const sdp = signal["sdp"];
      if ((sdp_type === "offer" || sdp_type === "answer") && typeof sdp === "string") {
        const sdp_init: RTCSessionDescriptionInit = { type: sdp_type, sdp };
        if (sdp_type === "offer") {
          this.offer_callback?.(sdp_init);
        } else {
          this.answer_callback?.(sdp_init);
        }
      }
    } else if ("candidate" in signal) {
      const candidate = signal["candidate"];
      const sdp_mid = signal["sdpMid"];
      const sdp_mline_index = signal["sdpMLineIndex"];
      if (typeof candidate === "string") {
        const ice_candidate = new RTCIceCandidate({
          candidate,
          sdpMid: typeof sdp_mid === "string" ? sdp_mid : null,
          sdpMLineIndex: typeof sdp_mline_index === "number" ? sdp_mline_index : null,
        });
        this.ice_candidate_callback?.(ice_candidate);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocketTransport
// ---------------------------------------------------------------------------

/**
 * Manages a single WebSocket connection to the signalling server.
 * Call createPeerChannel(remote_peer_id) to get a SignalTransport for each
 * remote peer — signals are routed to and from that specific peer only.
 *
 * Lifecycle:
 *   1. Construct with server URL, room ID, peer ID, and callbacks.
 *   2. Call connect() to open the WebSocket and join the room.
 *   3. For each onPeerJoined callback: call createPeerChannel(peer_id) and
 *      pass the returned SignalTransport to an RTCPeerManager.
 *   4. Call close() to leave the room and close the WebSocket.
 */
export class WebSocketTransport {
  private socket: WebSocket | null = null;
  private readonly server_url: string;
  private readonly room_id: string;
  private readonly peer_id: string;
  private readonly callbacks: WebSocketTransportCallbacks;
  private readonly peer_channels = new Map<string, PerPeerChannel>();
  private ping_interval_id: ReturnType<typeof setInterval> | null = null;

  constructor(
    server_url: string,
    room_id: string,
    peer_id: string,
    callbacks: WebSocketTransportCallbacks,
  ) {
    this.server_url = server_url;
    this.room_id = room_id;
    this.peer_id = peer_id;
    this.callbacks = callbacks;
  }

  connect(): void {
    const socket = new WebSocket(this.server_url);
    this.socket = socket;
    this.callbacks.onStateChange("connecting");

    socket.addEventListener("open", () => {
      this.send({ type: "join", roomId: this.room_id, peerId: this.peer_id });
      this.startPingInterval();
    });

    socket.addEventListener("message", (event: MessageEvent<string>) => {
      this.handleServerMessage(event.data);
    });

    socket.addEventListener("close", () => {
      this.stopPingInterval();
      this.callbacks.onStateChange("disconnected");
    });

    socket.addEventListener("error", () => {
      this.callbacks.onError(new Error("WebSocket error"));
    });
  }

  /**
   * Create a dedicated signal channel for one remote peer.
   * Signals sent through this channel are addressed to remote_peer_id.
   * Signals received from remote_peer_id are routed to this channel's callbacks.
   */
  createPeerChannel(remote_peer_id: string): SignalTransport {
    const channel = new PerPeerChannel(this, remote_peer_id);
    this.peer_channels.set(remote_peer_id, channel);
    return channel;
  }

  close(): void {
    this.stopPingInterval();
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: "leave", roomId: this.room_id, peerId: this.peer_id });
      this.socket.close();
    }
    this.socket = null;
    this.peer_channels.clear();
  }

  // ---------------------------------------------------------------------------
  // Package-internal — called by PerPeerChannel
  // ---------------------------------------------------------------------------

  sendSignalToPeer(remote_peer_id: string, payload: Record<string, unknown>): void {
    this.send({
      type: "signal",
      roomId: this.room_id,
      from: this.peer_id,
      to: remote_peer_id,
      payload,
    });
  }

  removePeerChannel(remote_peer_id: string): void {
    this.peer_channels.delete(remote_peer_id);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private send(message: Record<string, unknown>): void {
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private handleServerMessage(raw: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "joined": {
        this.callbacks.onStateChange("joined");
        // Fire onPeerJoined for every peer already in the room (not just the first)
        const existing_peers = message.peers ?? [];
        existing_peers.forEach((peer_id) => {
          this.callbacks.onPeerJoined(peer_id);
        });
        if (existing_peers.length > 0) {
          this.callbacks.onStateChange("peer-present");
        }
        break;
      }

      case "peer-joined": {
        if (message.peerId !== undefined) {
          this.callbacks.onPeerJoined(message.peerId);
          this.callbacks.onStateChange("peer-present");
        }
        break;
      }

      case "peer-left": {
        if (message.peerId !== undefined) {
          this.callbacks.onPeerLeft(message.peerId);
        }
        break;
      }

      case "signal": {
        // Route each signal to the channel registered for its sender
        if (message.from !== undefined) {
          const channel = this.peer_channels.get(message.from);
          channel?.handleIncoming(message.payload);
        }
        break;
      }

      case "room-full": {
        this.callbacks.onStateChange("room-full");
        break;
      }

      case "rate-limited": {
        this.callbacks.onStateChange("rate-limited");
        this.callbacks.onError(new Error("Rate limited by signalling server"));
        break;
      }

      case "pong": {
        // Keepalive acknowledged — nothing to do
        break;
      }
    }
  }

  private startPingInterval(): void {
    this.ping_interval_id = setInterval(() => {
      this.send({ type: "ping" });
    }, SIGNAL_PING_INTERVAL_MS);
  }

  private stopPingInterval(): void {
    if (this.ping_interval_id !== null) {
      clearInterval(this.ping_interval_id);
      this.ping_interval_id = null;
    }
  }
}
