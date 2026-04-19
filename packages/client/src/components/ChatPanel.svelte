<script lang="ts">
  import { tick, onMount } from "svelte";
  import LockIcon from "./LockIcon.svelte";
  import CopyIcon from "./CopyIcon.svelte";
  import { SECRET_PLACEHOLDER } from "$lib/constants/storage.ts";

  export interface ChatMessage {
    id: string;
    handle: string;
    text: string;
    timestamp: number;
    is_local: boolean;
    secret?: boolean;
  }

  interface Props {
    messages: ChatMessage[];
    local_handle: string;
    connected: boolean;
    onclose: () => void;
    onsend: (text: string, secret: boolean) => void;
  }

  let { messages, local_handle, connected, onclose, onsend }: Props = $props();

  let textarea_el: HTMLTextAreaElement = $state() as HTMLTextAreaElement;
  let password_el: HTMLInputElement = $state() as HTMLInputElement;
  let scroll_el: HTMLDivElement = $state() as HTMLDivElement;
  let draft = $state("");
  let secret_mode = $state(false);
  let copied_id = $state<string | null>(null);

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
    onsend(text, secret_mode);
    draft = "";
    secret_mode = false;
    tick().then(() => textarea_el?.focus());
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function toggleSecretMode(): void {
    secret_mode = !secret_mode;
    tick().then(() => (secret_mode ? password_el : textarea_el)?.focus());
  }

  async function copySecret(msg: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(msg.text);
      copied_id = msg.id;
      setTimeout(() => {
        copied_id = null;
      }, 1500);
    } catch {
      // Clipboard access denied — nothing to do
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

  // On mobile, when the virtual keyboard appears the visual viewport shrinks.
  // Scroll the message list to the bottom so the latest messages remain visible
  // in the reduced space above the keyboard.
  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }
    const on_viewport_resize = () => {
      tick().then(() => {
        if (scroll_el) {
          scroll_el.scrollTop = scroll_el.scrollHeight;
        }
      });
    };
    vv.addEventListener("resize", on_viewport_resize);
    return () => {
      vv.removeEventListener("resize", on_viewport_resize);
    };
  });
</script>

<div class="chat-panel">
  <div class="chat-header">
    <span class="chat-title">Chat</span>
    <button class="close-btn" onclick={onclose} aria-label="Close chat"
      >✕</button
    >
  </div>

  <div class="messages" bind:this={scroll_el}>
    <!-- Spacer grows to fill unused space so messages are anchored to the bottom,
         matching the behaviour of WhatsApp/iMessage and keeping the latest
         messages visible when the virtual keyboard shrinks the viewport. -->
    <div class="messages-spacer" aria-hidden="true"></div>
    {#if messages.length === 0}
      <p class="empty-hint">No messages yet.</p>
    {:else}
      {#each messages as msg (msg.id)}
        <div class="message" class:local={msg.is_local}>
          <div class="meta">
            <span class="handle"
              >{msg.is_local ? local_handle : msg.handle}</span
            >
            <span class="time">{formatTime(msg.timestamp)}</span>
            {#if msg.secret}
              <span class="secret-label"><LockIcon size={9} /> secret</span>
            {/if}
          </div>
          {#if msg.secret}
            <div class="bubble secret-bubble">
              <span class="secret-dots">••••••••</span>
              {#if msg.text !== SECRET_PLACEHOLDER}
                <button
                  class="copy-secret-btn"
                  onclick={() => copySecret(msg)}
                  aria-label="Copy secret to clipboard"
                  title="Copy secret"
                >
                  <CopyIcon copied={copied_id === msg.id} size={12} />
                </button>
              {/if}
            </div>
          {:else}
            <div class="bubble">{msg.text}</div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="input-row">
    <button
      class="secret-toggle"
      class:active={secret_mode}
      onclick={toggleSecretMode}
      title={secret_mode
        ? "Secret mode on — click to disable"
        : "Send a secret (e.g. password)"}
      aria-label={secret_mode ? "Disable secret mode" : "Enable secret mode"}
      aria-pressed={secret_mode}
    >
      <LockIcon size={13} />
    </button>
    {#if secret_mode}
      <input
        bind:this={password_el}
        type="password"
        class="chat-input"
        bind:value={draft}
        onkeydown={handleKeydown}
        placeholder="Secret message… (Enter to send)"
        disabled={!connected}
        aria-label="Secret chat message"
      />
    {:else}
      <textarea
        bind:this={textarea_el}
        class="chat-input"
        bind:value={draft}
        onkeydown={handleKeydown}
        placeholder={connected ? "Message… (Enter to send)" : "Not connected"}
        disabled={!connected}
        rows="3"
        aria-label="Chat message"
      ></textarea>
    {/if}
    <button
      class="send-btn"
      onclick={send}
      disabled={!connected || draft.trim().length === 0}
      aria-label="Send message"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M1 1l14 7-14 7V9.5l10-1.5-10-1.5V1z"></path>
      </svg>
      <span class="send-label">Send</span>
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

  .messages-spacer {
    flex: 1;
  }

  .empty-hint {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    text-align: center;
    padding: 0.5rem 0;
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

  .secret-label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 0.6rem;
    color: var(--color-text-muted);
    opacity: 0.8;
  }

  .secret-bubble {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .secret-dots {
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
    user-select: none;
  }

  .copy-secret-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0.1rem 0.2rem;
    display: flex;
    align-items: center;
    line-height: 1;
    border-radius: 3px;
  }

  .copy-secret-btn:hover {
    color: var(--color-text);
    background: var(--color-border);
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .secret-toggle {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0.35rem 0.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    min-height: 36px;
  }

  .secret-toggle:hover {
    color: var(--color-text);
  }

  .secret-toggle.active {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: #fff;
  }

  .chat-input {
    flex: 1;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: inherit;
    /* iOS zooms the page when a focused input has font-size < 16px.
       Keep at 1rem (16px) to prevent that. */
    font-size: 1rem;
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
    padding: 0.45rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    flex-shrink: 0;
    min-height: 36px;
    font-family: inherit;
    font-size: 0.85rem;
  }

  .send-label {
    font-size: 0.8rem;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .send-btn:not(:disabled):hover {
    opacity: 0.85;
  }
</style>
