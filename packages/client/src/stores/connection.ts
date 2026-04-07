import { writable } from "svelte/store";
import type { PeerManagerState } from "../rtc/peer.ts";

export type ConnectionMode = "none" | "signalling" | "qr";

export interface ConnectionState {
  mode: ConnectionMode;
  peer_state: PeerManagerState;
  remote_peer_ids: string[];
  room_id: string | null;
  error: string | null;
}

const initial_state: ConnectionState = {
  mode: "none",
  peer_state: "idle",
  remote_peer_ids: [],
  room_id: null,
  error: null,
};

function createConnectionStore() {
  const { subscribe, update, set } = writable<ConnectionState>(initial_state);

  return {
    subscribe,
    setMode(mode: ConnectionMode): void {
      update((state) => ({ ...state, mode, error: null }));
    },
    setPeerState(peer_state: PeerManagerState): void {
      update((state) => ({ ...state, peer_state }));
    },
    addRemotePeer(peer_id: string): void {
      update((state) => ({
        ...state,
        remote_peer_ids: state.remote_peer_ids.includes(peer_id)
          ? state.remote_peer_ids
          : [...state.remote_peer_ids, peer_id],
      }));
    },
    removeRemotePeer(peer_id: string): void {
      update((state) => ({
        ...state,
        remote_peer_ids: state.remote_peer_ids.filter((id) => id !== peer_id),
      }));
    },
    setRoomId(room_id: string): void {
      update((state) => ({ ...state, room_id }));
    },
    setError(error: string): void {
      update((state) => ({ ...state, error, peer_state: "failed" }));
    },
    reset(): void {
      set(initial_state);
    },
  };
}

export const connection_store = createConnectionStore();
