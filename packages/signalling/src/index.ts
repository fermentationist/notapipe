import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile, access } from "fs/promises";
import { join, extname, resolve } from "path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "./types.ts";
import { joinRoom, leaveRoom, forwardSignal, findPeerRoom } from "./rooms.ts";
import { checkRateLimit } from "./rate_limiter.ts";

const PORT = Number(process.env["PORT"] ?? 3001);

// Static client files are built into packages/client/dist relative to the repo root.
const CLIENT_DIST = resolve(process.cwd(), "packages/client/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const url_path = url.pathname;

  // Resolve the file path and guard against path traversal
  const candidate = resolve(join(CLIENT_DIST, url_path));
  if (!candidate.startsWith(CLIENT_DIST)) {
    response.writeHead(403);
    response.end();
    return true;
  }

  // Try the exact path, then the exact path + /index.html, then SPA fallback
  const candidates = [candidate, join(candidate, "index.html"), join(CLIENT_DIST, "index.html")];

  for (const file_path of candidates) {
    try {
      await access(file_path);
      const content = await readFile(file_path);
      const ext = extname(file_path);
      const content_type = MIME_TYPES[ext] ?? "application/octet-stream";
      // Cache hashed assets aggressively; everything else no-cache
      const cache_control = file_path.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      response.writeHead(200, { "Content-Type": content_type, "Cache-Control": cache_control });
      response.end(content);
      return true;
    } catch {
      // File not found — try next candidate
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const http_server = createServer(async (request, response) => {
  // Health check endpoint (used by Render and other platforms)
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Serve built client static files for all non-WebSocket GET requests
  if (request.method === "GET") {
    const served = await serveStatic(request, response);
    if (served) {
      return;
    }
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
