import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createReadStream } from "fs";
import { readFile, access, stat } from "fs/promises";
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
  ".mp4": "video/mp4",
  ".webm": "video/webm",
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

  // Find the first candidate that exists: exact path, then /index.html suffix, then SPA fallback
  const candidates = [candidate, join(candidate, "index.html"), join(CLIENT_DIST, "index.html")];
  let resolved_path: string | null = null;
  for (const file_path of candidates) {
    try {
      await access(file_path);
      resolved_path = file_path;
      break;
    } catch {
      // try next candidate
    }
  }
  if (resolved_path === null) {
    return false;
  }

  const ext = extname(resolved_path);
  const content_type = MIME_TYPES[ext] ?? "application/octet-stream";
  // Cache hashed assets aggressively; everything else no-cache
  const cache_control = resolved_path.includes("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  // Safari requires Range request support for video — it won't play without it.
  // Advertise Accept-Ranges on every response so the browser knows to ask.
  const range_header = request.headers["range"];
  if (range_header !== undefined) {
    const { size: file_size } = await stat(resolved_path);
    const match = /bytes=(\d*)-(\d*)/.exec(range_header);
    if (match !== null) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(parseInt(match[2], 10), file_size - 1) : file_size - 1;
      const chunk_size = end - start + 1;
      response.writeHead(206, {
        "Content-Type": content_type,
        "Content-Range": `bytes ${start}-${end}/${file_size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk_size),
        "Cache-Control": cache_control,
      });
      createReadStream(resolved_path, { start, end }).pipe(response);
      return true;
    }
  }

  const content = await readFile(resolved_path);
  response.writeHead(200, {
    "Content-Type": content_type,
    "Cache-Control": cache_control,
    "Accept-Ranges": "bytes",
  });
  response.end(content);
  return true;
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

export default http_server;
