<script lang="ts">
  import { persistence_store } from "../stores/persistence.ts";
  import { chat_persistence_store } from "../stores/chat_persistence.ts";
  import { rtc_config_store, RTC_CONFIG_DEFAULTS } from "../stores/rtc_config.ts";
  import { auto_connect_store } from "../stores/auto_connect.ts";

  interface Props {
    onclose: () => void;
    initial_section?: "storage" | "connection";
  }

  let { onclose, initial_section = "storage" }: Props = $props();

  // Snapshot the current CSS variable values so the input styles don't shift
  // when the user live-edits tokens like --color-bg or --color-text.
  const root_style = getComputedStyle(document.documentElement);
  const frozen_input_bg = root_style.getPropertyValue("--color-bg").trim() || "#ffffff";
  const frozen_input_text = root_style.getPropertyValue("--color-text").trim() || "#000000";
  const frozen_input_border = root_style.getPropertyValue("--color-border").trim() || "#cccccc";
  const frozen_input_style = `background:${frozen_input_bg};color:${frozen_input_text};border-color:${frozen_input_border};`;

  type SectionTab = "storage" | "connection";

  let active_section = $state<SectionTab>(initial_section);

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { onclose(); }
  }

  function isConnectionModified(config: typeof $rtc_config_store): boolean {
    return (
      config.signal_url !== RTC_CONFIG_DEFAULTS.signal_url ||
      config.turn_url !== RTC_CONFIG_DEFAULTS.turn_url ||
      config.turn_username !== RTC_CONFIG_DEFAULTS.turn_username ||
      config.turn_credential !== RTC_CONFIG_DEFAULTS.turn_credential
    );
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { onclose(); } }}
>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Settings">
    <button class="close-btn" onclick={onclose} aria-label="Close settings">✕</button>
    <h2>Settings</h2>

    <div class="section-tabs" role="tablist">
      <button
        class="section-tab"
        class:active={active_section === "storage"}
        role="tab"
        aria-selected={active_section === "storage"}
        onclick={() => { active_section = "storage"; }}
      >Storage</button>
      <button
        class="section-tab"
        class:active={active_section === "connection"}
        role="tab"
        aria-selected={active_section === "connection"}
        onclick={() => { active_section = "connection"; }}
      >Connection</button>
    </div>

    <div class="section-content">
      {#if active_section === "storage"}
        <label class="toggle-label">
          <input
            type="checkbox"
            checked={$persistence_store}
            onchange={() => { $persistence_store ? persistence_store.disable() : persistence_store.enable(); }}
          />
          <span>Save document</span>
        </label>
        <p class="note">
          Stores document content in your browser's IndexedDB. Content <strong>survives tab close and browser restart</strong> — it is no longer ephemeral. Never sent to a server. Off by default.
        </p>

        <label class="toggle-label">
          <input
            type="checkbox"
            checked={$chat_persistence_store}
            onchange={() => { $chat_persistence_store ? chat_persistence_store.disable() : chat_persistence_store.enable(); }}
          />
          <span>Save chat log</span>
        </label>
        <p class="note">
          Stores chat history in localStorage per room ID — never sent to a server. Off by default.
        </p>

      {:else}
        <label class="toggle-label">
          <input
            type="checkbox"
            checked={$auto_connect_store}
            onchange={() => { $auto_connect_store ? auto_connect_store.disable() : auto_connect_store.enable(); }}
          />
          <span>Auto-connect on launch</span>
        </label>
        <p class="note">
          Automatically connects via the signalling server when the app opens. Useful when notapipe is installed as a PWA on two machines set to the same room. Off by default.
        </p>

        <p class="note">
          Override the signalling server or configure a TURN relay. Changes take effect on the next connection attempt.
        </p>
        <p class="note">
          notapipe uses STUN by default — connections are direct, peer-to-peer. If a direct connection fails (restrictive firewall or symmetric NAT), you can add a <strong>TURN server</strong> to relay traffic. The relay cannot decrypt your content (DTLS encryption), but it is in the network path and can observe packet sizes and timing. File transfers on relayed connections are limited to 5 MB; configuring your own TURN server removes this limit.
        </p>

        <label class="field-label" for="signal-url">Signalling server URL</label>
        <input
          id="signal-url"
          class="text-input"
          type="url"
          placeholder="wss://your-signal-server.example.com/ws"
          value={$rtc_config_store.signal_url}
          oninput={(e) => rtc_config_store.setField("signal_url", (e.target as HTMLInputElement).value.trim())}
        />

        <label class="field-label" for="turn-url">TURN server URL</label>
        <input
          id="turn-url"
          class="text-input"
          type="text"
          value={$rtc_config_store.turn_url}
          oninput={(e) => rtc_config_store.setField("turn_url", (e.target as HTMLInputElement).value.trim())}
        />

        <label class="field-label" for="turn-username">TURN username</label>
        <input
          id="turn-username"
          class="text-input"
          type="text"
          value={$rtc_config_store.turn_username}
          oninput={(e) => rtc_config_store.setField("turn_username", (e.target as HTMLInputElement).value)}
        />

        <label class="field-label" for="turn-credential">TURN credential</label>
        <input
          id="turn-credential"
          class="text-input"
          type="password"
          value={$rtc_config_store.turn_credential}
          oninput={(e) => rtc_config_store.setField("turn_credential", (e.target as HTMLInputElement).value)}
        />

        <p class="security-note">
          ⚠ Credentials are stored unencrypted in localStorage. Use rate-limited keys where possible and never enter credentials you use elsewhere.
        </p>

        {#if isConnectionModified($rtc_config_store)}
          <button class="reset-btn" onclick={() => rtc_config_store.reset()}>
            Reset to defaults
          </button>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    z-index: 100;
    padding: 3.5rem 1rem 1rem;
  }

  .panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    padding: 1.5rem;
    width: min(90vw, 360px);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: calc(100vh - 5rem);
    overflow: hidden;
  }

  .close-btn {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
  }

  /* Outer section tabs */
  .section-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .section-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: 0.85rem;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    margin-bottom: -1px;
    border-radius: 3px 3px 0 0;
  }

  .section-tab.active {
    color: var(--color-text);
    border-bottom-color: var(--color-accent);
  }

  .section-tab:hover:not(.active) {
    color: var(--color-text);
  }

  .section-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding-right: 2px;
  }

  .note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .field-label {
    display: block;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin: 0.6rem 0 0.2rem;
  }

  .text-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0.3rem 0.5rem;
  }

  .text-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  .field-note {
    margin: 0;
    font-size: 0.72rem;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .security-note {
    margin: 0.6rem 0 0;
    font-size: 0.72rem;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .reset-btn {
    margin-top: 0.6rem;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }

  .reset-btn:hover {
    border-color: var(--color-text-muted);
    color: var(--color-text);
  }

  .token-input {
    width: 80px;
    font-size: 0.72rem;
    font-family: "IBM Plex Mono", monospace;
    border: 1px solid;
    border-radius: 3px;
    padding: 2px 4px;
  }

  .token-input:focus {
    outline: 1px solid var(--color-accent);
    border-color: var(--color-accent);
  }
</style>
