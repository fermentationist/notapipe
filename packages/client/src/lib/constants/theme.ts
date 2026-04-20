export const APP_PRIMARY_COLOR = "#c0392b";

export const DEFAULT_LIGHT_THEME = {
  name: "light",
  // --- Global / UI ---
  "--color-bg": "#f5f0e8",
  "--color-surface": "#ede8df",
  "--color-text": "#1a1a18",
  "--color-text-muted": "#b8b2a6",
  "--color-accent": APP_PRIMARY_COLOR,
  "--color-rule": "#d4cfc4",
  "--color-border": "#d4cfc4",
  "--color-status-waiting": "#b8b2a6",
  "--color-status-connecting": "#e0a030",
  "--color-status-connected": "#4caf50",
  "--color-status-error": APP_PRIMARY_COLOR,
  // --- Standard editor ---
  "--standard-font-family": '"IBM Plex Mono", monospace',
  "--standard-font-size": "1rem",
  "--standard-line-height": "28px",
  // --- Focus mode ---
  "--focus-font-family": '"IBM Plex Mono", monospace',
  "--focus-font-size": "1.05rem",
  "--focus-line-height": "28px",
  "--color-focus-bg": "#eee9df",
  "--color-focus-text": "#2a2520",
  "--color-focus-rule": "#ccc7bb",
  // --- Code editor mode ---
  "--code-font-family": '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
  "--code-font-size": "0.9rem",
  "--code-line-height": "22px",
  "--code-bg": "#edeae2",
  "--code-text": "#1a1a18",
  "--code-gutter-text": "#b8b2a6",
  "--code-caret-color": APP_PRIMARY_COLOR,
} as const;

export const DEFAULT_DARK_THEME = {
  name: "dark",
  // --- Global / UI ---
  "--color-bg": "#1a1a18",
  "--color-surface": "#242420",
  "--color-text": "#e8e3d8",
  "--color-text-muted": "#6b6660",
  "--color-accent": APP_PRIMARY_COLOR,
  "--color-rule": "#2e2e2a",
  "--color-border": "#2e2e2a",
  "--color-status-waiting": "#6b6660",
  "--color-status-connecting": "#e0a030",
  "--color-status-connected": "#4caf50",
  "--color-status-error": APP_PRIMARY_COLOR,
  // --- Standard editor ---
  "--standard-font-family": '"IBM Plex Mono", monospace',
  "--standard-font-size": "1rem",
  "--standard-line-height": "28px",
  // --- Focus mode ---
  "--focus-font-family": '"IBM Plex Mono", monospace',
  "--focus-font-size": "1.05rem",
  "--focus-line-height": "28px",
  "--color-focus-bg": "#1a1a18",
  "--color-focus-text": "#d8d3c8",
  "--color-focus-rule": "#242420",
  // --- Code editor mode ---
  "--code-font-family": '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
  "--code-font-size": "0.9rem",
  "--code-line-height": "22px",
  "--code-bg": "#141412",
  "--code-text": "#e8e3d8",
  "--code-gutter-text": "#6b6660",
  "--code-caret-color": APP_PRIMARY_COLOR,
} as const;

export const THEME_STORAGE_KEY = "notapipe:theme";
