<script lang="ts">
  import { get } from "svelte/store";
  import { theme_store } from "../stores/theme.ts";
  import { persistence_store } from "../stores/persistence.ts";
  import { DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME } from "$lib/constants/theme.ts";

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  // Snapshot the current CSS variable values so the input styles don't shift
  // when the user live-edits tokens like --color-bg or --color-text.
  const root_style = getComputedStyle(document.documentElement);
  const frozen_input_bg = root_style.getPropertyValue("--color-bg").trim() || "#ffffff";
  const frozen_input_text = root_style.getPropertyValue("--color-text").trim() || "#000000";
  const frozen_input_border = root_style.getPropertyValue("--color-border").trim() || "#cccccc";
  const frozen_input_style = `background:${frozen_input_bg};color:${frozen_input_text};border-color:${frozen_input_border};`;

  type ThemeTab = "light" | "dark" | "custom";

  // All CSS custom property keys (excludes "name")
  const token_keys = Object.keys(DEFAULT_LIGHT_THEME).filter((k) => k.startsWith("--"));

  // Determine initial tab from currently active theme
  function getInitialTab(): ThemeTab {
    const theme = get(theme_store);
    if (theme["name"] === "dark") { return "dark"; }
    if (theme["name"] === "light") { return "light"; }
    return "custom";
  }

  let active_tab = $state<ThemeTab>(getInitialTab());

  // Custom tab values — initialized from current theme (preserves any existing custom work)
  const current_theme = get(theme_store);
  let custom_values = $state<Record<string, string>>(
    Object.fromEntries(
      token_keys.map((k) => [k, current_theme[k] ?? DEFAULT_LIGHT_THEME[k as keyof typeof DEFAULT_LIGHT_THEME] as string])
    )
  );

  function isColorValue(value: string): boolean {
    return value.startsWith("#");
  }

  function selectTab(tab: ThemeTab): void {
    active_tab = tab;
    if (tab === "light") {
      theme_store.setBuiltIn("light");
    } else if (tab === "dark") {
      theme_store.setBuiltIn("dark");
    } else {
      // Apply current custom values immediately when switching to custom tab
      theme_store.setTheme(custom_values);
    }
  }

  function handleCustomChange(token: string, value: string): void {
    custom_values[token] = value;
    theme_store.setTheme(custom_values);
  }

  function saveCustom(): void {
    const json = JSON.stringify(custom_values, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "notapipe-theme.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function loadCustom(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file === undefined) { return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
          token_keys.forEach((k) => {
            if (typeof parsed[k] === "string") {
              custom_values[k] = parsed[k] as string;
            }
          });
          theme_store.setTheme(custom_values);
        } catch {
          // Silently ignore malformed JSON
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { onclose(); }
  }

  function tokenLabel(key: string): string {
    // Strip leading "--" for display; keep the rest
    return key.slice(2);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { onclose(); } }}
>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Settings">
    <button class="close-btn" onclick={onclose} aria-label="Close settings">✕</button>
    <h2>Settings</h2>

    <section>
      <h3>Storage</h3>
      <label class="toggle-label">
        <input
          type="checkbox"
          checked={$persistence_store}
          onchange={() => { $persistence_store ? persistence_store.disable() : persistence_store.enable(); }}
        />
        <span>Save to localStorage</span>
      </label>
      <p class="storage-note">
        Stores document content in your browser's local storage — never sent to a server.
        Off by default.
      </p>
    </section>

    <section>
      <h3>Theme</h3>
      <div class="tabs" role="tablist">
        <button
          class="tab-btn"
          class:active={active_tab === "light"}
          role="tab"
          aria-selected={active_tab === "light"}
          onclick={() => selectTab("light")}
        >Light</button>
        <button
          class="tab-btn"
          class:active={active_tab === "dark"}
          role="tab"
          aria-selected={active_tab === "dark"}
          onclick={() => selectTab("dark")}
        >Dark</button>
        <button
          class="tab-btn"
          class:active={active_tab === "custom"}
          role="tab"
          aria-selected={active_tab === "custom"}
          onclick={() => selectTab("custom")}
        >Custom</button>
        {#if active_tab === "custom"}
          <div class="tab-actions">
            <button class="tab-icon-btn" onclick={loadCustom} title="Load theme from JSON file" aria-label="Load theme">↑</button>
            <button class="tab-icon-btn" onclick={saveCustom} title="Save theme as JSON file" aria-label="Save theme">↓</button>
          </div>
        {/if}
      </div>

      <div class="token-list" role="tabpanel">
        {#if active_tab === "light" || active_tab === "dark"}
          {@const source = active_tab === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME}
          {#each token_keys as key (key)}
            {@const value = source[key as keyof typeof source] as string}
            <div class="token-row">
              <span class="token-name">{tokenLabel(key)}</span>
              <div class="token-value">
                {#if isColorValue(value)}
                  <span class="color-swatch" style="background: {value};"></span>
                {/if}
                <span class="token-text">{value}</span>
              </div>
            </div>
          {/each}
        {:else}
          {#each token_keys as key (key)}
            {@const value = custom_values[key] ?? ""}
            <div class="token-row">
              <span class="token-name">{tokenLabel(key)}</span>
              <div class="token-value">
                {#if isColorValue(value)}
                  <input
                    type="color"
                    value={value}
                    oninput={(e) => handleCustomChange(key, (e.target as HTMLInputElement).value)}
                    class="color-picker"
                    aria-label={key}
                  />
                {/if}
                <input
                  type="text"
                  value={value}
                  oninput={(e) => handleCustomChange(key, (e.target as HTMLInputElement).value)}
                  class="token-input"
                  style={frozen_input_style}
                  spellcheck="false"
                  aria-label={key}
                />
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    z-index: 100;
    padding: 3.5rem 1rem 1rem;
  }

  .panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 1.5rem;
    width: min(90vw, 360px);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-height: calc(100vh - 5rem);
    overflow-y: auto;
  }

  .close-btn {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .storage-note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  /* Tabs */
  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 0;
    margin-bottom: 0.5rem;
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: 0.85rem;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    margin-bottom: -1px;
    border-radius: 4px 4px 0 0;
  }

  .tab-btn.active {
    color: var(--color-text);
    border-bottom-color: var(--color-accent);
  }

  .tab-btn:hover:not(.active) {
    color: var(--color-text);
  }

  .tab-actions {
    margin-left: auto;
    display: flex;
    gap: 2px;
  }

  .tab-icon-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: 0.9rem;
    padding: 0.25rem 0.4rem;
    cursor: pointer;
    border-radius: 3px;
    line-height: 1;
  }

  .tab-icon-btn:hover {
    color: var(--color-text);
    background: var(--color-bg);
  }

  /* Token rows */
  .token-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 28px;
  }

  .token-name {
    flex: 1;
    font-size: 0.72rem;
    font-family: "IBM Plex Mono", monospace;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .token-value {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .color-swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .token-text {
    font-size: 0.72rem;
    font-family: "IBM Plex Mono", monospace;
    color: var(--color-text);
  }

  .color-picker {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    cursor: pointer;
    background: none;
    flex-shrink: 0;
  }

  .token-input {
    width: 80px;
    font-size: 0.72rem;
    font-family: "IBM Plex Mono", monospace;
    border: 1px solid;
    border-radius: 3px;
    padding: 2px 4px;
  }

  .token-input:focus {
    outline: 1px solid var(--color-accent);
    border-color: var(--color-accent);
  }
</style>
