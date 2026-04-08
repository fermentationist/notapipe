<script lang="ts">
  import type { IncomingOffer } from "../rtc/file_transfer.ts";

  interface Props {
    connected: boolean;
    incoming_offers: Map<string, IncomingOffer>;
    transfer_progress: Map<string, { received: number; total: number }>;
    completed_files: Map<string, { url: string; filename: string }>;
    onaccept: (transfer_id: string) => void;
    ondecline: (transfer_id: string) => void;
    oncancel: (transfer_id: string) => void;
    ondismiss: (transfer_id: string) => void;
    onsendfile: (file: File) => void;
  }

  let {
    connected,
    incoming_offers,
    transfer_progress,
    completed_files,
    onaccept,
    ondecline,
    oncancel,
    ondismiss,
    onsendfile,
  }: Props = $props();

  let drag_over = $state(false);

  function formatBytes(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1_048_576) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    drag_over = false;
    const file = event.dataTransfer?.files[0];
    if (file) {
      onsendfile(file);
    }
  }
</script>

<!-- Drag overlay — covers the whole editor area, only interactive when connected -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="drop-zone"
  class:active={drag_over}
  ondragover={(e) => { if (!connected) { return; } e.preventDefault(); drag_over = true; }}
  ondragleave={() => { drag_over = false; }}
  ondrop={(e) => { if (!connected) { return; } handleDrop(e); }}
>
  {#if drag_over}
    <div class="drop-hint">Drop file to send</div>
  {/if}
</div>

<!-- Notification strips -->
{#if incoming_offers.size > 0 || transfer_progress.size > 0 || completed_files.size > 0}
  <div class="transfer-strips">

    {#each [...incoming_offers.entries()] as [transfer_id, offer] (transfer_id)}
      <div class="strip incoming">
        <span class="strip-label">
          Incoming: <strong>{offer.filename}</strong> ({formatBytes(offer.total_size)})
        </span>
        <div class="strip-actions">
          <button class="strip-btn accept" onclick={() => onaccept(transfer_id)}>Save</button>
          <button class="strip-btn decline" onclick={() => ondecline(transfer_id)}>Decline</button>
        </div>
      </div>
    {/each}

    {#each [...transfer_progress.entries()] as [transfer_id, progress] (transfer_id)}
      <div class="strip progress">
        <span class="strip-label">
          Transferring… {Math.round((progress.received / progress.total) * 100)}%
        </span>
        <div class="strip-actions">
          <button class="strip-btn decline" onclick={() => oncancel(transfer_id)}>Cancel</button>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:{(progress.received / progress.total) * 100}%"></div>
        </div>
      </div>
    {/each}

    {#each [...completed_files.entries()] as [transfer_id, file] (transfer_id)}
      <div class="strip complete">
        <span class="strip-label">
          Ready: <strong>{file.filename}</strong>
        </span>
        <div class="strip-actions">
          <a class="strip-btn accept" href={file.url} download={file.filename} onclick={() => ondismiss(transfer_id)}>Download</a>
        </div>
      </div>
    {/each}

  </div>
{/if}

<style>
  .drop-zone {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
  }

  .drop-zone.active {
    pointer-events: auto;
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 2px dashed var(--color-accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .drop-hint {
    font-size: 1.25rem;
    color: var(--color-accent);
    pointer-events: none;
  }

  .transfer-strips {
    position: fixed;
    bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px) + 2.5rem + 0.5rem);
    left: 1rem;
    right: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    z-index: 30;
    pointer-events: none;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    font-size: 0.82rem;
    pointer-events: auto;
    flex-wrap: wrap;
    position: relative;
    overflow: hidden;
  }

  .strip-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
  }

  .strip-actions {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .strip-btn {
    padding: 0.2rem 0.55rem;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    font-size: 0.8rem;
    cursor: pointer;
    background: var(--color-bg);
    color: var(--color-text);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }

  .strip-btn.accept {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .strip-btn:hover {
    opacity: 0.8;
  }

  .progress-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--color-border);
  }

  .progress-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 0.1s linear;
  }
</style>
