export const ICE_GATHERING_TIMEOUT_MS = 15_000;
// QR mode uses a shorter timeout — STUN typically completes in <2 s, and
// waiting longer just delays QR code generation without adding useful candidates.
export const QR_ICE_GATHERING_TIMEOUT_MS = 5_000;
export const MAX_ROOM_PEERS = 7;
export const SIGNAL_PING_INTERVAL_MS = 30_000;

// STUN-only by default. Users who need TURN (e.g. symmetric NAT) must supply
// their own credentials in Settings → Connection.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// File size cap applied when the connection is being relayed through a TURN
// server. Relay bandwidth is limited and user-owned — keep transfers small.
export const RELAY_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB

// Voice call hard cap. Prevents forgotten calls from running up relay bandwidth.
export const VOICE_CALL_MAX_MS = 4 * 60 * 60 * 1000; // 4 hours
export const VOICE_CALL_WARNING_MS = (4 * 60 - 15) * 60 * 1000; // 3 h 45 min

export const DATA_CHANNEL_LABEL = "yjs";
