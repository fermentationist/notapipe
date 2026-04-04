<script lang="ts">
  import { theme_store } from "../../stores/theme.ts";

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let custom_json = $state("");
  let custom_json_error = $state<string | null>(null);
  let custom_json_success = $state(false);

  function applyCustomTheme(): void {
    const result = theme_store.applyCustomJson(custom_json);
    if (result.success) {
      custom_json_error = null;
      custom_json_success = true;
      setTimeout(() => { custom_json_success = false; }, 1500);
    } else {
      custom_json_error = result.error ?? "Invalid theme";
      custom_json_success = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      onclose();
    }
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
      <h3>Theme</h3>
      <div class="theme-buttons">
        <button onclick={() => theme_store.setBuiltIn("light")} class="theme-btn">
          Light
        </button>
        <button onclick={() => theme_store.setBuiltIn("dark")} class="theme-btn">
          Dark
        </button>
      </div>

      <label class="custom-label" for="custom-theme-input">
        Custom theme JSON:
      </label>
      <textarea
        id="custom-theme-input"
        class="custom-json"
        bind:value={custom_json}
        placeholder={`{ "--color-bg": "#f5f0e8", ... }`}
        spellcheck="false"
        rows="6"
      ></textarea>
      {#if custom_json_error !== null}
        <p class="error">{custom_json_error}</p>
      {/if}
      {#if custom_json_success}
        <p class="success">Theme applied</p>
      {/if}
      <button class="apply-btn" onclick={applyCustomTheme} disabled={custom_json.trim() === ""}>
        Apply
      </button>
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
    width: min(90vw, 300px);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
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

  .theme-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .theme-btn {
    flex: 1;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 0.4rem 0;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 44px;
  }

  .theme-btn:hover {
    border-color: var(--color-accent);
  }

  .custom-label {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .custom-json {
    font-family: inherit;
    font-size: 0.8rem;
    background: var(--color-bg);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.5rem;
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
  }

  .apply-btn {
    background: var(--color-accent);
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    align-self: flex-start;
    min-height: 44px;
  }

  .apply-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    margin: 0;
    color: var(--color-status-error);
    font-size: 0.8rem;
  }

  .success {
    margin: 0;
    color: var(--color-status-connected);
    font-size: 0.8rem;
  }
</style>
