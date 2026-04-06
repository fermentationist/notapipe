<script lang="ts">
  import * as Y from "yjs";
  import { onMount } from "svelte";
  import { generateId, parseId, isValidId } from "./id/generate.ts";
  import { RTCPeerManager, isOfferer } from "./rtc/peer.ts";
  import {
    WebSocketTransport,
    type WebSocketTransportCallbacks,
  } from "./rtc/websocket_transport.ts";
  import { QrTransport } from "./rtc/qr_mode/qr_transport.ts";
  import { RTCDataChannelProvider } from "./yjs/provider.ts";
  import { connection_store } from "./stores/connection.ts";
  import { focus_mode_store } from "./stores/focus_mode.ts";
  import Editor from "./components/Editor.svelte";
  import ConnectionStatus from "./components/ConnectionStatus.svelte";
  import QrOverlay from "./components/QrOverlay.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";

  // ---------------------------------------------------------------------------
  // Yjs document (single shared text type)
  // ---------------------------------------------------------------------------

  const doc = new Y.Doc();
  const ytext = doc.getText("content");

  // ---------------------------------------------------------------------------
  // Room ID — parse from URL or generate fresh, then push to history
  // ---------------------------------------------------------------------------

  let room_id = $state<string>("");
  let local_peer_id = $state<string>(crypto.randomUUID());

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------

  let show_qr_overlay = $state(false);
  let show_settings = $state(false);
  let show_connect_menu = $state(false);
  let qr_packet = $state<Uint8Array | null>(null);

  // ---------------------------------------------------------------------------
  // Runtime references (not reactive — managed imperatively)
  // ---------------------------------------------------------------------------

  let peer_manager: RTCPeerManager | null = null;
  let ws_transport: WebSocketTransport | null = null;
  let qr_transport: QrTransport | null = null;
  let yjs_provider: RTCDataChannelProvider | null = null;

  // ---------------------------------------------------------------------------
  // Initialise room ID on mount
  // ---------------------------------------------------------------------------

  onMount(() => {
    const parsed = parseId();
    if (parsed !== null && isValidId(parsed)) {
      room_id = parsed;
    } else {
      room_id = generateId();
      history.replaceState(null, "", `/${room_id}`);
    }
    connection_store.setRoomId(room_id);

    // Focus mode keyboard shortcut: 'F' when textarea is not focused
    const handle_keydown = (event: KeyboardEvent): void => {
      if (
        event.key === "f" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        focus_mode_store.toggle();
      }
    };
    window.addEventListener("keydown", handle_keydown);
    return () => {
      window.removeEventListener("keydown", handle_keydown);
      teardown();
    };
  });

  // ---------------------------------------------------------------------------
  // Connection actions
  // ---------------------------------------------------------------------------

  function copyRoomUrl(): void {
    navigator.clipboard.writeText(window.location.href).catch(() => {
      // Clipboard not available — fail silently
    });
  }

  function connectViaSignalling(): void {
    teardown(); // clean up any prior attempt before starting a new one

    const ws_protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const signal_url = import.meta.env["VITE_SIGNAL_URL"] as string | undefined
      ?? `${ws_protocol}://${window.location.host}/ws`;

    const callbacks: WebSocketTransportCallbacks = {
      onStateChange(state) {
        connection_store.setMode("signalling");
        if (state === "room-full") {
          connection_store.setError("Room is full — try a different room ID");
        } else if (state === "rate-limited") {
          connection_store.setError("Too many connection attempts — try again later");
        } else if (state === "disconnected") {
          connection_store.setPeerState("disconnected");
        }
      },
      onPeerJoined(remote_id) {
        connection_store.setRemotePeer(remote_id);
        startWebRtc(remote_id, ws_transport!);
      },
      onPeerLeft(_remote_id) {
        connection_store.setRemotePeer(null);
        connection_store.setPeerState("disconnected");
        teardown();
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    };

    ws_transport = new WebSocketTransport(signal_url, room_id, local_peer_id, callbacks);
    ws_transport.connect();
    connection_store.setMode("signalling");
    connection_store.setPeerState("connecting");
  }

  function connectViaQr(): void {
    teardown(); // clean up any prior attempt before starting a new one

    // Create a bare RTCPeerConnection for the QrTransport to monitor ICE gathering
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    qr_transport = new QrTransport(pc, {
      onQrPacketReady(packet) {
        qr_packet = packet;
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    });

    // QR mode: local peer with larger UUID is always offerer (no server coordination)
    // In QR mode we don't know the remote peer ID, so we always start as offerer
    // (the answerer will scan and respond)
    const qr_peer_manager = new RTCPeerManager(qr_transport, {
      onDataChannel(channel) {
        yjs_provider = new RTCDataChannelProvider(doc, channel);
      },
      onStateChange(state) {
        connection_store.setPeerState(state);
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    });

    peer_manager = qr_peer_manager;
    show_qr_overlay = true;
    connection_store.setMode("qr");
    connection_store.setPeerState("connecting");
    qr_peer_manager.startAsOfferer();
  }

  function handleQrScanned(scanned_packet: Uint8Array): void {
    qr_transport?.receiveScannedPacket(scanned_packet);
    show_qr_overlay = false;
  }

  function closeQrOverlay(): void {
    show_qr_overlay = false;
    if ($connection_store.peer_state !== "connected") {
      teardown();
    }
  }

  function startWebRtc(remote_peer_id: string, transport: WebSocketTransport): void {
    const offerer = isOfferer(local_peer_id, remote_peer_id);

    const manager = new RTCPeerManager(transport, {
      onDataChannel(channel) {
        yjs_provider = new RTCDataChannelProvider(doc, channel);
      },
      onStateChange(state) {
        connection_store.setPeerState(state);
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    });

    peer_manager = manager;

    if (offerer) {
      manager.startAsOfferer();
    } else {
      manager.startAsAnswerer();
    }
  }

  function teardown(): void {
    yjs_provider?.destroy();
    yjs_provider = null;
    peer_manager?.close();
    peer_manager = null;
    ws_transport = null;
    qr_transport = null;
    qr_packet = null;
    connection_store.setMode("none");
    connection_store.setPeerState("idle");
    connection_store.setRemotePeer(null);
  }

  // ---------------------------------------------------------------------------
  // Export / share
  // ---------------------------------------------------------------------------

  function exportDocument(): void {
    const content = ytext.toString();
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${room_id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function shareDocument(): Promise<void> {
    const content = ytext.toString();
    const file = new File([content], `${room_id}.txt`, { type: "text/plain" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      exportDocument(); // fall back to download
    }
  }

  function handleDisconnect(): void {
    teardown();
  }

  function selectSignalling(): void {
    show_connect_menu = false;
    connectViaSignalling();
  }

  function selectQr(): void {
    show_connect_menu = false;
    connectViaQr();
  }

  const can_share = $derived(typeof navigator !== "undefined" && "share" in navigator);
  const is_connected = $derived($connection_store.peer_state === "connected");
  const show_actions = $derived(!$focus_mode_store);
</script>

<div class="app" class:focus-mode={$focus_mode_store}>

  <!-- Header (hidden in focus mode) -->
  {#if !$focus_mode_store}
    <header>
      <div class="header-left">
        <span class="app-name">notapipe</span>
      </div>
      <div class="header-center">
        <ConnectionStatus />
      </div>
      <div class="header-right">
        <button class="icon-btn" onclick={exportDocument} title="Export document" aria-label="Export">↓</button>
        {#if can_share}
          <button class="icon-btn" onclick={shareDocument} title="Share document" aria-label="Share">↑</button>
        {/if}
        <button class="icon-btn" onclick={() => { show_settings = !show_settings; }} title="Settings" aria-label="Settings">⚙</button>
      </div>
    </header>

    <div class="room-bar">
      <span class="room-id">{room_id}</span>
      <button class="copy-btn" onclick={copyRoomUrl} title="Copy room URL" aria-label="Copy room link">📋</button>
    </div>
  {/if}

  <!-- Editor -->
  <main>
    <Editor {doc} {ytext} readonly={false} />
  </main>

  <!-- Connection actions (hidden in focus mode) -->
  {#if show_actions}
    <div class="actions">
      {#if is_connected}
        <button class="action-btn" onclick={handleDisconnect}>
          Disconnect
        </button>
      {:else}
        <div class="connect-wrapper">
          <button
            class="action-btn primary"
            onclick={() => { show_connect_menu = !show_connect_menu; }}
            aria-haspopup="menu"
            aria-expanded={show_connect_menu}
          >
            Connect to peer ▾
          </button>
          {#if show_connect_menu}
            <div
              class="menu-backdrop"
              onclick={() => { show_connect_menu = false; }}
              aria-hidden="true"
            ></div>
            <div class="connect-menu" role="menu">
              <button class="menu-item" role="menuitem" onclick={selectSignalling}>
                Use signalling server
              </button>
              <button class="menu-item" role="menuitem" onclick={selectQr}>
                Use QR code (air-gapped)
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Overlays -->
  {#if show_qr_overlay}
    <QrOverlay
      packet={qr_packet}
      onscanned={handleQrScanned}
      onclose={closeQrOverlay}
    />
  {/if}

  {#if show_settings}
    <SettingsPanel onclose={() => { show_settings = false; }} />
  {/if}

</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background-color: var(--color-bg);
    max-width: 800px;
    margin: 0 auto;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-border);
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .header-left {
    flex: 1;
  }

  .header-center {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .header-right {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    gap: 0.25rem;
  }

  .app-name {
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .room-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 1rem;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .room-id {
    font-size: 0.85rem;
    color: var(--color-accent);
  }

  .copy-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0.15rem 0.3rem;
    line-height: 1;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem 0.4rem;
    border-radius: 4px;
    min-width: 32px;
    min-height: 32px;
    line-height: 1;
  }

  .icon-btn:hover {
    color: var(--color-text);
    background: var(--color-surface);
  }

  main {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .action-btn {
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 0.5rem 1rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 44px;
    white-space: nowrap;
  }

  .action-btn.primary {
    background: var(--color-accent);
    color: #fff;
    border-color: var(--color-accent);
  }

  .action-btn:hover:not(:disabled) {
    opacity: 0.85;
  }

  .connect-wrapper {
    position: relative;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .connect-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 11;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    min-width: 100%;
    overflow: hidden;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.08);
  }

  .menu-item {
    background: none;
    border: none;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.85rem;
    padding: 0.6rem 1rem;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }

  .menu-item:hover {
    background: var(--color-surface);
  }

  /* Grain texture in focus mode — SVG noise pseudo-element */
  :global(.focus-mode) .app::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E");
    z-index: 50;
  }
</style>
