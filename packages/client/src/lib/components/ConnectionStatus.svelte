<script lang="ts">
  import { connection_store } from "../../stores/connection.ts";

  const status_label: Record<string, string> = {
    idle: "waiting",
    connecting: "connecting",
    connected: "connected",
    disconnected: "disconnected",
    failed: "error",
    closed: "closed",
  };
</script>

<span class="status-dot state-{$connection_store.peer_state}" aria-label="Connection status: {status_label[$connection_store.peer_state] ?? 'unknown'}"></span>
<span class="status-label">{status_label[$connection_store.peer_state] ?? "unknown"}</span>

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
