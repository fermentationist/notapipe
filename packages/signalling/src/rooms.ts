import type { WebSocket } from "ws";
import type { ServerMessage } from "./types.ts";

export interface RoomPeer {
  socket: WebSocket;
  peer_id: string;
}

export interface Room {
  peers: Map<string, RoomPeer>; // keyed by peer_id
}

const rooms = new Map<string, Room>();

const MAX_PEERS_PER_ROOM = 2;

const WS_OPEN = 1; // WebSocket.OPEN — using the numeric constant avoids importing the class

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Attempt to add a peer to a room.
 * Returns "joined" if successful, "full" if the room already has MAX_PEERS_PER_ROOM.
 * Sends the appropriate server messages to all affected peers.
 */
export function joinRoom(
  room_id: string,
  peer_id: string,
  socket: WebSocket,
): "joined" | "full" {
  let room = rooms.get(room_id);

  if (room === undefined) {
    room = { peers: new Map() };
    rooms.set(room_id, room);
  }

  if (room.peers.size >= MAX_PEERS_PER_ROOM) {
    send(socket, { type: "room-full", roomId: room_id });
    return "full";
  }

  const existing_peer_ids = Array.from(room.peers.keys());

  room.peers.set(peer_id, { socket, peer_id });

  // Confirm to the joining peer
  send(socket, {
    type: "joined",
    roomId: room_id,
    peerId: peer_id,
    peers: existing_peer_ids,
  });

  // Notify existing peers
  existing_peer_ids.forEach((existing_peer_id) => {
    const existing_peer = room!.peers.get(existing_peer_id);
    if (existing_peer !== undefined) {
      send(existing_peer.socket, {
        type: "peer-joined",
        roomId: room_id,
        peerId: peer_id,
      });
    }
  });

  return "joined";
}

/**
 * Remove a peer from their room and notify remaining peers.
 * Cleans up the room if it becomes empty.
 */
export function leaveRoom(room_id: string, peer_id: string): void {
  const room = rooms.get(room_id);
  if (room === undefined) {
    return;
  }

  room.peers.delete(peer_id);

  // Notify remaining peers
  room.peers.forEach((remaining_peer) => {
    send(remaining_peer.socket, {
      type: "peer-left",
      roomId: room_id,
      peerId: peer_id,
    });
  });

  // Clean up empty room
  if (room.peers.size === 0) {
    rooms.delete(room_id);
  }
}

/**
 * Forward a signal message to the target peer in the room.
 * If to_peer_id is "__broadcast__", forwards to all peers except the sender.
 * Silently drops if the target peer is not found.
 */
export function forwardSignal(
  room_id: string,
  from_peer_id: string,
  to_peer_id: string,
  payload: ServerMessage & { type: "signal" },
): void {
  const room = rooms.get(room_id);
  if (room === undefined) {
    return;
  }

  if (to_peer_id === "__broadcast__") {
    room.peers.forEach((peer) => {
      if (peer.peer_id !== from_peer_id) {
        send(peer.socket, payload);
      }
    });
    return;
  }

  const target_peer = room.peers.get(to_peer_id);
  if (target_peer === undefined) {
    return;
  }

  send(target_peer.socket, payload);
}

/**
 * Find which room a peer is currently in, if any.
 * Returns { room_id, room } or null.
 */
export function findPeerRoom(
  peer_id: string,
): { room_id: string; room: Room } | null {
  for (const [room_id, room] of rooms) {
    if (room.peers.has(peer_id)) {
      return { room_id, room };
    }
  }
  return null;
}

/**
 * Return the current room count. Intended for tests and health checks.
 */
export function getRoomCount(): number {
  return rooms.size;
}

/**
 * Clear all room state. Intended for tests only.
 */
export function resetAllRooms(): void {
  rooms.clear();
}
