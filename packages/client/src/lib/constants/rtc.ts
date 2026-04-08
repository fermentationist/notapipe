export const ICE_GATHERING_TIMEOUT_MS = 15_000;
export const MAX_ROOM_PEERS = 2;
export const SIGNAL_PING_INTERVAL_MS = 30_000;

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // Open Relay free TURN — relay candidates have lowest ICE priority so
  // STUN and direct connections are always preferred when they work.
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export const DATA_CHANNEL_LABEL = "yjs";
