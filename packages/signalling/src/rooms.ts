// Room management: Map<string, { peers: Map<string, WebSocket> }>
// Max 2 peers per room — third peer receives "room-full" and is closed
// On disconnect: broadcast "peer-left", clean empty rooms

export {};
