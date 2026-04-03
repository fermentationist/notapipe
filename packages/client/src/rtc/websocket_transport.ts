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

/**
 * WebSocketTransport — implements SignalTransport via the notapipe signalling server.
 *
 * Lifecycle:
 *   1. Construct with server URL, room ID, and peer ID.
 *   2. Call connect() to open the WebSocket.
 *   3. The server will confirm with a "joined" message (state → "joined").
 *   4. When the remote peer joins, "peer-joined" fires (state → "peer-present").
 *   5. Call close() to cleanly disconnect.
 */
export class WebSocketTransport implements SignalTransport {
  private socket: WebSocket | null = null;
  private readonly server_url: string;
  private readonly room_id: string;
  private readonly peer_id: string;
  private readonly callbacks: WebSocketTransportCallbacks;

  private offer_callback: OfferCallback | null = null;
  private answer_callback: AnswerCallback | null = null;
  private ice_candidate_callback: IceCandidateCallback | null = null;

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

  // ---------------------------------------------------------------------------
  // SignalTransport implementation
  // ---------------------------------------------------------------------------

  sendOffer(sdp: RTCSessionDescriptionInit): void {
    // The transport doesn't know the remote peer ID at send time — the server
    // routes by room. We broadcast to all peers in the room (just one in v1).
    this.send({
      type: "signal",
      roomId: this.room_id,
      from: this.peer_id,
      to: "__broadcast__",
      payload: { sdpType: sdp.type, sdp: sdp.sdp },
    });
  }

  sendAnswer(sdp: RTCSessionDescriptionInit): void {
    this.send({
      type: "signal",
      roomId: this.room_id,
      from: this.peer_id,
      to: "__broadcast__",
      payload: { sdpType: sdp.type, sdp: sdp.sdp },
    });
  }

  sendIceCandidate(candidate: RTCIceCandidate): void {
    this.send({
      type: "signal",
      roomId: this.room_id,
      from: this.peer_id,
      to: "__broadcast__",
      payload: {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      },
    });
  }

  onOffer(callback: OfferCallback): void {
    this.offer_callback = callback;
  }

  onAnswer(callback: AnswerCallback): void {
    this.answer_callback = callback;
  }

  onIceCandidate(callback: IceCandidateCallback): void {
    this.ice_candidate_callback = callback;
  }

  close(): void {
    this.stopPingInterval();
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: "leave", roomId: this.room_id, peerId: this.peer_id });
      this.socket.close();
    }
    this.socket = null;
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
        // If peers is non-empty, the other peer is already in the room
        const existing_peers = message.peers ?? [];
        if (existing_peers.length > 0) {
          this.callbacks.onPeerJoined(existing_peers[0]!);
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
        this.routeSignalPayload(message.payload);
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

  private routeSignalPayload(payload: unknown): void {
    if (payload === null || typeof payload !== "object") {
      return;
    }

    const signal_payload = payload as Record<string, unknown>;

    if ("sdpType" in signal_payload) {
      const sdp_type = signal_payload["sdpType"];
      const sdp = signal_payload["sdp"];
      if ((sdp_type === "offer" || sdp_type === "answer") && typeof sdp === "string") {
        const sdp_init: RTCSessionDescriptionInit = { type: sdp_type, sdp };
        if (sdp_type === "offer") {
          this.offer_callback?.(sdp_init);
        } else {
          this.answer_callback?.(sdp_init);
        }
      }
    } else if ("candidate" in signal_payload) {
      const candidate = signal_payload["candidate"];
      const sdp_mid = signal_payload["sdpMid"];
      const sdp_mline_index = signal_payload["sdpMLineIndex"];
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
