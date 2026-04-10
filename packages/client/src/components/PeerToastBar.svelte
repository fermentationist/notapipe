<script lang="ts">
  export interface PeerToast {
    id: string;
    message: string;
  }

  interface Props {
    toasts: PeerToast[];
    ondismiss: (id: string) => void;
  }

  let { toasts, ondismiss }: Props = $props();
</script>

{#if toasts.length > 0}
  <div class="toast-bar" aria-live="polite" aria-label="Peer notifications">
    {#each toasts as toast (toast.id)}
      <div class="toast">
        <span class="toast-message">{toast.message}</span>
        <button
          class="dismiss-btn"
          onclick={() => ondismiss(toast.id)}
          aria-label="Dismiss"
        >✕</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-bar {
    position: fixed;
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 50;
    max-width: min(320px, calc(100vw - 2rem));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.35rem 0.5rem 0.35rem 0.75rem;
    font-size: 0.8rem;
    color: var(--color-text-muted);
    animation: slide-in 0.15s ease-out;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    pointer-events: auto;
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .toast-message {
    flex: 1;
  }

  .dismiss-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0 2px;
    line-height: 1;
    flex-shrink: 0;
  }

  .dismiss-btn:hover {
    color: var(--color-text);
  }
</style>
