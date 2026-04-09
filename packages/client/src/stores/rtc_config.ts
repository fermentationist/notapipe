import { writable } from "svelte/store";
import { RTC_CONFIG_KEY } from "$lib/constants/storage.ts";

export interface RTCUserConfig {
  // Override the build-time VITE_SIGNAL_URL. Empty string = use app default.
  signal_url: string;
  // TURN server — all three must be set together to take effect.
  // Empty string = use app default (openrelay.metered.ca).
  turn_url: string;
  turn_username: string;
  turn_credential: string;
}

const DEFAULTS: RTCUserConfig = {
  signal_url: "",
  turn_url: "",
  turn_username: "",
  turn_credential: "",
};

function load(): RTCUserConfig {
  try {
    const raw = localStorage.getItem(RTC_CONFIG_KEY);
    if (raw === null) {
      return { ...DEFAULTS };
    }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RTCUserConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(config: RTCUserConfig): void {
  localStorage.setItem(RTC_CONFIG_KEY, JSON.stringify(config));
}

function createRTCConfigStore() {
  const { subscribe, set, update } = writable<RTCUserConfig>(load());

  return {
    subscribe,
    setField<K extends keyof RTCUserConfig>(key: K, value: RTCUserConfig[K]): void {
      update((config) => {
        const next = { ...config, [key]: value };
        save(next);
        return next;
      });
    },
    reset(): void {
      localStorage.removeItem(RTC_CONFIG_KEY);
      set({ ...DEFAULTS });
    },
  };
}

export const rtc_config_store = createRTCConfigStore();
