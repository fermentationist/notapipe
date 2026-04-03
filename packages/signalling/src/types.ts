// Message protocol for client ↔ signalling server communication
//
// client → server: join, signal, leave, ping
// server → client: joined, peer-joined, peer-left, signal, room-full, pong

export type ClientMessageType = "join" | "signal" | "leave" | "ping";
export type ServerMessageType =
  | "joined"
  | "peer-joined"
  | "peer-left"
  | "signal"
  | "room-full"
  | "pong";

export interface JoinMessage {
  type: "join";
  room: string;
  peerId: string;
}

export interface SignalMessage {
  type: "signal";
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

export interface LeaveMessage {
  type: "leave";
}

export interface PingMessage {
  type: "ping";
}

export type ClientMessage = JoinMessage | SignalMessage | LeaveMessage | PingMessage;
