import { writable } from "svelte/store";
import { PERSISTENCE_ENABLED_KEY } from "$lib/constants/storage.ts";

function createPersistenceStore() {
  const initial = localStorage.getItem(PERSISTENCE_ENABLED_KEY) === "true";
  const { subscribe, set } = writable<boolean>(initial);

  return {
    subscribe,
    enable(): void {
      localStorage.setItem(PERSISTENCE_ENABLED_KEY, "true");
      set(true);
    },
    disable(): void {
      localStorage.removeItem(PERSISTENCE_ENABLED_KEY);
      set(false);
    },
  };
}

export const persistence_store = createPersistenceStore();
