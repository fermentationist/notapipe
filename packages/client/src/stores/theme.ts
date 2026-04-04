import { writable, get } from "svelte/store";
import {
  DEFAULT_LIGHT_THEME,
  DEFAULT_DARK_THEME,
  THEME_STORAGE_KEY,
} from "$lib/constants/theme.ts";

export type Theme = Record<string, string>;

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored !== null) {
    try {
      return JSON.parse(stored) as Theme;
    } catch {
      // Malformed stored theme — fall through to default
    }
  }
  const prefers_dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefers_dark ? { ...DEFAULT_DARK_THEME } : { ...DEFAULT_LIGHT_THEME };
}

function applyThemeToRoot(theme: Theme): void {
  const root = document.documentElement;
  Object.entries(theme).forEach(([property, value]) => {
    if (property.startsWith("--")) {
      root.style.setProperty(property, value);
    }
  });
}

function createThemeStore() {
  const initial_theme = getInitialTheme();
  applyThemeToRoot(initial_theme);

  const { subscribe, set, update } = writable<Theme>(initial_theme);

  return {
    subscribe,
    setTheme(theme: Theme): void {
      applyThemeToRoot(theme);
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
      set(theme);
    },
    setBuiltIn(name: "light" | "dark"): void {
      const theme = name === "dark" ? { ...DEFAULT_DARK_THEME } : { ...DEFAULT_LIGHT_THEME };
      this.setTheme(theme);
    },
    applyCustomJson(json_string: string): { success: boolean; error?: string } {
      try {
        const parsed = JSON.parse(json_string) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { success: false, error: "Theme must be a JSON object" };
        }
        const theme = parsed as Theme;
        this.setTheme(theme);
        return { success: true };
      } catch {
        return { success: false, error: "Invalid JSON" };
      }
    },
  };
}

export const theme_store = createThemeStore();
