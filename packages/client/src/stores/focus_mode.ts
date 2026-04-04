import { writable } from "svelte/store";

const { subscribe, update } = writable(false);

export const focus_mode_store = {
  subscribe,
  enable(): void {
    update(() => true);
    document.documentElement.classList.add("focus-mode");
  },
  disable(): void {
    update(() => false);
    document.documentElement.classList.remove("focus-mode");
  },
  toggle(): void {
    update((current) => {
      const next = !current;
      if (next) {
        document.documentElement.classList.add("focus-mode");
      } else {
        document.documentElement.classList.remove("focus-mode");
      }
      return next;
    });
  },
};
