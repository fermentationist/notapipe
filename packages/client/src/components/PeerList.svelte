<script lang="ts">
  interface Peer {
    id: string;
    handle: string;
  }

  interface Props {
    peers: Peer[];
  }

  let { peers }: Props = $props();

  let open = $state(false);
  let btn_el: HTMLButtonElement = $state() as HTMLButtonElement;

  function toggle(): void {
    open = !open;
  }

  function handleWindowClick(event: MouseEvent): void {
    if (open && btn_el && !btn_el.closest(".peer-list-wrapper")?.contains(event.target as Node)) {
      open = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="peer-list-wrapper">
  <button
    bind:this={btn_el}
    class="icon-btn peer-btn"
    class:has-peers={peers.length > 0}
    onclick={toggle}
    title="{peers.length} connected {peers.length === 1 ? 'peer' : 'peers'}"
    aria-label="Connected peers"
    aria-haspopup="true"
    aria-expanded={open}
  >
    <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM0 18v-1c0-2.21 2.69-4 6-4 .6 0 1.18.07 1.72.2C6.65 14.55 6 15.96 6 17.5V18H0zm20 0h-6v-.5c0-1.54-.65-2.95-1.72-4.3C13.82 13.07 14.4 13 15 13c3.31 0 5 1.79 5 4v1zm-10 0H4v-.5C4 15.57 6.69 14 10 14s6 1.57 6 3.5V18h-6z"/>
    </svg>
    {#if peers.length > 0}
      <span class="badge">{peers.length}</span>
    {/if}
  </button>

  {#if open}
    <div class="popover" role="menu">
      {#if peers.length === 0}
        <div class="empty">No peers connected</div>
      {:else}
        {#each peers as peer (peer.id)}
          <div class="peer-row" role="menuitem">
            <span class="status-dot" aria-hidden="true"></span>
            <span class="peer-handle">{peer.handle}</span>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .peer-list-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    gap: 3px;
    font-family: inherit;
    font-size: 0.75rem;
    position: relative;
  }

  .icon-btn:hover,
  .icon-btn.has-peers {
    color: var(--color-text);
  }

  .badge {
    font-size: 0.65rem;
    font-weight: 600;
    background: var(--color-accent);
    color: #fff;
    border-radius: 999px;
    min-width: 14px;
    height: 14px;
    line-height: 14px;
    text-align: center;
    padding: 0 3px;
    position: absolute;
    top: 0;
    right: -2px;
  }

  .popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    min-width: 160px;
    max-width: 240px;
    max-height: 280px;
    overflow-y: auto;
    z-index: 150;
  }

  .empty {
    padding: 0.6rem 0.75rem;
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .peer-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
  }

  .peer-row:not(:last-child) {
    border-bottom: 1px solid var(--color-border);
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-status-connected, #4caf50);
    flex-shrink: 0;
  }

  .peer-handle {
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
