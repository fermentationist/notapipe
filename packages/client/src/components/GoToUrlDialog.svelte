<script lang="ts">
  import { isValidId } from "../id/generate.ts";

  interface Props {
    initial_value?: string;
    onnavigate: (room_id: string, token: string | null) => void;
    oncancel: () => void;
  }

  let { initial_value = "", onnavigate, oncancel }: Props = $props();

  let input_value = $state(initial_value);
  let error_message = $state("");
  let input_el: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (input_el) {
      input_el.focus();
      input_el.select();
    }
  });

  function parse_room_url(raw: string): { room_id: string; token: string | null } | null {
    const trimmed = raw.trim();
    if (trimmed === "") { return null; }

    let pathname = trimmed;
    let token: string | null = null;

    try {
      const url = new URL(trimmed);
      pathname = url.pathname;
      token = url.hash.slice(1) || null;
    } catch {
      const hash_idx = trimmed.indexOf("#");
      if (hash_idx !== -1) {
        pathname = trimmed.slice(0, hash_idx);
        token = trimmed.slice(hash_idx + 1) || null;
      }
    }

    const room_id = pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!isValidId(room_id)) { return null; }
    return { room_id, token };
  }

  function handleSubmit(): void {
    const result = parse_room_url(input_value);
    if (!result) {
      error_message = "Not a valid notapipe URL or room ID.";
      return;
    }
    onnavigate(result.room_id, result.token);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { oncancel(); }
    if (event.key === "Enter") { handleSubmit(); }
    if (error_message) { error_message = ""; }
  }
</script>

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { oncancel(); } }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Go to room URL">
    <label class="field-label" for="goto-input">Room URL or ID</label>
    <input
      id="goto-input"
      class="url-input"
      class:error={error_message !== ""}
      type="text"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      placeholder="https://notapipe.app/word-word-word#token"
      bind:value={input_value}
      bind:this={input_el}
      onkeydown={handleKeydown}
      oninput={() => { error_message = ""; }}
    />
    {#if error_message}
      <p class="error-msg">{error_message}</p>
    {/if}
    <div class="buttons">
      <button class="cancel-btn" onclick={oncancel}>Cancel</button>
      <button class="go-btn" onclick={handleSubmit}>Go</button>
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
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    padding: 1.5rem;
    width: min(90vw, 400px);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .field-label {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .url-input {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.82rem;
    padding: 0.45rem 0.6rem;
    width: 100%;
    outline: none;
  }

  .url-input:focus {
    border-color: var(--color-accent);
  }

  .url-input.error {
    border-color: var(--color-status-error);
  }

  .error-msg {
    font-size: 0.75rem;
    color: var(--color-status-error);
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
    border-radius: 6px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 36px;
  }

  .cancel-btn:hover {
    border-color: var(--color-text-muted);
  }

  .go-btn {
    background: var(--color-accent);
    border: none;
    color: #fff;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 36px;
  }

  .go-btn:hover {
    opacity: 0.85;
  }
</style>
