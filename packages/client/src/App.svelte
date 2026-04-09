<script lang="ts">
  import * as Y from "yjs";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    generateId,
    generatePassphrase,
    parseId,
    isValidId,
    geoId,
    ensureToken,
    roomPath,
  } from "./id/generate.ts";
  import { GEO_GRID_PRECISION } from "$lib/constants/id.ts";
  import {
    DOC_DB_PREFIX,
    GEO_PASSPHRASE_PREFIX,
    PERSISTENCE_ENABLED_KEY,
  } from "$lib/constants/storage.ts";
  import { ICE_SERVERS, QR_ICE_SERVERS } from "$lib/constants/rtc.ts";
  import { IndexeddbPersistence } from "y-indexeddb";
  import { RTCPeerManager, isOfferer } from "./rtc/peer.ts";
  import {
    WebSocketTransport,
    type WebSocketTransportCallbacks,
  } from "./rtc/websocket_transport.ts";
  import { QrTransport } from "./rtc/qr_mode/qr_transport.ts";
  import { decodePacketMeta } from "./rtc/qr_mode/sdp_codec.ts";
  import { RTCDataChannelProvider } from "./yjs/provider.ts";
  import {
    FileTransferManager,
    type IncomingOffer,
  } from "./rtc/file_transfer.ts";
  import { connection_store } from "./stores/connection.ts";
  import { focus_mode_store } from "./stores/focus_mode.ts";
  import { persistence_store } from "./stores/persistence.ts";
  import Editor from "./components/Editor.svelte";
  import MarkdownPreview from "./components/MarkdownPreview.svelte";
  import ConnectionStatus from "./components/ConnectionStatus.svelte";
  import QrOverlay from "./components/QrOverlay.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import ConfirmDialog from "./components/ConfirmDialog.svelte";
  import FileTransferBar from "./components/FileTransferBar.svelte";
  import InfoModal from "./components/InfoModal.svelte";
  import { preview_store } from "./stores/preview.ts";
  import { wide_mode_store } from "./stores/wide_mode.ts";
  import { theme_store } from "./stores/theme.ts";

  // ---------------------------------------------------------------------------
  // Yjs document (single shared text type)
  // ---------------------------------------------------------------------------

  const doc = new Y.Doc();
  const ytext = doc.getText("content");

  // ---------------------------------------------------------------------------
  // Room ID — parse from URL or generate fresh, then push to history
  // ---------------------------------------------------------------------------

  let room_id = $state<string>("");
  let room_token = $state<string>("");
  let local_peer_id = $state<string>(crypto.randomUUID());

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------

  const desktop_mq = window.matchMedia("(min-width: 768px)");
  let is_desktop = $state(desktop_mq.matches);
  desktop_mq.addEventListener("change", (e) => { is_desktop = e.matches; });

  let show_qr_overlay = $state(false);
  let show_settings = $state(false);
  let show_connect_menu = $state(false);
  let show_find_room_menu = $state(false);
  let show_actions_menu = $state(false);
  let actions_menu_anchor = $state<{ top: number; right: number } | null>(null);
  let show_user_guide = $state(false);
  let user_guide_content = $state<string | null>(null);
  let show_about = $state(false);
  let confirm_dialog = $state<{
    message: string;
    onconfirm: () => void;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Persistence (y-indexeddb)
  // ---------------------------------------------------------------------------

  let idb_persistence: IndexeddbPersistence | null = null;

  function reinitPersistence(): void {
    idb_persistence?.destroy();
    idb_persistence = null;
    if ($persistence_store && room_id !== "") {
      idb_persistence = new IndexeddbPersistence(
        `${DOC_DB_PREFIX}${room_id}`,
        doc,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Geo mode state
  // ---------------------------------------------------------------------------

  let geo_mode = $state(false);
  let geo_coords = $state<{ latitude: number; longitude: number } | null>(null);
  let geo_passphrase = $state<string>("");

  function geoPassphraseKey(coords: {
    latitude: number;
    longitude: number;
  }): string {
    const lat = Math.round(coords.latitude / GEO_GRID_PRECISION);
    const lon = Math.round(coords.longitude / GEO_GRID_PRECISION);
    return `${GEO_PASSPHRASE_PREFIX}${lat},${lon}`;
  }

  function loadGeoPassphrase(coords: {
    latitude: number;
    longitude: number;
  }): string | null {
    return localStorage.getItem(geoPassphraseKey(coords));
  }

  function saveGeoPassphrase(
    coords: { latitude: number; longitude: number },
    passphrase: string,
  ): void {
    localStorage.setItem(geoPassphraseKey(coords), passphrase);
  }

  async function applyGeoRoomId(): Promise<void> {
    if (geo_coords === null) {
      return;
    }
    const new_id = await geoId(geo_coords);
    room_id = new_id;
    room_token = geo_passphrase;
    history.replaceState(null, "", `${roomPath(new_id)}#${geo_passphrase}`);
    connection_store.setRoomId(new_id);
    reinitPersistence();
  }

  // ---------------------------------------------------------------------------
  // Runtime references (not reactive — managed imperatively)
  // ---------------------------------------------------------------------------

  // Keyed by remote peer ID. QR mode uses QR_PEER_ID as a placeholder.
  const peer_managers = new Map<string, RTCPeerManager>();
  const yjs_providers = new Map<string, RTCDataChannelProvider>();
  const file_transfer_managers = new Map<string, FileTransferManager>();
  const peer_states = new Map<
    string,
    import("./rtc/peer.ts").PeerManagerState
  >();

  // ---------------------------------------------------------------------------
  // File transfer UI state (reactive so the bar re-renders)
  // ---------------------------------------------------------------------------

  let ft_incoming_offers = $state(new Map<string, IncomingOffer>());
  let ft_progress = $state(
    new Map<string, { received: number; total: number }>(),
  );
  let ft_completed = $state(
    new Map<string, { url: string; filename: string }>(),
  );

  function makeFileTransferCallbacks(peer_id: string) {
    return {
      onIncomingOffer(offer: IncomingOffer) {
        ft_incoming_offers = new Map(ft_incoming_offers).set(
          offer.transfer_id,
          offer,
        );
      },
      onProgress(transfer_id: string, received: number, total: number) {
        const next = new Map(ft_progress);
        next.set(transfer_id, { received, total });
        ft_progress = next;
        // Remove from incoming once we start receiving chunks
        if (ft_incoming_offers.has(transfer_id)) {
          const offers = new Map(ft_incoming_offers);
          offers.delete(transfer_id);
          ft_incoming_offers = offers;
        }
      },
      onFileReceived(transfer_id: string, blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const progress = new Map(ft_progress);
        progress.delete(transfer_id);
        ft_progress = progress;
        ft_completed = new Map(ft_completed).set(transfer_id, {
          url,
          filename,
        });
      },
      onTransferCancelled(transfer_id: string) {
        const offers = new Map(ft_incoming_offers);
        offers.delete(transfer_id);
        ft_incoming_offers = offers;
        const progress = new Map(ft_progress);
        progress.delete(transfer_id);
        ft_progress = progress;
        void peer_id; // suppress unused warning
      },
      onError(message: string) {
        connection_store.setError(message);
      },
    };
  }

  function acceptTransfer(transfer_id: string): void {
    for (const manager of file_transfer_managers.values()) {
      manager.acceptTransfer(transfer_id);
    }
    const offers = new Map(ft_incoming_offers);
    offers.delete(transfer_id);
    ft_incoming_offers = offers;
  }

  function declineTransfer(transfer_id: string): void {
    for (const manager of file_transfer_managers.values()) {
      manager.declineTransfer(transfer_id);
    }
    const offers = new Map(ft_incoming_offers);
    offers.delete(transfer_id);
    ft_incoming_offers = offers;
  }

  function cancelTransfer(transfer_id: string): void {
    for (const manager of file_transfer_managers.values()) {
      manager.cancelTransfer(transfer_id);
    }
    const progress = new Map(ft_progress);
    progress.delete(transfer_id);
    ft_progress = progress;
  }

  function dismissCompleted(transfer_id: string): void {
    const completed = new Map(ft_completed);
    const entry = completed.get(transfer_id);
    if (entry) {
      URL.revokeObjectURL(entry.url);
    }
    completed.delete(transfer_id);
    ft_completed = completed;
  }

  function sendFileToAllPeers(file: File): void {
    for (const manager of file_transfer_managers.values()) {
      manager.sendFile(file);
    }
  }

  let ws_transport: WebSocketTransport | null = null;
  // Set while signalling is active; cleared in teardown() to prevent auto-reconnect.
  let signalling_url: string | null = null;
  let qr_transport: QrTransport | null = null;
  let qr_packet = $state<Uint8Array | null>(null);
  let active_qr_session_id = $state<string | null>(null);

  // ---------------------------------------------------------------------------
  // Initialise room ID on mount
  // ---------------------------------------------------------------------------

  onMount(() => {
    const parsed = parseId();
    if (parsed !== null && isValidId(parsed)) {
      room_id = parsed;
    } else {
      room_id = generateId();
      history.replaceState(null, "", roomPath(room_id));
    }
    room_token = ensureToken();
    connection_store.setRoomId(room_id);
    reinitPersistence();

    const unsubscribe_persistence = persistence_store.subscribe(() => {
      reinitPersistence();
    });

    // Focus mode keyboard shortcuts
    const handle_keydown = (event: KeyboardEvent): void => {
      if (event.key === "f" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        code_mode = false;
        focus_mode_store.toggle();
        return;
      }
      if (event.key === "Escape" && get(focus_mode_store)) {
        focus_mode_store.disable();
      }
      if (event.key === "Escape" && code_mode) {
        code_mode = false;
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

  let copy_content_feedback = $state(false);

  function copyEditorContent(): void {
    const text = ytext.toString();
    navigator.clipboard
      .writeText(text)
      .then(() => {
        copy_content_feedback = true;
        setTimeout(() => {
          copy_content_feedback = false;
        }, 1500);
      })
      .catch(() => {
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
    file_transfer_managers.get(remote_peer_id)?.destroy();
    file_transfer_managers.delete(remote_peer_id);
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
      onFileChannel(file_channel) {
        const ft_manager = new FileTransferManager(
          file_channel,
          makeFileTransferCallbacks(remote_peer_id),
        );
        file_transfer_managers.set(remote_peer_id, ft_manager);
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
        if (
          state === "failed" ||
          (state === "disconnected" && was_ever_connected)
        ) {
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

  /**
   * Open a new WebSocket to the signalling server and join the room.
   * Does NOT call teardown() — call that separately before connecting fresh.
   * Used both for initial connect and for transparent auto-reconnect.
   */
  function openSignallingSocket(url: string): void {
    const callbacks: WebSocketTransportCallbacks = {
      onStateChange(state) {
        connection_store.setMode("signalling");
        if (state === "room-full") {
          connection_store.setError("Room is full — try a different room ID");
        } else if (state === "rate-limited") {
          connection_store.setError(
            "Too many connection attempts — try again later",
          );
        } else if (state === "disconnected") {
          // If ws_transport is still set, this was an unexpected drop (not our teardown).
          // teardown() clears ws_transport synchronously before the async close event fires.
          if (ws_transport !== null) {
            ws_transport = null; // dead socket — clear reference
            if (signalling_url !== null) {
              // Reconnect transparently after a brief delay
              setTimeout(() => {
                if (signalling_url !== null) {
                  openSignallingSocket(signalling_url);
                }
              }, 2000);
            }
          }
        }
      },
      onPeerJoined(remote_id) {
        startWebRtc(remote_id);
      },
      onPeerLeft(remote_id) {
        disconnectPeer(remote_id);
        // If ws_transport is still alive we're still in the room — stay in "connecting"
        // state so the user sees we're listening, not idle. No action needed on their part.
        if (ws_transport !== null && peer_states.size === 0) {
          connection_store.setPeerState("connecting");
        }
      },
      onError(error) {
        connection_store.setError(error.message);
      },
    };

    ws_transport = new WebSocketTransport(
      url,
      room_id,
      local_peer_id,
      room_token,
      callbacks,
    );
    ws_transport.connect();
  }

  function connectViaSignalling(): void {
    teardown(); // clean up any prior attempt before starting a new one

    const ws_protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url =
      (import.meta.env["VITE_SIGNAL_URL"] as string | undefined) ??
      `${ws_protocol}://${window.location.host}/ws`;

    signalling_url = url;
    openSignallingSocket(url);
    connection_store.setMode("signalling");
    connection_store.setPeerState("connecting");
  }

  function connectViaQr(): void {
    // Do NOT call teardown() — we want to ADD a peer, not replace existing connections.
    // If there's an in-progress QR session that never connected, clean it up first.
    if (
      active_qr_session_id !== null &&
      peer_states.get(active_qr_session_id) !== "connected"
    ) {
      disconnectPeer(active_qr_session_id);
    }

    // Generate a unique ID for this QR pairing session.
    const session_id = `qr-${crypto.randomUUID()}`;
    active_qr_session_id = session_id;
    qr_packet = null;

    // Create the RTCPeerConnection up-front so both QrTransport and RTCPeerManager
    // share the same instance. QrTransport must monitor ICE gathering on the exact
    // PC that drives the offer/answer exchange — if they were separate objects,
    // localDescription on the QrTransport's PC would always be null.
    const pc = new RTCPeerConnection({ iceServers: QR_ICE_SERVERS });

    qr_transport = new QrTransport(
      pc,
      {
        onQrPacketReady(packet) {
          qr_packet = packet;
        },
        onError(error) {
          connection_store.setError(error.message);
        },
      },
      room_id,
      room_token,
    );

    const manager = new RTCPeerManager(
      qr_transport,
      {
        onDataChannel(data_channel) {
          const provider = new RTCDataChannelProvider(doc, data_channel);
          yjs_providers.set(session_id, provider);
        },
        onFileChannel(file_channel) {
          const ft_manager = new FileTransferManager(
            file_channel,
            makeFileTransferCallbacks(session_id),
          );
          file_transfer_managers.set(session_id, ft_manager);
        },
        onStateChange(state) {
          if (!peer_managers.has(session_id)) {
            return;
          }
          peer_states.set(session_id, state);
          if (state === "connected") {
            connection_store.addRemotePeer(session_id);
            show_qr_overlay = false;
          }
          if (state === "disconnected" || state === "failed") {
            disconnectPeer(session_id);
          }
          updateAggregateState();
        },
        onError(error) {
          connection_store.setError(error.message);
        },
      },
      pc,
    );

    peer_managers.set(session_id, manager);
    peer_states.set(session_id, "connecting");
    show_qr_overlay = true;
    // Only switch mode to "qr" if we aren't already connected via another method.
    if (peer_managers.size === 1) {
      connection_store.setMode("qr");
    }
    updateAggregateState();
    // Role selection is deferred — user picks "Show my QR" or "Scan first" in the overlay.
  }

  function startQrAsOfferer(): void {
    if (active_qr_session_id === null) {
      return;
    }
    peer_managers.get(active_qr_session_id)?.startAsOfferer();
  }

  function startQrAsAnswerer(): void {
    if (active_qr_session_id === null) {
      return;
    }
    peer_managers.get(active_qr_session_id)?.startAsAnswerer();
  }

  function applyRoomId(new_room_id: string): void {
    room_id = new_room_id;
    history.replaceState(null, "", `${roomPath(new_room_id)}#${room_token}`);
    connection_store.setRoomId(new_room_id);
    reinitPersistence();
  }

  function applyToken(new_token: string): void {
    room_token = new_token;
    history.replaceState(null, "", `${window.location.pathname}#${new_token}`);
    qr_transport?.setToken(new_token);
  }

  function handleQrScanned(scanned_packet: Uint8Array): void {
    // Extract the room ID and token embedded in the QR packet.
    // The offerer's room ID and token are always authoritative — only adopt them when scanning an offer.
    try {
      const { room_id: incoming_room_id, room_token: incoming_token, is_answer } =
        decodePacketMeta(scanned_packet);
      if (!is_answer) {
        // Always adopt the offerer's token so the answerer's QR carries the matching secret.
        applyToken(incoming_token);

        if (incoming_room_id !== "" && incoming_room_id !== room_id) {
          const has_content = ytext.toString().length > 0;
          const has_persistence = $persistence_store;
          if (has_content || has_persistence) {
            showConfirm(
              `This QR code is for room "${incoming_room_id}". Your room ID will change from "${room_id}". Your current document will merge with theirs.${has_persistence ? " Your saved history for this room will remain under the old ID." : ""}`,
              () => applyRoomId(incoming_room_id),
            );
          } else {
            applyRoomId(incoming_room_id);
          }
        }
      }
    } catch {
      // Malformed packet — let receiveScannedPacket report the error
    }

    qr_transport?.receiveScannedPacket(scanned_packet);
    // Do not close the overlay here — the answerer needs to stay open to show their
    // answer QR. The overlay closes itself after the scan step is handled, or when
    // the connection reaches "connected" state (handled in onStateChange above).
  }

  function closeQrOverlay(): void {
    show_qr_overlay = false;
    qr_packet = null;
    const session_id = active_qr_session_id;
    active_qr_session_id = null;
    qr_transport = null;
    // Only tear down this QR session — leave any other connected peers intact.
    if (session_id !== null && peer_states.get(session_id) !== "connected") {
      disconnectPeer(session_id);
    }
    // If nothing remains, reset to idle.
    if (peer_managers.size === 0) {
      connection_store.setMode("none");
      connection_store.setPeerState("idle");
    }
  }

  function teardown(): void {
    signalling_url = null; // prevent auto-reconnect if WS close event fires after this
    active_qr_session_id = null;
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

  const USER_GUIDE_URL =
    "https://raw.githubusercontent.com/fermentationist/notapipe/main/docs/user-guide.md";

  async function openUserGuide(): Promise<void> {
    show_actions_menu = false;
    show_user_guide = true;
    if (user_guide_content !== null) {
      return;
    }
    try {
      const response = await fetch(USER_GUIDE_URL);
      user_guide_content = await response.text();
    } catch {
      user_guide_content = "_Failed to load user guide. Check your connection or visit [github.com/fermentationist/notapipe](https://github.com/fermentationist/notapipe) directly._";
    }
  }

  const ABOUT_CONTENT = `## About notapipe

notapipe is an ephemeral, local-first, peer-to-peer text sharing tool.

Two people open the same URL — identified by a memorable 3-word phrase — and their text syncs in real time via [Yjs](https://yjs.dev) CRDTs over a WebRTC data channel. **No user text ever touches a server.** The signalling server only relays WebRTC handshake metadata, and even that is eliminated in QR mode.

### Use it for
- Quickly sharing a snippet of text, code, or a link between your own devices
- Collaborating on a note with someone in the same room
- Transferring a password or secret without it passing through any cloud service
- Any time you need a zero-friction, zero-trace scratchpad between two people

### Features
- Real-time sync with no account, no login, no installation
- QR code pairing — no signalling server at all
- Markdown preview
- Syntax-highlighted code editor (14 languages)
- Works offline once loaded (PWA)
- Persistent storage is opt-in and local only

[View source on GitHub](https://github.com/fermentationist/notapipe) · [User Guide](https://github.com/fermentationist/notapipe/blob/main/docs/user-guide.md)

---

© ${new Date().getFullYear()} Dennis Hodges. MIT License.`;

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
    show_actions_menu = false;
    const content = ytext.toString();
    const file = new File([content], `${room_id}.txt`, { type: "text/plain" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      exportDocument(); // fall back to download
    }
  }

  async function shareRoomLink(): Promise<void> {
    show_actions_menu = false;
    const url = window.location.href;
    if (navigator.share !== void 0) {
      await navigator.share({
        url,
        title: "notapipe",
        text: `A notapipe document has been shared with you. After clicking the link, click "Connect" to join the document. \n\nTo learn more about the notapipe project and to view the source code, visit github.com/fermentationist/notapipe`,
      });
    } else {
      await navigator.clipboard.writeText(url);
    }
  }

  function importDocument(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file === undefined) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const current = ytext.toString();
        // Replace entire document content
        doc.transact(() => {
          if (current.length > 0) {
            ytext.delete(0, current.length);
          }
          if (text.length > 0) {
            ytext.insert(0, text);
          }
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleDisconnect(): void {
    teardown();
  }

  async function regeneratePassphrase(): Promise<void> {
    geo_passphrase = generatePassphrase();
    if (geo_coords !== null) {
      saveGeoPassphrase(geo_coords, geo_passphrase);
    }
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
    // Clear the fragment so ensureToken() generates a fresh random token.
    history.replaceState(null, "", roomPath(new_room_id));
    room_token = ensureToken();
    connection_store.setRoomId(new_room_id);
    reinitPersistence();
  }

  function selectNearby(): void {
    show_find_room_menu = false;
    teardown();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        geo_coords = coords;
        geo_passphrase = loadGeoPassphrase(coords) ?? "";
        if (geo_passphrase !== "") {
          saveGeoPassphrase(coords, geo_passphrase);
        }
        geo_mode = true;
        if (geo_passphrase !== "") {
          applyGeoRoomId();
        }
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
      if (ytext.length > 0) {
        ytext.delete(0, ytext.length);
      }
    });
    if (idb_persistence !== null) {
      idb_persistence.clearData();
    } else {
      indexedDB.deleteDatabase(`${DOC_DB_PREFIX}${room_id}`);
    }
  }

  async function clearAllDocs(): Promise<void> {
    doc.transact(() => {
      if (ytext.length > 0) {
        ytext.delete(0, ytext.length);
      }
    });
    const databases = await indexedDB.databases();
    databases
      .filter((db) => db.name?.startsWith(DOC_DB_PREFIX))
      .forEach((db) => {
        indexedDB.deleteDatabase(db.name!);
      });
  }

  function clearSettings(): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("notapipe:"))
      .forEach((key) => {
        localStorage.removeItem(key);
      });
    persistence_store.disable();
    idb_persistence?.destroy();
    idb_persistence = null;
    theme_store.reset();
    wide_mode_store.reset();
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
    if (show_actions_menu && !target.closest(".actions-menu-wrapper")) {
      show_actions_menu = false;
      actions_menu_anchor = null;
    }
  }

  // Reactive text content for markdown preview — tracks ytext changes
  let preview_content = $state(ytext.toString());
  $effect(() => {
    const observer = () => {
      preview_content = ytext.toString();
    };
    ytext.observe(observer);
    // Sync current state in case ytext changed before this effect registered
    // (e.g. IDB persistence loaded between $state init and $effect first run)
    preview_content = ytext.toString();
    return () => ytext.unobserve(observer);
  });

  const can_share = $derived(
    typeof navigator !== "undefined" && "share" in navigator,
  );
  let code_mode = $state(false);
  let code_language = $state("javascript");

  const CODE_LANGUAGES: { value: string; label: string }[] = [
    { value: "javascript", label: "JS" },
    { value: "typescript", label: "TS" },
    { value: "jsx", label: "JSX" },
    { value: "tsx", label: "TSX" },
    { value: "html", label: "HTML" },
    { value: "css", label: "CSS" },
    { value: "json", label: "JSON" },
    { value: "python", label: "Py" },
    { value: "rust", label: "Rust" },
    { value: "bash", label: "Bash" },
    { value: "sql", label: "SQL" },
    { value: "yaml", label: "YAML" },
    { value: "php", label: "PHP" },
    { value: "ruby", label: "Ruby" },
    { value: "text", label: "Text" },
  ];

  const is_connected = $derived($connection_store.peer_state === "connected");
  const show_actions = $derived(!$focus_mode_store && !code_mode);
  // Preview is suppressed in focus mode and code mode
  const show_preview = $derived($preview_store && !$focus_mode_store && !code_mode);
</script>

<svelte:window onclick={handleWindowClick} />

<div
  class="app"
  class:focus-mode={$focus_mode_store}
  class:code-mode={code_mode}
  class:wide={$wide_mode_store}
>
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
          <span
            class="persist-indicator"
            title="localStorage persistence is on"
            aria-label="Persistence active">●</span
          >
        {/if}
        <div class="actions-menu-wrapper">
          <button
            class="icon-btn"
            onclick={(e) => {
              const rect = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              actions_menu_anchor = {
                top: rect.bottom + 4,
                right: window.innerWidth - rect.right,
              };
              show_actions_menu = !show_actions_menu;
              if (!show_actions_menu) {
                actions_menu_anchor = null;
              }
            }}
            title="Actions"
            aria-label="Actions"
            aria-haspopup="menu"
            aria-expanded={show_actions_menu}>···</button
          >
        </div>
        <button
          class="icon-btn"
          onclick={() => {
            show_settings = !show_settings;
          }}
          title="Settings"
          aria-label="Settings">⚙</button
        >
        <input
          id="file-transfer-input"
          type="file"
          style="display:none"
          onchange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
              sendFileToAllPeers(file);
            }
            (e.target as HTMLInputElement).value = "";
          }}
        />
      </div>
    </header>

    <div class="room-bar">
      <span class="room-id">{room_id}</span>
      <button
        class="copy-btn"
        onclick={copyRoomUrl}
        title="Copy room URL"
        aria-label="Copy room link"
      >
        <svg
          width="13"
          height="14"
          viewBox="0 0 13 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="8" height="9" rx="1.5"></rect>
          <path
            d="M2 10H1.5A1.5 1.5 0 0 1 0 8.5v-7A1.5 1.5 0 0 1 1.5 0h7A1.5 1.5 0 0 1 10 1.5V2"
          ></path>
        </svg>
      </button>
      <div class="find-room-wrapper">
        <button
          class="find-room-btn"
          onclick={() => {
            show_find_room_menu = !show_find_room_menu;
          }}
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
          class:passphrase-empty={geo_passphrase === ""}
          type="text"
          value={geo_passphrase}
          placeholder="enter passphrase"
          oninput={(e) => {
            geo_passphrase = (e.target as HTMLInputElement).value.toLowerCase();
            if (geo_passphrase !== "" && geo_coords !== null) {
              saveGeoPassphrase(geo_coords, geo_passphrase);
              applyGeoRoomId();
            }
          }}
          aria-label="Geo mode passphrase"
          spellcheck="false"
          autocomplete="off"
        />
        <button
          class="passphrase-regen-btn"
          onclick={regeneratePassphrase}
          title="Generate new passphrase"
          aria-label="Regenerate passphrase">↺</button
        >
      </div>
    {/if}
  {/if}

  <!-- Editor (+ optional preview pane) -->
  <main class:preview-split={show_preview}>
    <!-- On narrow screens in preview mode, hide the editor; always show on wide or when preview is off -->
    <div class="editor-pane" class:hidden-narrow={show_preview}>
      <Editor {doc} {ytext} readonly={false} {code_mode} language={code_language} />
    </div>
    {#if show_preview}
      <div class="preview-pane">
        <!-- Narrow: toggle button to flip back to editor -->
        <button
          class="preview-back-btn"
          onclick={() => preview_store.toggle()}
          aria-label="Back to editor">← Edit</button
        >
        <MarkdownPreview content={preview_content} />
      </div>
    {/if}
    <FileTransferBar
      connected={is_connected}
      incoming_offers={ft_incoming_offers}
      transfer_progress={ft_progress}
      completed_files={ft_completed}
      onaccept={acceptTransfer}
      ondecline={declineTransfer}
      oncancel={cancelTransfer}
      ondismiss={dismissCompleted}
      onsendfile={sendFileToAllPeers}
    />
    <div class="bottom-right-btns">
      <button
        class="corner-btn"
        onclick={copyEditorContent}
        title="Copy all text to clipboard"
        aria-label="Copy editor content to clipboard"
      >
        {#if copy_content_feedback}
          ✓
        {:else}
          <svg
            width="15"
            height="15"
            viewBox="0 0 13 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="4" width="8" height="9" rx="1.5"></rect>
            <path
              d="M2 10H1.5A1.5 1.5 0 0 1 0 8.5v-7A1.5 1.5 0 0 1 1.5 0h7A1.5 1.5 0 0 1 10 1.5V2"
            ></path>
          </svg>
        {/if}
      </button>
      {#if code_mode}
        <select
          class="lang-select"
          bind:value={code_language}
          aria-label="Syntax highlighting language"
        >
          {#each CODE_LANGUAGES as lang (lang.value)}
            <option value={lang.value}>{lang.label}</option>
          {/each}
        </select>
      {:else}
        <button
          class="corner-btn"
          onclick={() => { focus_mode_store.toggle(); code_mode = false; }}
          title={$focus_mode_store ? "Exit focus mode" : "Enter focus mode"}
          aria-label={$focus_mode_store ? "Exit focus mode" : "Enter focus mode"}
        >
          {$focus_mode_store ? "✕" : "⛶"}
        </button>
      {/if}
      <button
        class="corner-btn"
        class:active={code_mode}
        onclick={() => { code_mode = !code_mode; if (code_mode) { focus_mode_store.disable(); } }}
        title={code_mode ? "Exit code mode" : "Code editor mode"}
        aria-label={code_mode ? "Exit code mode" : "Code editor mode"}
      >
        {code_mode ? "✕" : "</>"}
      </button>
    </div>
  </main>

  <!-- Connection actions (hidden in focus mode) -->
  {#if show_actions}
    <div class="actions">
      {#if is_connected}
        <button class="action-btn" onclick={connectViaQr}>
          Add peer via QR
        </button>
        <button class="action-btn" onclick={handleDisconnect}>
          Disconnect
        </button>
      {:else}
        <div class="connect-wrapper">
          <button
            class="action-btn primary"
            onclick={() => {
              show_connect_menu = !show_connect_menu;
            }}
            aria-haspopup="menu"
            aria-expanded={show_connect_menu}
          >
            Connect to peer ▾
          </button>
          {#if show_connect_menu}
            <div class="connect-menu" role="menu">
              <button
                class="menu-item"
                role="menuitem"
                onclick={selectSignalling}
              >
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
    <SettingsPanel
      onclose={() => {
        show_settings = false;
      }}
    />
  {/if}

  {#if show_actions_menu && actions_menu_anchor !== null}
    <div
      class="connect-menu actions-menu"
      role="menu"
      style="position: fixed; top: {actions_menu_anchor.top}px; right: {actions_menu_anchor.right}px; z-index: 200;"
    >
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          if (ytext.length > 0) {
            showConfirm(
              `Load a file? This will replace the current document${is_connected ? " and sync the change to all connected peers" : ""}.`,
              importDocument,
            );
          } else {
            importDocument();
          }
        }}
      >
        ↑ Load text file
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          exportDocument();
        }}
      >
        ↓ Save as text file
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          preview_store.toggle();
        }}
      >
        M↓ {show_preview ? "Hide preview" : "Markdown preview"}
        {#if show_preview}<span class="menu-check">✓</span>{/if}
      </button>
      {#if is_desktop}
        <button
          class="menu-item"
          role="menuitem"
          onclick={() => {
            show_actions_menu = false;
            wide_mode_store.toggle();
          }}
        >
          ⬌ Wide layout
          {#if $wide_mode_store}<span class="menu-check">✓</span>{/if}
        </button>
      {/if}
      <button
        class="menu-item"
        class:menu-item-disabled={!is_connected}
        role="menuitem"
        onclick={() => {
          if (!is_connected) {
            return;
          }
          show_actions_menu = false;
          (
            document.getElementById("file-transfer-input") as HTMLInputElement
          ).click();
        }}
      >
        ⌂ Send file{!is_connected ? " (not connected)" : ""}
      </button>
      <div class="menu-divider" role="separator"></div>
      <button class="menu-item" role="menuitem" onclick={shareRoomLink}>
        Share room link
      </button>
      {#if can_share}
        <button class="menu-item" role="menuitem" onclick={shareDocument}>
          Share document as file
        </button>
      {/if}
      <div class="menu-divider" role="separator"></div>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          showConfirm(
            "Force reload the page? Any unsynced changes may be lost.",
            () => { window.location.reload(); },
          );
        }}>↺ Force reload</button
      >
      <div class="menu-divider" role="separator"></div>
      <button class="menu-item" role="menuitem" onclick={openUserGuide}>
        User Guide
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          show_about = true;
        }}
      >
        About
      </button>
      <div class="menu-divider" role="separator"></div>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          showConfirm(
            "Clear the current document? This cannot be undone.",
            clearCurrentDoc,
          );
        }}>Clear current doc</button
      >
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          showConfirm(
            "Clear all saved documents? This cannot be undone.",
            clearAllDocs,
          );
        }}>Clear all docs</button
      >
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          showConfirm(
            "Clear all notapipe settings (theme, persistence, geo passphrases)?",
            clearSettings,
          );
        }}>Clear settings</button
      >
      <button
        class="menu-item menu-item-danger"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          showConfirm(
            "Clear everything — all documents and settings? This cannot be undone.",
            clearEverything,
          );
        }}>Clear everything</button
      >
    </div>
  {/if}

  {#if confirm_dialog !== null}
    <ConfirmDialog
      message={confirm_dialog.message}
      onconfirm={() => {
        confirm_dialog?.onconfirm();
        confirm_dialog = null;
      }}
      oncancel={() => {
        confirm_dialog = null;
      }}
    />
  {/if}

  {#if show_user_guide}
    <InfoModal
      title="User Guide"
      content={user_guide_content}
      onclose={() => { show_user_guide = false; }}
    />
  {/if}

  {#if show_about}
    <InfoModal
      title="About notapipe"
      content={ABOUT_CONTENT}
      onclose={() => { show_about = false; }}
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

  @media (min-width: 768px) {
    .app.wide {
      max-width: calc(100vw - 3rem);
    }
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
    padding: 0.15rem 0.3rem;
    line-height: 1;
    color: var(--color-text-muted);
    display: inline-flex;
    align-items: center;
  }

  .copy-btn:hover {
    color: var(--color-text);
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

  .passphrase-input.passphrase-empty {
    border-bottom-color: var(--color-status-error);
  }

  .passphrase-input::placeholder {
    color: var(--color-status-error);
    font-style: italic;
    opacity: 0.8;
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

  .actions-menu-wrapper {
    position: relative;
  }

  /* Overrides the .connect-menu defaults — rendered at app root with fixed positioning */
  .actions-menu {
    position: fixed !important;
    bottom: auto !important;
    left: auto !important;
    min-width: 200px !important;
    z-index: 300 !important;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }

  .menu-divider {
    height: 1px;
    background: var(--color-border);
    margin: 0.25rem 0;
  }

  .menu-check {
    margin-left: auto;
    padding-left: 1rem;
    color: var(--color-accent);
  }

  .menu-item-disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .menu-item-disabled:hover {
    background: none;
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

  .icon-btn:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-surface);
  }

  .icon-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  main {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }

  /* Split-pane layout on wide screens */
  @media (min-width: 768px) {
    main.preview-split {
      flex-direction: row;
    }

    main.preview-split .editor-pane {
      flex: 1;
      min-width: 0;
      border-right: 1px solid var(--color-border);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    main.preview-split .preview-pane {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .preview-back-btn {
      display: none;
    }
  }

  /* Narrow: toggle between editor and preview */
  @media (max-width: 767px) {
    .editor-pane,
    .preview-pane {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
    }

    .editor-pane.hidden-narrow {
      display: none;
    }

    .preview-back-btn {
      flex-shrink: 0;
      background: none;
      border: none;
      border-bottom: 1px solid var(--color-border);
      color: var(--color-accent);
      font-family: inherit;
      font-size: 0.85rem;
      padding: 0.4rem 1rem;
      text-align: left;
      cursor: pointer;
    }

    .preview-back-btn:hover {
      background: var(--color-surface);
    }
  }

  /* Shared pane styles for non-split mode */
  .editor-pane {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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
    display: flex;
    align-items: center;
    width: 100%;
  }

  .menu-item:hover {
    background: var(--color-surface);
  }

  /* Focus mode: full-page cream background, no chrome */
  :global(.focus-mode) {
    background-color: var(--color-focus-bg);
  }

  .bottom-right-btns {
    position: fixed;
    bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
    right: 1.25rem;
    display: flex;
    flex-direction: row;
    gap: 0.5rem;
    z-index: 20;
  }

  .corner-btn {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-muted);
    font-size: 0.8rem;
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.55;
    transition: opacity 0.15s;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    padding: 0;
  }

  .corner-btn:hover {
    opacity: 1;
  }

  .corner-btn.active {
    opacity: 1;
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .lang-select {
    height: 2.5rem;
    padding: 0 0.4rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0.7;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  }

  .lang-select:hover {
    opacity: 1;
  }

  @media (hover: none) {
    .corner-btn {
      opacity: 0.85;
    }
  }

  :global(.focus-mode) .corner-btn {
    background: var(--color-focus-bg);
    border-color: var(--color-focus-rule);
    color: var(--color-focus-text);
    opacity: 0.7;
  }

  :global(.focus-mode) .corner-btn:hover {
    opacity: 1;
  }

  @media (hover: none) {
    :global(.focus-mode) .corner-btn {
      opacity: 0.9;
    }
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
