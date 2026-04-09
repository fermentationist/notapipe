import { writable } from "svelte/store";

const WIDE_MODE_KEY = "notapipe_wide_mode";

function createWideModeStore() {
  const initial = localStorage.getItem(WIDE_MODE_KEY) === "true";
  const { subscribe, update } = writable<boolean>(initial);

  return {
    subscribe,
    toggle() {
      update((v) => {
        const next = !v;
        localStorage.setItem(WIDE_MODE_KEY, String(next));
        return next;
      });
    },
  };
}

export const wide_mode_store = createWideModeStore();
