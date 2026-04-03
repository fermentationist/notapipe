import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  joinRoom,
  leaveRoom,
  forwardSignal,
  findPeerRoom,
  getRoomCount,
  resetAllRooms,
} from "./rooms.ts";
import type { ServerMessage } from "./types.ts";

// ---------------------------------------------------------------------------
// Minimal WebSocket mock
// ---------------------------------------------------------------------------

function makeSocket(): { socket: WebSocket; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  const socket = {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn((data: string) => {
      sent.push(JSON.parse(data) as ServerMessage);
    }),
  } as unknown as WebSocket;
  return { socket, sent };
}

beforeEach(() => {
  resetAllRooms();
});

// ---------------------------------------------------------------------------
// joinRoom
// ---------------------------------------------------------------------------

describe("joinRoom", () => {
  it("creates a room and returns 'joined'", () => {
    const { socket } = makeSocket();
    const result = joinRoom("room-1", "peer-a", socket);
    expect(result).toBe("joined");
    expect(getRoomCount()).toBe(1);
  });

  it("sends a 'joined' message with empty peers to the first peer", () => {
    const { socket, sent } = makeSocket();
    joinRoom("room-1", "peer-a", socket);
    expect(sent[0]).toEqual({
      type: "joined",
      roomId: "room-1",
      peerId: "peer-a",
      peers: [],
    });
  });

  it("sends 'joined' with existing peer IDs to the second peer", () => {
    const { socket: socket_a } = makeSocket();
    const { socket: socket_b, sent: sent_b } = makeSocket();

    joinRoom("room-1", "peer-a", socket_a);
    joinRoom("room-1", "peer-b", socket_b);

    expect(sent_b[0]).toMatchObject({
      type: "joined",
      roomId: "room-1",
      peerId: "peer-b",
      peers: ["peer-a"],
    });
  });

  it("notifies existing peers with 'peer-joined' when a second peer joins", () => {
    const { socket: socket_a, sent: sent_a } = makeSocket();
    const { socket: socket_b } = makeSocket();

    joinRoom("room-1", "peer-a", socket_a);
    joinRoom("room-1", "peer-b", socket_b);

    expect(sent_a[1]).toEqual({
      type: "peer-joined",
      roomId: "room-1",
      peerId: "peer-b",
    });
  });

  it("returns 'full' and sends 'room-full' when a third peer tries to join", () => {
    const { socket: socket_a } = makeSocket();
    const { socket: socket_b } = makeSocket();
    const { socket: socket_c, sent: sent_c } = makeSocket();

    joinRoom("room-1", "peer-a", socket_a);
    joinRoom("room-1", "peer-b", socket_b);
    const result = joinRoom("room-1", "peer-c", socket_c);

    expect(result).toBe("full");
    expect(sent_c[0]).toEqual({ type: "room-full", roomId: "room-1" });
    expect(getRoomCount()).toBe(1); // room not modified
  });

  it("allows two peers in separate rooms independently", () => {
    const { socket: socket_a } = makeSocket();
    const { socket: socket_b } = makeSocket();

    joinRoom("room-1", "peer-a", socket_a);
    joinRoom("room-2", "peer-b", socket_b);

    expect(getRoomCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// leaveRoom
// ---------------------------------------------------------------------------

describe("leaveRoom", () => {
  it("notifies the remaining peer with 'peer-left'", () => {
    const { socket: socket_a, sent: sent_a } = makeSocket();
    const { socket: socket_b } = makeSocket();

    joinRoom("room-1", "peer-a", socket_a);
    joinRoom("room-1", "peer-b", socket_b);
    leaveRoom("room-1", "peer-b");

    expect(sent_a).toContainEqual({
      type: "peer-left",
      roomId: "room-1",
      peerId: "peer-b",
    });
  });

  it("cleans up an empty room after the last peer leaves", () => {
    const { socket } = makeSocket();
    joinRoom("room-1", "peer-a", socket);
    leaveRoom("room-1", "peer-a");
    expect(getRoomCount()).toBe(0);
  });

  it("is a no-op for a non-existent room", () => {
    expect(() => leaveRoom("no-such-room", "peer-x")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// forwardSignal
// ---------------------------------------------------------------------------

describe("forwardSignal", () => {
  it("forwards a signal payload to the target peer", () => {
    const { socket: socket_a } = makeSocket();
    const { socket: socket_b, sent: sent_b } = makeSocket();

    joinRoom("room-1", "peer-a", socket_a);
    joinRoom("room-1", "peer-b", socket_b);

    const signal_message = {
      type: "signal" as const,
      roomId: "room-1",
      from: "peer-a",
      payload: { sdpType: "offer" as const, sdp: "v=0\r\n..." },
    };

    forwardSignal("room-1", "peer-a", "peer-b", signal_message);

    expect(sent_b).toContainEqual(signal_message);
  });

  it("does not forward to the sender", () => {
    const { socket: socket_a, sent: sent_a } = makeSocket();
    const { socket: socket_b } = makeSocket();

    joinRoom("room-1", "peer-a", socket_a);
    joinRoom("room-1", "peer-b", socket_b);

    const signal_message = {
      type: "signal" as const,
      roomId: "room-1",
      from: "peer-a",
      payload: { sdpType: "offer" as const, sdp: "v=0\r\n..." },
    };

    forwardSignal("room-1", "peer-a", "peer-b", signal_message);

    // sent_a[0] is 'joined', sent_a[1] is 'peer-joined' — no signal
    const signal_in_sent_a = sent_a.find((msg) => msg.type === "signal");
    expect(signal_in_sent_a).toBeUndefined();
  });

  it("is a no-op if the target peer does not exist", () => {
    const { socket } = makeSocket();
    joinRoom("room-1", "peer-a", socket);

    expect(() =>
      forwardSignal("room-1", "peer-a", "peer-ghost", {
        type: "signal",
        roomId: "room-1",
        from: "peer-a",
        payload: { sdpType: "offer", sdp: "v=0\r\n..." },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// findPeerRoom
// ---------------------------------------------------------------------------

describe("findPeerRoom", () => {
  it("returns the room for a connected peer", () => {
    const { socket } = makeSocket();
    joinRoom("room-1", "peer-a", socket);
    const result = findPeerRoom("peer-a");
    expect(result).not.toBeNull();
    expect(result?.room_id).toBe("room-1");
  });

  it("returns null for an unknown peer", () => {
    expect(findPeerRoom("ghost")).toBeNull();
  });
});
