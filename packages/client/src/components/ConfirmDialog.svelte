<script lang="ts">
  interface Props {
    message: string;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { message, onconfirm, oncancel }: Props = $props();

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { oncancel(); }
    if (event.key === "Enter") { onconfirm(); }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { oncancel(); } }}
>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-label="Confirm action">
    <p class="message">{message}</p>
    <div class="buttons">
      <button class="cancel-btn" onclick={oncancel}>Cancel</button>
      <button class="confirm-btn" onclick={onconfirm}>Confirm</button>
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
    width: min(90vw, 320px);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .message {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--color-text);
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
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
    background: var(--color-status-error);
    border: none;
    color: #fff;
    padding: 0.4rem 0.9rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 36px;
  }

  .confirm-btn:hover {
    opacity: 0.85;
  }
</style>
