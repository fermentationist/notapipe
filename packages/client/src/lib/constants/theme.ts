export const DEFAULT_LIGHT_THEME = {
  name: "light",
  "--color-bg": "#f5f0e8",
  "--color-surface": "#ede8df",
  "--color-text": "#1a1a18",
  "--color-text-muted": "#b8b2a6",
  "--color-accent": "#c0392b",
  "--color-rule": "#d4cfc4",
  "--color-border": "#d4cfc4",
  "--color-status-waiting": "#b8b2a6",
  "--color-status-connecting": "#e0a030",
  "--color-status-connected": "#4caf50",
  "--color-status-error": "#c0392b",
  "--line-height": "28px",
  "--color-focus-bg": "#eee9df",
  "--color-focus-text": "#2a2520",
  "--color-focus-rule": "#ccc7bb",
} as const;

export const DEFAULT_DARK_THEME = {
  name: "dark",
  "--color-bg": "#1a1a18",
  "--color-surface": "#242420",
  "--color-text": "#e8e3d8",
  "--color-text-muted": "#6b6660",
  "--color-accent": "#e05c4a",
  "--color-rule": "#2e2e2a",
  "--color-border": "#2e2e2a",
  "--color-status-waiting": "#6b6660",
  "--color-status-connecting": "#e0a030",
  "--color-status-connected": "#4caf50",
  "--color-status-error": "#e05c4a",
  "--line-height": "28px",
  "--color-focus-bg": "#141412",
  "--color-focus-text": "#d8d3c8",
  "--color-focus-rule": "#242420",
} as const;

export const THEME_STORAGE_KEY = "notapipe_theme";
