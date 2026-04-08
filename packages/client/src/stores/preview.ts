import { writable } from "svelte/store";

const PREVIEW_KEY = "notapipe_preview";

function createPreviewStore() {
  const initial = localStorage.getItem(PREVIEW_KEY) === "true";
  const { subscribe, update, set } = writable<boolean>(initial);

  return {
    subscribe,
    toggle() {
      update((v) => {
        const next = !v;
        localStorage.setItem(PREVIEW_KEY, String(next));
        return next;
      });
    },
    set(value: boolean) {
      localStorage.setItem(PREVIEW_KEY, String(value));
      set(value);
    },
  };
}

export const preview_store = createPreviewStore();
