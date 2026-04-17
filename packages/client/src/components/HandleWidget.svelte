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

  // Size the input to its content — at least 6 chars, at most 20.
  const input_size = $derived(Math.min(Math.max(draft.length + 1, 6), 20));

  function commit(value: string): void {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== handle) {
      onchange(trimmed);
    }
    draft = trimmed.length > 0 ? trimmed : handle;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === "Escape") {
      draft = handle;
      (event.currentTarget as HTMLInputElement).blur();
    }
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

<!-- Inline input — wide screens only -->
<div class="handle-inline">
  <span class="handle-icon" aria-hidden="true">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/>
    </svg>
  </span>
  <input
    class="handle-input"
    type="text"
    value={draft}
    size={input_size}
    maxlength="32"
    aria-label="Your handle"
    title="Your handle (click to edit)"
    oninput={(e) => { draft = (e.currentTarget as HTMLInputElement).value; }}
    onblur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
    onkeydown={handleKeydown}
  />
</div>

<!-- Icon button — narrow screens only -->
<button
  class="handle-icon-btn"
  onclick={openModal}
  title="Your handle: {handle}"
  aria-label="Edit your handle"
>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/>
  </svg>
</button>

<!-- Modal for narrow screens -->
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
  /* Inline — wide screens only */
  .handle-inline {
    display: none;
    align-items: center;
    gap: 4px;
    color: var(--color-text-muted);
  }

  /* Icon button — narrow screens only */
  .handle-icon-btn {
    display: flex;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0.25rem;
    align-items: center;
    justify-content: center;
  }

  .handle-icon-btn:hover {
    color: var(--color-text);
  }

  @media (min-width: 600px) {
    .handle-inline {
      display: flex;
    }
    .handle-icon-btn {
      display: none;
    }
  }

  .handle-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .handle-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.8rem;
    padding: 1px 4px;
    outline: none;
    transition: border-color 0.15s;
    min-width: 6ch;
    max-width: 20ch;
  }

  .handle-input:focus {
    border-bottom-color: var(--color-accent);
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
    border-radius: 8px;
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
    border-radius: 4px;
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
