<script lang="ts">
  interface Props {
    handle: string;
    onchange: (handle: string) => void;
  }

  let { handle, onchange }: Props = $props();

  let show_modal = $state(false);
  let draft = $state(handle);

  // Keep draft in sync when handle changes externally (e.g. on first load).
  $effect(() => {
    draft = handle;
  });

  function commit(value: string): void {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== handle) {
      onchange(trimmed);
    }
    draft = trimmed.length > 0 ? trimmed : handle;
  }

  function openModal(): void {
    draft = handle;
    show_modal = true;
  }

  function closeModal(): void {
    show_modal = false;
  }

  function commitModal(): void {
    commit(draft);
    closeModal();
  }

  function handleModalKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      commitModal();
    } else if (event.key === "Escape") {
      closeModal();
    }
  }
</script>

<!-- Pill chip button — opens rename modal at all screen sizes -->
<button
  class="handle-chip"
  onclick={openModal}
  title="Your handle: {handle} — click to rename"
  aria-label="Your handle: {handle}. Click to rename."
>
  {handle}
</button>

<!-- Rename modal -->
{#if show_modal}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) { closeModal(); } }}
    onkeydown={(e) => { if (e.key === "Escape") { closeModal(); } }}
  >
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Edit handle">
      <p class="modal-label">Your handle</p>
      <input
        class="modal-input"
        type="text"
        bind:value={draft}
        maxlength="32"
        aria-label="Your handle"
        onkeydown={handleModalKeydown}
      />
      <div class="modal-actions">
        <button class="action-btn" onclick={commitModal}>Save</button>
        <button class="action-btn secondary" onclick={closeModal}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .handle-chip {
    font-size: 0.75rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .handle-chip:hover {
    border-color: var(--color-text-muted);
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal-panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    padding: 1.5rem;
    width: min(90vw, 280px);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-label {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .modal-input {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.9rem;
    padding: 0.4rem 0.6rem;
    width: 100%;
    outline: none;
    box-sizing: border-box;
  }

  .modal-input:focus {
    border-color: var(--color-accent);
  }

  .modal-actions {
    display: flex;
    gap: 0.5rem;
  }

  .action-btn {
    background: var(--color-accent);
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 0.5rem 1rem;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    flex: 1;
  }

  .action-btn.secondary {
    background: transparent;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }
</style>
