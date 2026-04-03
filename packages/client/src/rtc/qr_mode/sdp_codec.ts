// SDP binary codec for QR mode
// Encodes SDP into ~78 bytes: 3-byte header, 32-byte DTLS fingerprint,
// ufrag+pwd lengths+values, ICE candidates (7 bytes each for IPv4)
// mDNS candidates: UUID encoded as 16 raw bytes

export {};
