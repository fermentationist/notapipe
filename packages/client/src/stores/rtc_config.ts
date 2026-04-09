import { writable } from "svelte/store";
import { RTC_CONFIG_KEY } from "$lib/constants/storage.ts";
import {
  DEFAULT_TURN_URL,
  DEFAULT_TURN_USERNAME,
  DEFAULT_TURN_CREDENTIAL,
} from "$lib/constants/rtc.ts";

export interface RTCUserConfig {
  // Override the build-time VITE_SIGNAL_URL. Empty string = use app default.
  signal_url: string;
  // TURN server — all three must be set together to take effect.
  turn_url: string;
  turn_username: string;
  turn_credential: string;
}

export const RTC_CONFIG_DEFAULTS: RTCUserConfig = {
  // Pre-populate with the build-time env var if set (e.g. GitHub Pages → Render signalling).
  // Use || so that an empty-string env var (unset GitHub secret) is treated as missing.
  // Empty string means "same host as the app" (Render self-hosted deployment).
  signal_url: (import.meta.env["VITE_SIGNAL_URL"] as string | undefined) || "",
  turn_url: DEFAULT_TURN_URL,
  turn_username: DEFAULT_TURN_USERNAME,
  turn_credential: DEFAULT_TURN_CREDENTIAL,
};

function load(): RTCUserConfig {
  try {
    const raw = localStorage.getItem(RTC_CONFIG_KEY);
    if (raw === null) {
      return { ...RTC_CONFIG_DEFAULTS };
    }
    return { ...RTC_CONFIG_DEFAULTS, ...(JSON.parse(raw) as Partial<RTCUserConfig>) };
  } catch {
    return { ...RTC_CONFIG_DEFAULTS };
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
      set({ ...RTC_CONFIG_DEFAULTS });
    },
  };
}

export const rtc_config_store = createRTCConfigStore();
