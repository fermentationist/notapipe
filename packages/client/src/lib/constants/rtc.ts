export const ICE_GATHERING_TIMEOUT_MS = 15_000;
export const MAX_ROOM_PEERS = 2;
export const SIGNAL_PING_INTERVAL_MS = 30_000;

// Default TURN server — freestun.net free community service.
// Relay candidates have lowest ICE priority so STUN and direct connections
// are always preferred. Users can override these in Settings → Connection.
export const DEFAULT_TURN_URL = "turns:freestun.net:5350";
export const DEFAULT_TURN_USERNAME = "free";
export const DEFAULT_TURN_CREDENTIAL = "free";

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: [
      "turn:freestun.net:3479",
      "turns:freestun.net:5350",
    ],
    username: DEFAULT_TURN_USERNAME,
    credential: DEFAULT_TURN_CREDENTIAL,
  },
];

// QR mode is designed for two devices in the same room (same LAN).
// TURN is useless here (requires internet relay) and adds 2-5 s of gathering
// time. STUN is also skipped — host candidates are sufficient for same-network
// connections and gathering completes in <200 ms without any server round-trips.
export const QR_ICE_SERVERS: RTCIceServer[] = [];

export const DATA_CHANNEL_LABEL = "yjs";
