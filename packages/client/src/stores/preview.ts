import { writable } from "svelte/store";

const { subscribe, update } = writable<boolean>(false);

export const preview_store = {
  subscribe,
  toggle() {
    update((v) => !v);
  },
  set(value: boolean) {
    update(() => value);
  },
};
