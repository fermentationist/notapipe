<script lang="ts">
  import * as Y from "yjs";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { generateId, generatePassphrase, parseId, isValidId, geoId } from "./id/generate.ts";
  import { GEO_GRID_PRECISION } from "$lib/constants/id.ts";
  import { DOC_DB_PREFIX, GEO_PASSPHRASE_PREFIX, PERSISTENCE_ENABLED_KEY } from "$lib/constants/storage.ts";
  import { ICE_SERVERS } from "$lib/constants/rtc.ts";
  import { IndexeddbPersistence } from "y-indexeddb";
  import { RTCPeerManager, isOfferer } from "./rtc/peer.ts";
  import {
    WebSocketTransport,
    type WebSocketTransportCallbacks,
  } from "./rtc/websocket_transport.ts";
  import { QrTransport } from "./rtc/qr_mode/qr_transport.ts";
  import { RTCDataChannelProvider } from "./yjs/provider.ts";
  import { connection_store } from "./stores/connection.ts";
  import { focus_mode_store } from "./stores/focus_mode.ts";
  import { persistence_store } from "./stores/persistence.ts";
  import Editor from "./components/Editor.svelte";
  import ConnectionStatus from "./components/ConnectionStatus.svelte";
  import QrOverlay from "./components/QrOverlay.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import ConfirmDialog from "./components/ConfirmDialog.svelte";

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
  let show_find_room_menu = $state(false);
  let show_cleanup_menu = $state(false);
  let cleanup_menu_anchor = $state<{ top: number; right: number } | null>(null);
  let confirm_dialog = $state<{ message: string; onconfirm: () => void } | null>(null);

  // ---------------------------------------------------------------------------
  // Persistence (y-indexeddb)
  // ---------------------------------------------------------------------------

  let idb_persistence: IndexeddbPersistence | null = null;

  function reinitPersistence(): void {
    idb_persistence?.destroy();
    idb_persistence = null;
    if ($persistence_store && room_id !== "") {
      idb_persistence = new IndexeddbPersistence(`${DOC_DB_PREFIX}${room_id}`, doc);
    }
  }

  // ---------------------------------------------------------------------------
  // Geo mode state
  // ---------------------------------------------------------------------------

  let geo_mode = $state(false);
  let geo_coords = $state<{ latitude: number; longitude: number } | null>(null);
  let geo_passphrase = $state<string>("");

  function geoPassphraseKey(coords: { latitude: number; longitude: number }): string {
    const lat = Math.round(coords.latitude / GEO_GRID_PRECISION);
    const lon = Math.round(coords.longitude / GEO_GRID_PRECISION);
    return `${GEO_PASSPHRASE_PREFIX}${lat},${lon}`;
  }

  function loadGeoPassphrase(coords: { latitude: number; longitude: number }): string | null {
    return localStorage.getItem(geoPassphraseKey(coords));
  }

  function saveGeoPassphrase(coords: { latitude: number; longitude: number }, passphrase: string): void {
    localStorage.setItem(geoPassphraseKey(coords), passphrase);
  }

  async function applyGeoRoomId(): Promise<void> {
    if (geo_coords === null) { return; }
    const new_id = await geoId(geo_coords, geo_passphrase);
    room_id = new_id;
    history.replaceState(null, "", `/${new_id}`);
    connection_store.setRoomId(new_id);
    reinitPersistence();
  }

  // ---------------------------------------------------------------------------
  // Runtime references (not reactive — managed imperatively)
  // ---------------------------------------------------------------------------

  // Keyed by remote peer ID. QR mode uses QR_PEER_ID as a placeholder.
  const peer_managers = new Map<string, RTCPeerManager>();
  const yjs_providers = new Map<string, RTCDataChannelProvider>();
  const peer_states = new Map<string, import("./rtc/peer.ts").PeerManagerState>();

  const QR_PEER_ID = "qr-peer";

  let ws_transport: WebSocketTransport | null = null;
  let qr_transport: QrTransport | null = null;
  let qr_packet = $state<Uint8Array | null>(null);

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
    reinitPersistence();

    const unsubscribe_persistence = persistence_store.subscribe(() => {
      reinitPersistence();
    });

    // Focus mode keyboard shortcuts
    const handle_keydown = (event: KeyboardEvent): void => {
      if (event.key === "f" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        focus_mode_store.toggle();
        return;
      }
      if (event.key === "Escape" && get(focus_mode_store)) {
        focus_mode_store.disable();
      }
    };
    window.addEventListener("keydown", handle_keydown);
    return () => {
      window.removeEventListener("keydown", handle_keydown);
      unsubscribe_persistence();
      idb_persistence?.destroy();
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

  // ---------------------------------------------------------------------------
  // Peer state aggregation
  // ---------------------------------------------------------------------------

  function updateAggregateState(): void {
    if (peer_states.size === 0) {
      connection_store.setPeerState("idle");
      return;
    }
    const states = Array.from(peer_states.values());
    if (states.some((s) => s === "connected")) {
      connection_store.setPeerState("connected");
    } else if (states.some((s) => s === "connecting")) {
      connection_store.setPeerState("connecting");
    } else if (states.some((s) => s === "failed")) {
      connection_store.setPeerState("failed");
    } else {
      connection_store.setPeerState("disconnected");
    }
  }

  /**
   * Disconnect and clean up a single peer. Safe to call when already disconnected
   * (guards against re-entry via onStateChange callbacks).
   */
  function disconnectPeer(remote_peer_id: string): void {
    if (!peer_managers.has(remote_peer_id)) {
      return;
    }
    const manager = peer_managers.get(remote_peer_id)!;
    // Delete first to prevent re-entry from the "closed" onStateChange fired by manager.close()
    peer_managers.delete(remote_peer_id);
    peer_states.delete(remote_peer_id);
    yjs_providers.get(remote_peer_id)?.destroy();
    yjs_providers.delete(remote_peer_id);
    connection_store.removeRemotePeer(remote_peer_id);
    manager.close();
    updateAggregateState();
  }

  /**
   * Start a WebRTC connection to a specific remote peer via the signalling transport.
   * Each peer gets its own PerPeerChannel so their signals don't interfere.
   */
  function startWebRtc(remote_peer_id: string): void {
    if (ws_transport === null) {
      return;
    }
    const channel = ws_transport.createPeerChannel(remote_peer_id);
    // Track whether this peer ever reached "connected" so we know whether
    // a subsequent "disconnected" is a drop (clean up) or an ICE transient (ignore).
    let was_ever_connected = false;
    const manager = new RTCPeerManager(channel, {
      onDataChannel(data_channel) {
        const provider = new RTCDataChannelProvider(doc, data_channel);
        yjs_providers.set(remote_peer_id, provider);
      },
      onStateChange(state) {
        if (!peer_managers.has(remote_peer_id)) {
          return; // already being cleaned up
        }
        peer_states.set(remote_peer_id, state);
        if (state === "connected") {
          was_ever_connected = true;
          connection_store.addRemotePeer(remote_peer_id);
        }
        // Only auto-disconnect on "failed" (terminal ICE failure) or on
        // "disconnected" after the connection was previously established.
        // Ignoring "disconnected" during initial negotiation avoids spurious
        // teardowns caused by transient ICE states.
        if (state === "failed" || (state === "disconnected" && was_ever_connected)) {
          disconnectPeer(remote_peer_id);
        }
        updateAggregateState();
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    });

    peer_managers.set(remote_peer_id, manager);
    peer_states.set(remote_peer_id, "connecting");
    updateAggregateState();

    if (isOfferer(local_peer_id, remote_peer_id)) {
      manager.startAsOfferer();
    } else {
      manager.startAsAnswerer();
    }
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
          teardown();
        }
      },
      onPeerJoined(remote_id) {
        startWebRtc(remote_id);
      },
      onPeerLeft(remote_id) {
        disconnectPeer(remote_id);
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

    // Create the RTCPeerConnection up-front so both QrTransport and RTCPeerManager
    // share the same instance. QrTransport must monitor ICE gathering on the exact
    // PC that drives the offer/answer exchange — if they were separate objects,
    // localDescription on the QrTransport's PC would always be null.
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    qr_transport = new QrTransport(pc, {
      onQrPacketReady(packet) {
        qr_packet = packet;
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    });

    // QR mode: always offerer — the answerer scans and responds.
    // Uses QR_PEER_ID as a placeholder since there is no signalling-server peer ID.
    // Pass `pc` so RTCPeerManager reuses the same instance that QrTransport monitors.
    const qr_peer_manager = new RTCPeerManager(qr_transport, {
      onDataChannel(data_channel) {
        const provider = new RTCDataChannelProvider(doc, data_channel);
        yjs_providers.set(QR_PEER_ID, provider);
      },
      onStateChange(state) {
        if (!peer_managers.has(QR_PEER_ID)) {
          return;
        }
        peer_states.set(QR_PEER_ID, state);
        if (state === "connected") {
          connection_store.addRemotePeer(QR_PEER_ID);
          show_qr_overlay = false;
        }
        if (state === "disconnected" || state === "failed") {
          disconnectPeer(QR_PEER_ID);
        }
        updateAggregateState();
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    }, pc);

    peer_managers.set(QR_PEER_ID, qr_peer_manager);
    peer_states.set(QR_PEER_ID, "connecting");
    show_qr_overlay = true;
    connection_store.setMode("qr");
    updateAggregateState();
    // Role selection is deferred — user picks "Show my QR" or "Scan first" in the overlay.
  }

  function startQrAsOfferer(): void {
    const manager = peer_managers.get(QR_PEER_ID);
    manager?.startAsOfferer();
  }

  function startQrAsAnswerer(): void {
    const manager = peer_managers.get(QR_PEER_ID);
    manager?.startAsAnswerer();
  }

  function handleQrScanned(scanned_packet: Uint8Array): void {
    qr_transport?.receiveScannedPacket(scanned_packet);
    // Do not close the overlay here — the answerer needs to stay open to show their
    // answer QR. The overlay closes itself after the scan step is handled, or when
    // the connection reaches "connected" state (handled in onStateChange above).
  }

  function closeQrOverlay(): void {
    show_qr_overlay = false;
    if ($connection_store.peer_state !== "connected") {
      teardown();
    }
  }

  function teardown(): void {
    Array.from(peer_managers.keys()).forEach((id) => disconnectPeer(id));
    ws_transport?.close();
    ws_transport = null;
    qr_transport = null;
    qr_packet = null;
    connection_store.setMode("none");
    connection_store.setPeerState("idle");
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

  async function regeneratePassphrase(): Promise<void> {
    geo_passphrase = generatePassphrase();
    if (geo_coords !== null) { saveGeoPassphrase(geo_coords, geo_passphrase); }
    await applyGeoRoomId();
  }

  function selectRandom(): void {
    show_find_room_menu = false;
    geo_mode = false;
    geo_coords = null;
    geo_passphrase = "";
    teardown();
    const new_room_id = generateId();
    room_id = new_room_id;
    history.replaceState(null, "", `/${new_room_id}`);
    connection_store.setRoomId(new_room_id);
    reinitPersistence();
  }

  function selectNearby(): void {
    show_find_room_menu = false;
    teardown();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        geo_coords = coords;
        geo_passphrase = loadGeoPassphrase(coords) ?? generatePassphrase();
        saveGeoPassphrase(coords, geo_passphrase);
        geo_mode = true;
        applyGeoRoomId();
      },
      (error) => {
        connection_store.setError(`Location unavailable: ${error.message}`);
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function selectSignalling(): void {
    show_connect_menu = false;
    connectViaSignalling();
  }

  function selectQr(): void {
    show_connect_menu = false;
    connectViaQr();
  }

  // ---------------------------------------------------------------------------
  // Cleanup / data management
  // ---------------------------------------------------------------------------

  function showConfirm(message: string, onconfirm: () => void): void {
    confirm_dialog = { message, onconfirm };
  }

  function clearCurrentDoc(): void {
    doc.transact(() => {
      if (ytext.length > 0) { ytext.delete(0, ytext.length); }
    });
    if (idb_persistence !== null) {
      idb_persistence.clearData();
    } else {
      indexedDB.deleteDatabase(`${DOC_DB_PREFIX}${room_id}`);
    }
  }

  async function clearAllDocs(): Promise<void> {
    doc.transact(() => {
      if (ytext.length > 0) { ytext.delete(0, ytext.length); }
    });
    const databases = await indexedDB.databases();
    databases
      .filter((db) => db.name?.startsWith(DOC_DB_PREFIX))
      .forEach((db) => { indexedDB.deleteDatabase(db.name!); });
  }

  function clearSettings(): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("notapipe:"))
      .forEach((key) => { localStorage.removeItem(key); });
    persistence_store.disable();
    idb_persistence?.destroy();
    idb_persistence = null;
  }

  async function clearEverything(): Promise<void> {
    await clearAllDocs();
    clearSettings();
  }

  function handleWindowClick(event: MouseEvent): void {
    const target = event.target as Element;
    if (show_connect_menu && !target.closest(".connect-wrapper")) {
      show_connect_menu = false;
    }
    if (show_find_room_menu && !target.closest(".find-room-wrapper")) {
      show_find_room_menu = false;
    }
    if (show_cleanup_menu && !target.closest(".cleanup-wrapper")) {
      show_cleanup_menu = false;
    }
  }

  const can_share = $derived(typeof navigator !== "undefined" && "share" in navigator);
  const is_connected = $derived($connection_store.peer_state === "connected");
  const show_actions = $derived(!$focus_mode_store);
</script>

<svelte:window onclick={handleWindowClick} />

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
        {#if $persistence_store}
          <span class="persist-indicator" title="localStorage persistence is on" aria-label="Persistence active">●</span>
        {/if}
        <button class="icon-btn" onclick={exportDocument} title="Export document" aria-label="Export">↓</button>
        {#if can_share}
          <button class="icon-btn" onclick={shareDocument} title="Share document" aria-label="Share">↑</button>
        {/if}
        <div class="cleanup-wrapper">
          <button
            class="icon-btn"
            onclick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              cleanup_menu_anchor = { top: rect.bottom + 4, right: window.innerWidth - rect.right };
              show_cleanup_menu = !show_cleanup_menu;
              if (!show_cleanup_menu) { cleanup_menu_anchor = null; }
            }}
            title="Clear data"
            aria-label="Clear data"
            aria-haspopup="menu"
            aria-expanded={show_cleanup_menu}
          >⊗</button>
        </div>
        <button class="icon-btn" onclick={() => { show_settings = !show_settings; }} title="Settings" aria-label="Settings">⚙</button>
      </div>
    </header>

    <div class="room-bar">
      <span class="room-id">{room_id}</span>
      <button class="copy-btn" onclick={copyRoomUrl} title="Copy room URL" aria-label="Copy room link">📋</button>
      <div class="find-room-wrapper">
        <button
          class="find-room-btn"
          onclick={() => { show_find_room_menu = !show_find_room_menu; }}
          aria-haspopup="menu"
          aria-expanded={show_find_room_menu}
        >
          Find a room ▾
        </button>
        {#if show_find_room_menu}
          <div class="connect-menu" role="menu">
            <button class="menu-item" role="menuitem" onclick={selectNearby}>
              Nearby
            </button>
            <button class="menu-item" role="menuitem" onclick={selectRandom}>
              Random
            </button>
          </div>
        {/if}
      </div>
    </div>

    {#if geo_mode}
      <div class="passphrase-bar">
        <span class="passphrase-label">📍 passphrase</span>
        <input
          class="passphrase-input"
          type="text"
          value={geo_passphrase}
          oninput={(e) => {
            geo_passphrase = (e.target as HTMLInputElement).value.toLowerCase();
            if (geo_coords !== null) { saveGeoPassphrase(geo_coords, geo_passphrase); }
            applyGeoRoomId();
          }}
          aria-label="Geo mode passphrase"
          spellcheck="false"
          autocomplete="off"
        />
        <button class="passphrase-regen-btn" onclick={regeneratePassphrase} title="Generate new passphrase" aria-label="Regenerate passphrase">↺</button>
      </div>
    {/if}
  {/if}

  <!-- Editor -->
  <main>
    <Editor {doc} {ytext} readonly={false} />
    <button
      class="focus-toggle-btn"
      onclick={() => focus_mode_store.toggle()}
      title={$focus_mode_store ? "Exit focus mode" : "Enter focus mode"}
      aria-label={$focus_mode_store ? "Exit focus mode" : "Enter focus mode"}
    >
      {$focus_mode_store ? "✕" : "⛶"}
    </button>
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
      onstartofferer={startQrAsOfferer}
      onstartanswerer={startQrAsAnswerer}
    />
  {/if}

  {#if show_settings}
    <SettingsPanel onclose={() => { show_settings = false; }} />
  {/if}

  {#if show_cleanup_menu && cleanup_menu_anchor !== null}
    <div
      class="connect-menu"
      role="menu"
      style="position: fixed; top: {cleanup_menu_anchor.top}px; right: {cleanup_menu_anchor.right}px; z-index: 200; left: auto; bottom: auto; min-width: auto; white-space: nowrap;"
    >
      <button class="menu-item" role="menuitem" onclick={() => {
        show_cleanup_menu = false;
        showConfirm("Clear the current document? This cannot be undone.", clearCurrentDoc);
      }}>Clear current doc</button>
      <button class="menu-item" role="menuitem" onclick={() => {
        show_cleanup_menu = false;
        showConfirm("Clear all saved documents? This cannot be undone.", clearAllDocs);
      }}>Clear all docs</button>
      <button class="menu-item" role="menuitem" onclick={() => {
        show_cleanup_menu = false;
        showConfirm("Clear all notapipe settings (theme, persistence, geo passphrases)?", clearSettings);
      }}>Clear settings</button>
      <button class="menu-item menu-item-danger" role="menuitem" onclick={() => {
        show_cleanup_menu = false;
        showConfirm("Clear everything — all documents and settings? This cannot be undone.", clearEverything);
      }}>Clear everything</button>
    </div>
  {/if}

  {#if confirm_dialog !== null}
    <ConfirmDialog
      message={confirm_dialog.message}
      onconfirm={() => { confirm_dialog?.onconfirm(); confirm_dialog = null; }}
      oncancel={() => { confirm_dialog = null; }}
    />
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
    position: relative;
    z-index: 50;
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
    position: relative;
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

  .passphrase-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 1rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
  }

  .passphrase-label {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .passphrase-input {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-accent);
    font-family: inherit;
    font-size: 0.85rem;
    padding: 0.1rem 0.25rem;
    outline: none;
    min-width: 0;
  }

  .passphrase-input:focus {
    border-bottom-color: var(--color-accent);
  }

  .passphrase-regen-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.1rem 0.25rem;
    line-height: 1;
  }

  .passphrase-regen-btn:hover {
    color: var(--color-text);
  }

  .find-room-wrapper {
    position: relative;
    margin-left: auto;
  }

  .find-room-btn {
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }

  .find-room-btn:hover {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  .persist-indicator {
    font-size: 0.5rem;
    color: var(--color-accent);
    opacity: 0.7;
    align-self: center;
  }

  .cleanup-wrapper {
    position: relative;
  }

.menu-item-danger {
    color: var(--color-status-error);
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
    position: relative;
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

  .find-room-wrapper .connect-menu {
    bottom: auto;
    top: calc(100% + 4px);
    right: 0;
    left: auto;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
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

  /* Focus mode: full-page cream background, no chrome */
  :global(.focus-mode) {
    background-color: var(--color-focus-bg);
  }

  .focus-toggle-btn {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text-muted);
    font-size: 1.1rem;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.4;
    transition: opacity 0.15s;
    z-index: 10;
  }

  .focus-toggle-btn:hover {
    opacity: 1;
  }

  :global(.focus-mode) .focus-toggle-btn {
    border-color: var(--color-focus-rule);
    color: var(--color-focus-rule);
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
