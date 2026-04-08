// Message protocol for client ↔ signalling server communication

export interface SdpPayload {
  sdpType: "offer" | "answer";
  sdp: string;
}

export interface IcePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface JoinMessage {
  type: "join";
  roomId: string;
  peerId: string;
}

export interface SignalMessage {
  type: "signal";
  roomId: string;
  to: string;
  from: string;
  payload: SdpPayload | IcePayload;
}

export interface LeaveMessage {
  type: "leave";
  roomId: string;
  peerId: string;
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = JoinMessage | SignalMessage | LeaveMessage | PingMessage;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export interface JoinedMessage {
  type: "joined";
  roomId: string;
  peerId: string;
  peers: string[];
}

export interface PeerJoinedMessage {
  type: "peer-joined";
  roomId: string;
  peerId: string;
}

export interface PeerLeftMessage {
  type: "peer-left";
  roomId: string;
  peerId: string;
}

export interface ServerSignalMessage {
  type: "signal";
  roomId: string;
  from: string;
  payload: SdpPayload | IcePayload;
}

export interface RoomFullMessage {
  type: "room-full";
  roomId: string;
}

export interface RateLimitedMessage {
  type: "rate-limited";
}

export interface PongMessage {
  type: "pong";
}

export type ServerMessage =
  | JoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | ServerSignalMessage
  | RoomFullMessage
  | RateLimitedMessage
  | PongMessage;
