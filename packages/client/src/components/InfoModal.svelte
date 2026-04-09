<script lang="ts">
  import MarkdownPreview from "./MarkdownPreview.svelte";

  interface Props {
    title: string;
    content: string | null; // null = loading
    onclose: () => void;
  }

  let { title, content, onclose }: Props = $props();

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
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <div class="modal-header">
      <h2>{title}</h2>
      <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      {#if content === null}
        <p class="loading">Loading…</p>
      {:else}
        <MarkdownPreview {content} />
      {/if}
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
    padding: 1rem;
  }

  .modal {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    width: min(96vw, 760px);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem 0.5rem;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .loading {
    padding: 2rem;
    color: var(--color-text-muted);
    font-style: italic;
    margin: 0;
  }
</style>
