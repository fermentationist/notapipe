<script lang="ts">
  import { connection_store } from "../stores/connection.ts";

  const status_label: Record<string, string> = {
    idle: "waiting",
    connecting: "connecting",
    disconnected: "disconnected",
    failed: "error",
    closed: "closed",
  };

  function connectedLabel(peer_count: number): string {
    return `${peer_count} ${peer_count === 1 ? "peer" : "peers"} connected`;
  }

  $: display_label = $connection_store.peer_state === "connected"
    ? connectedLabel($connection_store.remote_peer_ids.length)
    : (status_label[$connection_store.peer_state] ?? "unknown");
</script>

<span class="status-dot state-{$connection_store.peer_state}" aria-label="Connection status: {display_label}"></span>
<span class="status-label">{display_label}</span>

<style>
  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    vertical-align: middle;
    margin-right: 4px;
    background-color: var(--color-status-waiting);
  }

  .status-dot.state-connecting {
    background-color: var(--color-status-connecting);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .status-dot.state-connected {
    background-color: var(--color-status-connected);
  }

  .status-dot.state-failed,
  .status-dot.state-closed {
    background-color: var(--color-status-error);
  }

  .status-label {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    vertical-align: middle;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
