import { writable } from "svelte/store";
import { AUTO_CONNECT_KEY } from "$lib/constants/storage.ts";

function createAutoConnectStore() {
  const initial = localStorage.getItem(AUTO_CONNECT_KEY) === "true";
  const { subscribe, set } = writable<boolean>(initial);

  return {
    subscribe,
    enable(): void {
      localStorage.setItem(AUTO_CONNECT_KEY, "true");
      set(true);
    },
    disable(): void {
      localStorage.removeItem(AUTO_CONNECT_KEY);
      set(false);
    },
  };
}

export const auto_connect_store = createAutoConnectStore();
