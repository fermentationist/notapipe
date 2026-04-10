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
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 0.75rem 0.5rem;
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
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
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
