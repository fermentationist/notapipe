import { writable } from "svelte/store";

const WIDE_MODE_KEY = "notapipe:wide-mode";

function createWideModeStore() {
  const initial = localStorage.getItem(WIDE_MODE_KEY) === "true";
  const { subscribe, update, set } = writable<boolean>(initial);

  return {
    subscribe,
    toggle() {
      update((v) => {
        const next = !v;
        localStorage.setItem(WIDE_MODE_KEY, String(next));
        return next;
      });
    },
    /** Reset to false without writing to localStorage. */
    reset() {
      set(false);
    },
  };
}

export const wide_mode_store = createWideModeStore();
