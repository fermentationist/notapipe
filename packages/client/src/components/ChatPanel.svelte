<script lang="ts">
  import { tick } from "svelte";

  export interface ChatMessage {
    id: string;
    handle: string;
    text: string;
    timestamp: number;
    is_local: boolean;
  }

  interface Props {
    messages: ChatMessage[];
    local_handle: string;
    connected: boolean;
    onclose: () => void;
    onsend: (text: string) => void;
  }

  let { messages, local_handle, connected, onclose, onsend }: Props = $props();

  let input_el: HTMLTextAreaElement = $state() as HTMLTextAreaElement;
  let scroll_el: HTMLDivElement = $state() as HTMLDivElement;
  let draft = $state("");

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }

  function send(): void {
    const text = draft.trim();
    if (text.length === 0 || !connected) {
      return;
    }
    onsend(text);
    draft = "";
    // Re-focus after send
    tick().then(() => input_el?.focus());
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  // Scroll to bottom whenever messages change.
  $effect(() => {
    // Access messages.length to track the dependency.
    const _ = messages.length;
    tick().then(() => {
      if (scroll_el) {
        scroll_el.scrollTop = scroll_el.scrollHeight;
      }
    });
  });
</script>

<div class="chat-panel">
  <div class="chat-header">
    <span class="chat-title">Chat</span>
    <button class="close-btn" onclick={onclose} aria-label="Close chat">✕</button>
  </div>

  <div class="messages" bind:this={scroll_el}>
    {#if messages.length === 0}
      <p class="empty-hint">No messages yet.</p>
    {:else}
      {#each messages as msg (msg.id)}
        <div class="message" class:local={msg.is_local}>
          <div class="meta">
            <span class="handle">{msg.is_local ? local_handle : msg.handle}</span>
            <span class="time">{formatTime(msg.timestamp)}</span>
          </div>
          <div class="bubble">{msg.text}</div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="input-row">
    <textarea
      bind:this={input_el}
      class="chat-input"
      bind:value={draft}
      onkeydown={handleKeydown}
      placeholder={connected ? "Message… (Enter to send)" : "Not connected"}
      disabled={!connected}
      rows="2"
      aria-label="Chat message"
    ></textarea>
    <button
      class="send-btn"
      onclick={send}
      disabled={!connected || draft.trim().length === 0}
      aria-label="Send message"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M1 1l14 7-14 7V9.5l10-1.5-10-1.5V1z"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-left: 1px solid var(--color-border);
    background: var(--color-bg);
  }

  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .chat-title {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--color-text-muted);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.15rem 0.4rem;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }

  .empty-hint {
    margin: auto;
    font-size: 0.8rem;
    color: var(--color-text-muted);
    text-align: center;
  }

  .message {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    max-width: 85%;
  }

  .message.local {
    align-items: flex-end;
    align-self: flex-end;
  }

  .meta {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }

  .handle {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .time {
    font-size: 0.65rem;
    color: var(--color-text-muted);
    opacity: 0.7;
  }

  .bubble {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.4rem 0.7rem;
    font-size: 0.85rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.local .bubble {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #fff;
    border-radius: 12px 12px 4px 12px;
  }

  .message:not(.local) .bubble {
    border-radius: 12px 12px 12px 4px;
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .chat-input {
    flex: 1;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.85rem;
    line-height: 1.4;
    padding: 0.4rem 0.6rem;
    resize: none;
    outline: none;
    box-sizing: border-box;
  }

  .chat-input:focus {
    border-color: var(--color-accent);
  }

  .chat-input:disabled {
    opacity: 0.5;
  }

  .send-btn {
    background: var(--color-accent);
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    padding: 0.45rem 0.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-height: 36px;
    min-width: 36px;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .send-btn:not(:disabled):hover {
    opacity: 0.85;
  }
</style>
