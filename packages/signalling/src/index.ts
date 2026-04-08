import { createServer, type IncomingMessage } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "./types.ts";
import { joinRoom, leaveRoom, forwardSignal, findPeerRoom } from "./rooms.ts";
import { checkRateLimit } from "./rate_limiter.ts";

const PORT = Number(process.env["PORT"] ?? 3001);

// ---------------------------------------------------------------------------
// HTTP server (health check endpoint)
// ---------------------------------------------------------------------------

const http_server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  response.writeHead(404);
  response.end();
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: http_server });

function getClientIp(request: IncomingMessage): string {
  const forwarded_header = request.headers["x-forwarded-for"];
  if (typeof forwarded_header === "string") {
    return forwarded_header.split(",")[0]?.trim() ?? "unknown";
  }
  return request.socket.remoteAddress ?? "unknown";
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>)["type"] === "string"
    ) {
      return parsed as ClientMessage;
    }
  } catch {
    // malformed JSON — ignore
  }
  return null;
}

wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
  const client_ip = getClientIp(request);

  // Track this connection's current room and peer ID for cleanup on close
  let current_room_id: string | null = null;
  let current_peer_id: string | null = null;

  socket.on("message", (raw_data) => {
    const message = parseClientMessage(raw_data.toString());
    if (message === null) {
      return;
    }

    switch (message.type) {
      case "join": {
        if (!checkRateLimit(client_ip)) {
          socket.send(JSON.stringify({ type: "rate-limited" }));
          socket.close();
          return;
        }

        const result = joinRoom(message.roomId, message.peerId, socket);
        if (result === "joined") {
          current_room_id = message.roomId;
          current_peer_id = message.peerId;
        } else {
          // room-full — server already sent the message; close the connection
          socket.close();
        }
        break;
      }

      case "signal": {
        if (current_room_id === null || current_peer_id === null) {
          return;
        }
        forwardSignal(message.roomId, message.from, message.to, {
          type: "signal",
          roomId: message.roomId,
          from: message.from,
          payload: message.payload,
        });
        break;
      }

      case "leave": {
        if (current_room_id !== null && current_peer_id !== null) {
          leaveRoom(current_room_id, current_peer_id);
          current_room_id = null;
          current_peer_id = null;
        }
        break;
      }

      case "ping": {
        socket.send(JSON.stringify({ type: "pong" }));
        break;
      }
    }
  });

  socket.on("close", () => {
    if (current_room_id !== null && current_peer_id !== null) {
      leaveRoom(current_room_id, current_peer_id);
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

http_server.listen(PORT, () => {
  console.log(`notapipe signalling server listening on port ${PORT}`);
});
