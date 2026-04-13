import { writable } from "svelte/store";
import { CHAT_PERSISTENCE_ENABLED_KEY } from "$lib/constants/storage.ts";

function createChatPersistenceStore() {
  const initial = localStorage.getItem(CHAT_PERSISTENCE_ENABLED_KEY) === "true";
  const { subscribe, set } = writable<boolean>(initial);

  return {
    subscribe,
    enable(): void {
      localStorage.setItem(CHAT_PERSISTENCE_ENABLED_KEY, "true");
      set(true);
    },
    disable(): void {
      localStorage.removeItem(CHAT_PERSISTENCE_ENABLED_KEY);
      set(false);
    },
  };
}

export const chat_persistence_store = createChatPersistenceStore();
