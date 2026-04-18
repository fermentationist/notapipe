<script lang="ts">
  interface Props {
    default_filename: string;
    label?: string;
    confirm_label?: string;
    error?: string | null;
    onconfirm: (filename: string) => void;
    oncancel: () => void;
  }

  let {
    default_filename,
    label = "Filename",
    confirm_label = "Share",
    error = null,
    onconfirm,
    oncancel,
  }: Props = $props();

  let input_value = $state(default_filename);
  let input_el: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (input_el) {
      input_el.focus();
      // Select the name portion only (before the extension).
      // Use default_filename — not input_value — so this effect only runs
      // once on mount and does not re-select on every keystroke.
      const dot = default_filename.lastIndexOf(".");
      input_el.setSelectionRange(0, dot > 0 ? dot : default_filename.length);
    }
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { oncancel(); }
    if (event.key === "Enter" && input_value.trim()) { onconfirm(input_value.trim()); }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { oncancel(); } }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Set filename">
    <label class="field-label" for="filename-input">{label}</label>
    <input
      id="filename-input"
      class="filename-input"
      type="text"
      bind:value={input_value}
      bind:this={input_el}
      spellcheck={false}
      autocomplete="off"
    />
    {#if error}
      <p class="error-msg" role="alert">{error}</p>
    {/if}
    <div class="buttons">
      <button class="cancel-btn" onclick={oncancel}>Cancel</button>
      <button
        class="confirm-btn"
        onclick={() => { if (input_value.trim()) { onconfirm(input_value.trim()); } }}
        disabled={!input_value.trim()}
      >{confirm_label}</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .dialog {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 1.5rem;
    width: min(90vw, 360px);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .field-label {
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }

  .filename-input {
    width: 100%;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    font-family: var(--font-mono, monospace);
    font-size: 0.9rem;
    padding: 0.45rem 0.6rem;
    outline: none;
  }

  .filename-input:focus {
    border-color: var(--color-text-muted);
  }

  .error-msg {
    font-size: 0.78rem;
    color: #f87171;
    line-height: 1.45;
    margin: 0;
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.25rem;
  }

  .cancel-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 0.4rem 0.9rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 36px;
  }

  .cancel-btn:hover {
    border-color: var(--color-text-muted);
  }

  .confirm-btn {
    background: var(--color-accent, #4ade80);
    border: none;
    color: #0d0d0d;
    padding: 0.4rem 0.9rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 36px;
  }

  .confirm-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .confirm-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
