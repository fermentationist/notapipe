import { writable } from "svelte/store";
import { RTC_CONFIG_KEY } from "$lib/constants/storage.ts";

export interface RTCUserConfig {
  // Override the build-time VITE_SIGNAL_URL. Empty string = use app default.
  signal_url: string;
  // TURN server — all three must be non-empty to take effect. Empty = STUN only (default).
  turn_url: string;
  turn_username: string;
  turn_credential: string;
}

export const RTC_CONFIG_DEFAULTS: RTCUserConfig = {
  // Pre-populate with the build-time env var if set (e.g. GitHub Pages → Render signalling).
  // Use || so that an empty-string env var (unset GitHub secret) is treated as missing.
  // Empty string means "same host as the app" (Render self-hosted deployment).
  signal_url: import.meta.env.VITE_SIGNAL_URL || "",
  // No default TURN server. Users who need relay supply their own credentials.
  turn_url: "",
  turn_username: "",
  turn_credential: "",
};

// Previous default TURN servers that were bundled with the app. Stored configs
// containing these credentials are migrated to the new empty defaults so users
// aren't silently locked in to third-party relay servers they never chose.
const STALE_TURN_SERVERS = [
  {
    url: "turns:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  { url: "turn:freestun.net:3479", username: "free", credential: "free" },
  { url: "turns:freestun.net:5350", username: "free", credential: "free" },
];

function load(): RTCUserConfig {
  try {
    const raw = localStorage.getItem(RTC_CONFIG_KEY);
    if (raw === null) {
      return { ...RTC_CONFIG_DEFAULTS };
    }
    const stored = JSON.parse(raw) as Partial<RTCUserConfig>;
    // Migrate any previously-bundled default TURN credentials to empty (user opt-in only).
    const is_stale = STALE_TURN_SERVERS.some(
      (s) =>
        stored.turn_url === s.url &&
        stored.turn_username === s.username &&
        stored.turn_credential === s.credential,
    );
    if (is_stale) {
      delete stored.turn_url;
      delete stored.turn_username;
      delete stored.turn_credential;
    }
    return { ...RTC_CONFIG_DEFAULTS, ...stored };
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
