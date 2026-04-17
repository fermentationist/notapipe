<script lang="ts">
  import * as Y from "yjs";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    generateId,
    parseId,
    isValidId,
    ensureToken,
    roomPath,
  } from "./id/generate.ts";
  import {
    DOC_DB_PREFIX,
    CHAT_LOG_PREFIX,
    LAST_ROOM_KEY,
    SECRET_PLACEHOLDER,
  } from "$lib/constants/storage.ts";
  import { ICE_SERVERS } from "$lib/constants/rtc.ts";
  import { rtc_config_store } from "./stores/rtc_config.ts";
  import { USER_GUIDE_CONTENT, ABOUT_CONTENT } from "$lib/constants/docs.ts";
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
  import { chat_persistence_store } from "./stores/chat_persistence.ts";
  import Editor from "./components/Editor.svelte";
  import MarkdownPreview from "./components/MarkdownPreview.svelte";
  import ConnectionStatus from "./components/ConnectionStatus.svelte";
  import QrOverlay from "./components/QrOverlay.svelte";
  import SettingsPanel from "./components/SettingsPanel.svelte";
  import ConfirmDialog from "./components/ConfirmDialog.svelte";
  import HandleWidget from "./components/HandleWidget.svelte";
  import PeerList from "./components/PeerList.svelte";
  import PeerToastBar, { type PeerToast } from "./components/PeerToastBar.svelte";
  import ChatPanel, { type ChatMessage } from "./components/ChatPanel.svelte";
  import InfoModal from "./components/InfoModal.svelte";
  import UrlQrModal from "./components/UrlQrModal.svelte";
  import CommandPalette, { type PaletteCommand } from "./components/CommandPalette.svelte";
  import FileTransferBar, { type PeerEntry as FtPeerEntry } from "./components/FileTransferBar.svelte";
  import ThemePanel from "./components/ThemePanel.svelte";
  import CopyIcon from "./components/CopyIcon.svelte";
  import UserIcon from "./components/UserIcon.svelte";
  import HardDriveIcon from "./components/HardDriveIcon.svelte";
  import SunIcon from "./components/SunIcon.svelte";
  import MoonIcon from "./components/MoonIcon.svelte";
  import QrCodeIcon from "./components/QrCodeIcon.svelte";
  import ShareIcon from "./components/ShareIcon.svelte";
  import DocumentIcon from "./components/DocumentIcon.svelte";
  import ChatIcon from "./components/ChatIcon.svelte";
  import PhoneIcon from "./components/PhoneIcon.svelte";
  import DisconnectIcon from "./components/DisconnectIcon.svelte";
  import { loadHandle, saveHandle } from "$lib/handle.ts";
  import { preview_store } from "./stores/preview.ts";
  import { wide_mode_store } from "./stores/wide_mode.ts";
  import { theme_store } from "./stores/theme.ts";
  import { VoiceCallManager } from "./rtc/voice_manager.ts";
  import { FileTransferUIManager } from "./rtc/file_transfer_ui.ts";

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
  desktop_mq.addEventListener("change", (e) => {
    is_desktop = e.matches;
  });

  let show_qr_overlay = $state(false);
  let show_settings = $state(false);
  let settings_initial_section = $state<"storage" | "connection">("storage");
  let show_palette = $state(false);
  let show_theme_panel = $state(false);
  let show_connect_menu = $state(false);
  let show_room_menu = $state(false);
  let show_actions_menu = $state(false);
  let show_url_qr = $state(false);
  let actions_menu_anchor = $state<{ top: number; right: number } | null>(null);
  let show_share_menu = $state(false);
  let share_menu_anchor = $state<{ top: number; right: number } | null>(null);
  let show_info_menu = $state(false);
  let info_menu_anchor = $state<{ top: number; right: number } | null>(null);
  let show_user_guide = $state(false);
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

  // ---------------------------------------------------------------------------
  // Runtime references (not reactive — managed imperatively)
  // ---------------------------------------------------------------------------

  // Single record per remote peer, keyed by peer ID.
  // QR mode uses a `qr-<uuid>` placeholder ID.
  interface PeerRecord {
    manager: RTCPeerManager;
    yjs_provider: RTCDataChannelProvider | null;
    ft_manager: FileTransferManager | null;
    data_channel: RTCDataChannel | null;
    state: import("./rtc/peer.ts").PeerManagerState;
    relay_status: boolean;
  }
  const peers = new Map<string, PeerRecord>();
  // Reactive: true when at least one connected peer is using a TURN relay.
  let any_peer_relayed = $state(false);
  // Whether the relay notice banner has been manually dismissed this session.
  let relay_notice_dismissed = $state(false);

  // ---------------------------------------------------------------------------
  // Handle (username) state
  // ---------------------------------------------------------------------------

  let local_handle = $state("");
  // Reactive map: remote_peer_id → handle string. Drives the peer list UI.
  let remote_handles = $state(new Map<string, string>());
  let peer_toasts = $state<PeerToast[]>([]);

  // ---------------------------------------------------------------------------
  // Peer count alert (flashes briefly when a new peer joins)
  // ---------------------------------------------------------------------------

  let peer_count_alert = $state(false);
  let peer_count_alert_timeout: ReturnType<typeof setTimeout> | null = null;
  // Non-reactive; compared against current size each effect run.
  let prev_peer_count = 0;

  $effect(() => {
    const count = remote_handles.size;
    if (count > prev_peer_count) {
      if (peer_count_alert_timeout !== null) {
        clearTimeout(peer_count_alert_timeout);
      }
      peer_count_alert = true;
      peer_count_alert_timeout = setTimeout(() => {
        peer_count_alert = false;
        peer_count_alert_timeout = null;
      }, 2000);
    }
    prev_peer_count = count;
  });

  // Show a one-time notice when the user enables document persistence,
  // so they understand the privacy implication (content survives tab close).
  let prev_persistence = false;
  $effect(() => {
    const enabled = $persistence_store;
    if (enabled && !prev_persistence) {
      addPeerToast(
        "Document persistence enabled — content is now saved locally in your browser and will survive tab close. " +
        "Disable in Settings → Storage to return to ephemeral mode.",
      );
    }
    prev_persistence = enabled;
  });

  // ---------------------------------------------------------------------------
  // Chat state
  // ---------------------------------------------------------------------------

  let chat_messages = $state<ChatMessage[]>([]);
  let chat_open = $state(false);
  let chat_unread = $state(0);

  // ---------------------------------------------------------------------------
  // Voice call state (reactive vars — mutated exclusively by voice_manager)
  // ---------------------------------------------------------------------------

  let voice_active = $state(false);
  let remote_voice_active = $state(new Map<string, string>());
  let peers_with_audio = $state(new Set<string>());
  let voice_warning_visible = $state(false);

  const voice_manager = new VoiceCallManager({
    get_local_handle: () => local_handle,
    get_data_channels: () => {
      const m = new Map<string, RTCDataChannel>();
      for (const [id, p] of peers) {
        if (p.data_channel !== null) { m.set(id, p.data_channel); }
      }
      return m;
    },
    get_peer_managers: () => {
      const m = new Map<string, RTCPeerManager>();
      for (const [id, p] of peers) { m.set(id, p.manager); }
      return m;
    },
    get_peer_states: () => {
      const m = new Map<string, import("./rtc/peer.ts").PeerManagerState>();
      for (const [id, p] of peers) { m.set(id, p.state); }
      return m;
    },
    get_voice_active: () => voice_active,
    get_remote_voice_active: () => remote_voice_active,
    get_peers_with_audio: () => peers_with_audio,
    set_voice_active: (v) => { voice_active = v; },
    set_voice_warning_visible: (v) => { voice_warning_visible = v; },
    set_remote_voice_active: (m) => { remote_voice_active = m; },
    set_peers_with_audio: (s) => { peers_with_audio = s; },
    add_peer_toast: (msg) => addPeerToast(msg),
    set_error: (msg) => connection_store.setError(msg),
    trigger_renegotiation: (peer_id) => {
      const peer = peers.get(peer_id);
      if (peer?.manager.getIsOfferer() === true && voice_active) {
        peer.manager.sendRenegotiationOffer();
      }
    },
  });

  // ---------------------------------------------------------------------------
  // File transfer UI state (reactive vars — mutated exclusively by ft_ui)
  // ---------------------------------------------------------------------------

  let ft_incoming_offers = $state(new Map<string, IncomingOffer>());
  let ft_progress = $state(new Map<string, { received: number; total: number }>());
  let ft_completed = $state(new Map<string, { url: string; filename: string }>());
  let ft_sent = $state(new Map<string, FtPeerEntry>());
  let ft_sending = $state(new Map<string, FtPeerEntry>());
  let ft_pending_sent = $state(new Map<string, FtPeerEntry>());

  const ft_ui = new FileTransferUIManager({
    get_incoming_offers: () => ft_incoming_offers,
    get_progress: () => ft_progress,
    get_completed: () => ft_completed,
    get_sent: () => ft_sent,
    get_sending: () => ft_sending,
    get_pending_sent: () => ft_pending_sent,
    set_incoming_offers: (v) => { ft_incoming_offers = v; },
    set_progress: (v) => { ft_progress = v; },
    set_completed: (v) => { ft_completed = v; },
    set_sent: (v) => { ft_sent = v; },
    set_sending: (v) => { ft_sending = v; },
    set_pending_sent: (v) => { ft_pending_sent = v; },
    get_file_transfer_managers: () => {
      const m = new Map<string, FileTransferManager>();
      for (const [id, p] of peers) {
        if (p.ft_manager !== null) { m.set(id, p.ft_manager); }
      }
      return m;
    },
    get_peer_relay_status: (peer_id) => peers.get(peer_id)?.relay_status === true,
    has_custom_turn: () => $rtc_config_store.turn_url !== "",
    get_remote_handle: (peer_id) => remote_handles.get(peer_id) ?? peer_id,
    add_peer_toast: (msg) => addPeerToast(msg),
    set_error: (msg) => connection_store.setError(msg),
  });

  // ---------------------------------------------------------------------------
  // File transfer actions — delegated to FileTransferUIManager
  // ---------------------------------------------------------------------------

  function makeFileTransferCallbacks(peer_id: string) {
    return ft_ui.make_callbacks(peer_id);
  }

  function acceptTransfer(transfer_id: string): void {
    ft_ui.accept(transfer_id);
  }

  function declineTransfer(transfer_id: string): void {
    ft_ui.decline(transfer_id);
  }

  function cancelTransfer(transfer_id: string): void {
    ft_ui.cancel(transfer_id);
  }

  function dismissCompleted(transfer_id: string): void {
    ft_ui.dismiss_completed(transfer_id);
  }

  function sendFileToAllPeers(file: File): void {
    ft_ui.send_to_all_peers(file);
  }

  // ---------------------------------------------------------------------------
  // Drag-and-drop file send
  // ---------------------------------------------------------------------------

  let drag_over = $state(false);
  // Counter tracks nested dragenter/dragleave events so we don't flicker when
  // the pointer moves over a child element.
  let drag_depth = 0;

  function handleDragEnter(e: DragEvent): void {
    if (!is_connected) { return; }
    if (!e.dataTransfer?.types.includes("Files")) { return; }
    e.preventDefault();
    drag_depth += 1;
    drag_over = true;
  }

  function handleDragOver(e: DragEvent): void {
    if (!is_connected) { return; }
    if (!e.dataTransfer?.types.includes("Files")) { return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(): void {
    drag_depth -= 1;
    if (drag_depth <= 0) {
      drag_depth = 0;
      drag_over = false;
    }
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    drag_depth = 0;
    drag_over = false;
    if (!is_connected) { return; }
    const file = e.dataTransfer?.files[0];
    if (file) {
      sendFileToAllPeers(file);
    }
  }

  function dismissSent(transfer_id: string): void {
    ft_ui.dismiss_sent(transfer_id);
  }

  let ws_transport: WebSocketTransport | null = null;
  // Set while signalling is active; cleared in teardown() to prevent auto-reconnect.
  let signalling_url: string | null = null;
  let qr_transport: QrTransport | null = null;
  let qr_packet = $state<Uint8Array | null>(null);
  let active_qr_session_id = $state<string | null>(null);
  let qr_connection_error = $state<string | null>(null);
  // Room ID from a scanned QR offer — applied only after the connection is confirmed.
  let pending_qr_room_id: string | null = null;
  // Auto-reconnect state for QR connections that temporarily drop.
  let was_qr_connected = false;
  let qr_reconnect_timeout_id: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------------
  // Initialise room ID on mount
  // ---------------------------------------------------------------------------

  onMount(() => {
    local_handle = loadHandle();

    const parsed = parseId();
    if (parsed !== null && isValidId(parsed)) {
      room_id = parsed;
    } else {
      // No room in URL — restore the last room or generate a fresh one.
      const saved_raw = localStorage.getItem(LAST_ROOM_KEY);
      let saved: { room_id: string; token: string } | null = null;
      try {
        saved = saved_raw !== null ? (JSON.parse(saved_raw) as { room_id: string; token: string }) : null;
      } catch {
        saved = null;
      }
      if (saved !== null && isValidId(saved.room_id) && saved.token !== "") {
        room_id = saved.room_id;
        history.replaceState(null, "", `${roomPath(room_id)}#${saved.token}`);
      } else {
        room_id = generateId();
        history.replaceState(null, "", roomPath(room_id));
      }
    }
    room_token = ensureToken();
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ room_id, token: room_token }));
    connection_store.setRoomId(room_id);
    reinitPersistence();
    loadChatLog();

    const unsubscribe_persistence = persistence_store.subscribe(() => {
      reinitPersistence();
    });

    // Global keyboard shortcuts
    const handle_keydown = (event: KeyboardEvent): void => {
      // ⌘K / Ctrl+K — open command palette
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        show_palette = true;
        return;
      }
      // All other shortcuts are suppressed while the palette is open
      // (the palette handles its own Escape/arrow/enter internally).
      if (show_palette) { return; }
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

  let copy_url_feedback = $state<"idle" | "success" | "error">("idle");

  function copyRoomUrl(): void {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        copy_url_feedback = "success";
        setTimeout(() => {
          copy_url_feedback = "idle";
        }, 1500);
      })
      .catch(() => {
        copy_url_feedback = "error";
        setTimeout(() => {
          copy_url_feedback = "idle";
        }, 2500);
      });
  }

  let copy_content_feedback = $state<"idle" | "success" | "error">("idle");

  function copyEditorContent(): void {
    const text = ytext.toString();
    navigator.clipboard
      .writeText(text)
      .then(() => {
        copy_content_feedback = "success";
        setTimeout(() => {
          copy_content_feedback = "idle";
        }, 1500);
      })
      .catch(() => {
        copy_content_feedback = "error";
        setTimeout(() => {
          copy_content_feedback = "idle";
        }, 2500);
      });
  }

  // ---------------------------------------------------------------------------
  // Peer state aggregation
  // ---------------------------------------------------------------------------

  function updateAggregateState(): void {
    if (peers.size === 0) {
      connection_store.setPeerState("idle");
      return;
    }
    const states = Array.from(peers.values()).map((p) => p.state);
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

  // ---------------------------------------------------------------------------
  // Handle management
  // ---------------------------------------------------------------------------

  function changeHandle(new_handle: string): void {
    local_handle = new_handle;
    saveHandle(new_handle);
    broadcastIdentity();
  }

  function broadcastIdentity(): void {
    const msg = JSON.stringify({ type: "identity", handle: local_handle });
    for (const p of peers.values()) {
      if (p.data_channel?.readyState === "open") {
        p.data_channel.send(msg);
      }
    }
  }

  function registerDataChannel(remote_peer_id: string, channel: RTCDataChannel): void {
    const peer = peers.get(remote_peer_id);
    if (peer !== undefined) { peer.data_channel = channel; }

    const send_initial_state = (): void => {
      channel.send(JSON.stringify({ type: "identity", handle: local_handle }));
      // Let the new peer know our current voice state immediately.
      const voice_msg = voice_manager.initial_channel_voice_message();
      if (voice_msg !== null) {
        channel.send(voice_msg);
      }
    };

    if (channel.readyState === "open") {
      send_initial_state();
    } else {
      channel.addEventListener("open", send_initial_state, { once: true });
    }

    channel.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const msg = JSON.parse(event.data) as {
          type?: string;
          handle?: string;
          id?: string;
          text?: string;
          timestamp?: number;
        };
        if (msg.type === "identity" && typeof msg.handle === "string") {
          const is_new = !remote_handles.has(remote_peer_id);
          remote_handles = new Map(remote_handles).set(remote_peer_id, msg.handle);
          if (is_new) {
            addPeerToast(`Connected to ${msg.handle}`);
          }
        } else if (msg.type === "voice-start" || msg.type === "voice-stop") {
          voice_manager.handle_data_message(remote_peer_id, msg);
        } else if (
          msg.type === "chat" &&
          typeof msg.text === "string" &&
          msg.text.trim().length > 0
        ) {
          const incoming: ChatMessage = {
            id: typeof msg.id === "string" ? msg.id : crypto.randomUUID(),
            handle: typeof msg.handle === "string" ? msg.handle : "Unknown",
            text: msg.text.trim(),
            timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
            is_local: false,
            secret: msg.secret === true,
          };
          // Deduplicate by id in case the message is echoed
          if (!chat_messages.some((m) => m.id === incoming.id)) {
            chat_messages = [...chat_messages, incoming];
            saveChatLog();
            if (!chat_open) {
              chat_unread += 1;
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  function loadChatLog(): void {
    if (!$chat_persistence_store) {
      return;
    }
    const stored = localStorage.getItem(`${CHAT_LOG_PREFIX}${room_id}`);
    if (stored === null) {
      return;
    }
    try {
      chat_messages = JSON.parse(stored) as ChatMessage[];
    } catch {
      // Ignore malformed storage
    }
  }

  function saveChatLog(): void {
    if (!$chat_persistence_store) {
      return;
    }
    const to_save = chat_messages.map((m) =>
      m.secret ? { ...m, text: SECRET_PLACEHOLDER } : m
    );
    localStorage.setItem(`${CHAT_LOG_PREFIX}${room_id}`, JSON.stringify(to_save));
  }

  function sendChatMessage(text: string, secret: boolean = false): void {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      handle: local_handle,
      text,
      timestamp: Date.now(),
      is_local: true,
      secret,
    };
    chat_messages = [...chat_messages, message];
    saveChatLog();
    const payload = JSON.stringify({
      type: "chat",
      id: message.id,
      handle: message.handle,
      text: message.text,
      timestamp: message.timestamp,
      secret: message.secret,
    });
    for (const p of peers.values()) {
      if (p.data_channel?.readyState === "open") {
        p.data_channel.send(payload);
      }
    }
  }

  function toggleChat(): void {
    chat_open = !chat_open;
    if (chat_open) {
      chat_unread = 0;
      // Chat and preview are mutually exclusive
      if ($preview_store) {
        preview_store.toggle();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Voice call — logic delegated to VoiceCallManager (see src/rtc/voice_manager.ts)
  // ---------------------------------------------------------------------------

  async function toggleVoice(): Promise<void> {
    await voice_manager.toggle();
  }

  // ---------------------------------------------------------------------------
  // Peer toast notifications
  // ---------------------------------------------------------------------------

  function addPeerToast(message: string): void {
    const id = crypto.randomUUID();
    peer_toasts = [...peer_toasts, { id, message }];
    setTimeout(() => dismissPeerToast(id), 4000);
  }

  function dismissPeerToast(id: string): void {
    peer_toasts = peer_toasts.filter((t) => t.id !== id);
  }

  /**
   * Disconnect and clean up a single peer. Safe to call when already disconnected
   * (guards against re-entry via onStateChange callbacks).
   */
  function disconnectPeer(remote_peer_id: string): void {
    if (!peers.has(remote_peer_id)) {
      return;
    }
    const peer = peers.get(remote_peer_id)!;
    // Delete first to prevent re-entry from the "closed" onStateChange fired by manager.close()
    peers.delete(remote_peer_id);
    peer.yjs_provider?.destroy();
    peer.ft_manager?.destroy();
    any_peer_relayed = Array.from(peers.values()).some((p) => p.relay_status);
    const departed_handle = remote_handles.get(remote_peer_id);
    const updated_handles = new Map(remote_handles);
    updated_handles.delete(remote_peer_id);
    remote_handles = updated_handles;
    // Clean up voice resources for this peer.
    voice_manager.cleanup_peer(remote_peer_id);
    connection_store.removeRemotePeer(remote_peer_id);
    peer.manager.close();
    if (departed_handle !== undefined) {
      addPeerToast(`Disconnected from ${departed_handle}`);
    }
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
    const manager = new RTCPeerManager(
      channel,
      {
        onDataChannel(data_channel) {
          registerDataChannel(remote_peer_id, data_channel);
          const provider = new RTCDataChannelProvider(doc, data_channel);
          const peer = peers.get(remote_peer_id);
          if (peer !== undefined) { peer.yjs_provider = provider; }
        },
        onFileChannel(file_channel) {
          const ft_manager = new FileTransferManager(
            file_channel,
            makeFileTransferCallbacks(remote_peer_id),
          );
          const peer = peers.get(remote_peer_id);
          if (peer !== undefined) { peer.ft_manager = ft_manager; }
        },
        onStateChange(state) {
          if (!peers.has(remote_peer_id)) {
            return; // already being cleaned up
          }
          peers.get(remote_peer_id)!.state = state;
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
            if (state === "failed" && !was_ever_connected) {
              addPeerToast(
                "Connection failed — your peer could not be reached. " +
                "You may be behind a restrictive firewall. " +
                "Try QR mode, or add a TURN relay server in Settings → Connection.",
              );
            }
            disconnectPeer(remote_peer_id);
          }
          updateAggregateState();
        },
        onRelayDetected(is_relay) {
          const peer = peers.get(remote_peer_id);
          if (peer !== undefined) { peer.relay_status = is_relay; }
          if (is_relay) { any_peer_relayed = true; }
        },
        onError(error) {
          connection_store.setError(error.message);
        },
        onTrack(event) {
          voice_manager.handle_remote_track(remote_peer_id, event);
        },
        async beforeAnswer(pc) {
          await voice_manager.before_answer(remote_peer_id, pc);
        },
      },
      undefined,
      getEffectiveIceServers(),
    );

    peers.set(remote_peer_id, {
      manager,
      yjs_provider: null,
      ft_manager: null,
      data_channel: null,
      state: "connecting",
      relay_status: false,
    });
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
        if (ws_transport !== null && peers.size === 0) {
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

  function getEffectiveSignalUrl(): string {
    const user_url = $rtc_config_store.signal_url;
    if (user_url !== "") {
      return user_url;
    }
    const env_url = import.meta.env.VITE_SIGNAL_URL || "";
    if (env_url !== "") {
      return env_url;
    }
    // In local development the Vite proxy forwards /ws → localhost signalling server,
    // so the same-host URL works. In production, VITE_SIGNAL_URL must always be set.
    if (import.meta.env.DEV) {
      const ws_protocol = window.location.protocol === "https:" ? "wss" : "ws";
      return `${ws_protocol}://${window.location.host}/ws`;
    }
    return "";
  }

  function getEffectiveIceServers(): RTCIceServer[] {
    const { turn_url, turn_username, turn_credential } = $rtc_config_store;
    if (turn_url === "") {
      return ICE_SERVERS; // STUN only
    }
    return [
      ...ICE_SERVERS,
      { urls: turn_url, username: turn_username, credential: turn_credential },
    ];
  }

  function connectViaSignalling(): void {
    teardown(); // clean up any prior attempt before starting a new one

    const url = getEffectiveSignalUrl();
    if (url === "") {
      connection_store.setError(
        "No signalling server URL configured. Open Settings → Connection to set one.",
      );
      return;
    }
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
      peers.get(active_qr_session_id)?.state !== "connected"
    ) {
      disconnectPeer(active_qr_session_id);
    }

    // Generate a unique ID for this QR pairing session.
    const session_id = `qr-${crypto.randomUUID()}`;
    active_qr_session_id = session_id;
    qr_packet = null;
    qr_connection_error = null;
    pending_qr_room_id = null;
    was_qr_connected = false;
    if (qr_reconnect_timeout_id !== null) {
      clearTimeout(qr_reconnect_timeout_id);
      qr_reconnect_timeout_id = null;
    }

    // Create the RTCPeerConnection up-front so both QrTransport and RTCPeerManager
    // share the same instance. QrTransport must monitor ICE gathering on the exact
    // PC that drives the offer/answer exchange — if they were separate objects,
    // localDescription on the QrTransport's PC would always be null.
    const pc = new RTCPeerConnection({ iceServers: getEffectiveIceServers() });

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
          registerDataChannel(session_id, data_channel);
          const provider = new RTCDataChannelProvider(doc, data_channel);
          const peer = peers.get(session_id);
          if (peer !== undefined) { peer.yjs_provider = provider; }
        },
        onFileChannel(file_channel) {
          const ft_manager = new FileTransferManager(
            file_channel,
            makeFileTransferCallbacks(session_id),
          );
          const peer = peers.get(session_id);
          if (peer !== undefined) { peer.ft_manager = ft_manager; }
        },
        onStateChange(state) {
          if (!peers.has(session_id)) {
            return;
          }
          peers.get(session_id)!.state = state;
          if (state === "connected") {
            was_qr_connected = true;
            if (qr_reconnect_timeout_id !== null) {
              clearTimeout(qr_reconnect_timeout_id);
              qr_reconnect_timeout_id = null;
            }
            if (pending_qr_room_id !== null) {
              applyRoomId(pending_qr_room_id);
              pending_qr_room_id = null;
            }
            connection_store.addRemotePeer(session_id);
            show_qr_overlay = false;
          }
          if (state === "failed") {
            pending_qr_room_id = null;
            if (qr_reconnect_timeout_id !== null) {
              clearTimeout(qr_reconnect_timeout_id);
              qr_reconnect_timeout_id = null;
            }
            qr_connection_error = "Connection failed";
            disconnectPeer(session_id);
          } else if (state === "disconnected") {
            if (was_qr_connected) {
              // Give the browser's native ICE recovery a chance to reconnect before
              // tearing down. WebRTC will keep doing ICE checks while the peer
              // connection is open; only clean up if it hasn't recovered after 30 s.
              if (qr_reconnect_timeout_id === null) {
                qr_reconnect_timeout_id = setTimeout(() => {
                  qr_reconnect_timeout_id = null;
                  if (peers.has(session_id)) {
                    disconnectPeer(session_id);
                  }
                }, 30_000);
              }
            } else {
              pending_qr_room_id = null;
              disconnectPeer(session_id);
            }
          }
          updateAggregateState();
        },
        onRelayDetected(is_relay) {
          const peer = peers.get(session_id);
          if (peer !== undefined) { peer.relay_status = is_relay; }
          if (is_relay) { any_peer_relayed = true; }
        },
        onError(error) {
          connection_store.setError(error.message);
        },
        onTrack(event) {
          handleRemoteTrack(session_id, event);
        },
        async beforeAnswer(pc_arg) {
          await voice_manager.before_answer(session_id, pc_arg);
        },
      },
      pc,
    );

    peers.set(session_id, {
      manager,
      yjs_provider: null,
      ft_manager: null,
      data_channel: null,
      state: "connecting",
      relay_status: false,
    });
    show_qr_overlay = true;
    // Only switch mode to "qr" if we aren't already connected via another method.
    if (peers.size === 1) {
      connection_store.setMode("qr");
    }
    updateAggregateState();
    // Role selection is deferred — user picks "Show my QR" or "Scan first" in the overlay.
  }

  function startQrAsOfferer(): void {
    if (active_qr_session_id === null) {
      return;
    }
    peers.get(active_qr_session_id)?.manager.startAsOfferer();
  }

  function startQrAsAnswerer(): void {
    if (active_qr_session_id === null) {
      return;
    }
    peers.get(active_qr_session_id)?.manager.startAsAnswerer();
  }

  function applyRoomId(new_room_id: string): void {
    room_id = new_room_id;
    history.replaceState(null, "", `${roomPath(new_room_id)}#${room_token}`);
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ room_id, token: room_token }));
    connection_store.setRoomId(new_room_id);
    reinitPersistence();
  }

  function applyToken(new_token: string): void {
    room_token = new_token;
    history.replaceState(null, "", `${window.location.pathname}#${new_token}`);
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ room_id, token: room_token }));
    qr_transport?.setToken(new_token);
  }

  function handleQrScanned(scanned_packet: Uint8Array): void {
    // Extract the room ID and token embedded in the QR packet.
    // The offerer's room ID and token are always authoritative — only adopt them when scanning an offer.
    try {
      const {
        room_id: incoming_room_id,
        room_token: incoming_token,
        is_answer,
      } = decodePacketMeta(scanned_packet);
      if (!is_answer) {
        // Always adopt the offerer's token so the answerer's QR carries the matching secret.
        applyToken(incoming_token);

        if (incoming_room_id !== "" && incoming_room_id !== room_id) {
          const has_content = ytext.toString().length > 0;
          const has_persistence = $persistence_store;
          if (has_content || has_persistence) {
            // Ask for consent now, but defer the actual room change until the
            // connection is confirmed so a failed attempt doesn't change the room.
            showConfirm(
              `This QR code is for room "${incoming_room_id}". Your room ID will change from "${room_id}" once connected. Your current document will merge with theirs.${has_persistence ? " Your saved history for this room will remain under the old ID." : ""}`,
              () => { pending_qr_room_id = incoming_room_id; },
            );
          } else {
            pending_qr_room_id = incoming_room_id;
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
    qr_connection_error = null;
    pending_qr_room_id = null;
    was_qr_connected = false;
    if (qr_reconnect_timeout_id !== null) {
      clearTimeout(qr_reconnect_timeout_id);
      qr_reconnect_timeout_id = null;
    }
    const session_id = active_qr_session_id;
    active_qr_session_id = null;
    qr_transport = null;
    // Only tear down this QR session — leave any other connected peers intact.
    if (session_id !== null && peers.get(session_id)?.state !== "connected") {
      disconnectPeer(session_id);
    }
    // If nothing remains, reset to idle.
    if (peers.size === 0) {
      connection_store.setMode("none");
      connection_store.setPeerState("idle");
    }
  }

  function teardown(): void {
    signalling_url = null; // prevent auto-reconnect if WS close event fires after this
    active_qr_session_id = null;
    Array.from(peers.keys()).forEach((id) => disconnectPeer(id));
    ws_transport?.close();
    ws_transport = null;
    qr_transport = null;
    qr_packet = null;
    relay_notice_dismissed = false;
    connection_store.setMode("none");
    connection_store.setPeerState("idle");
  }

  // ---------------------------------------------------------------------------
  // Export / share
  // ---------------------------------------------------------------------------

  function openUserGuide(): void {
    show_info_menu = false;
    info_menu_anchor = null;
    show_user_guide = true;
  }

  function openAbout(): void {
    show_info_menu = false;
    info_menu_anchor = null;
    show_about = true;
  }

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
    show_share_menu = false;
    share_menu_anchor = null;
    const content = ytext.toString();
    const file = new File([content], `${room_id}.txt`, { type: "text/plain" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      exportDocument(); // fall back to download
    }
  }

  async function shareRoomLink(): Promise<void> {
    show_share_menu = false;
    share_menu_anchor = null;
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

  function selectRandom(): void {
    show_room_menu = false;
    teardown();
    const new_room_id = generateId();
    room_id = new_room_id;
    // Clear the fragment so ensureToken() generates a fresh random token.
    history.replaceState(null, "", roomPath(new_room_id));
    room_token = ensureToken();
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ room_id, token: room_token }));
    connection_store.setRoomId(new_room_id);
    reinitPersistence();
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
    if (show_room_menu && !target.closest(".room-name-wrapper")) {
      show_room_menu = false;
    }
    if (show_actions_menu && !target.closest(".actions-menu-wrapper")) {
      show_actions_menu = false;
      actions_menu_anchor = null;
    }
    if (show_share_menu && !target.closest(".share-menu-wrapper")) {
      show_share_menu = false;
      share_menu_anchor = null;
    }
    if (show_info_menu && !target.closest(".info-menu-wrapper")) {
      show_info_menu = false;
      info_menu_anchor = null;
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
  // True when a remote peer has started a voice call but we haven't joined yet.
  const incoming_voice_call = $derived(remote_voice_active.size > 0 && !voice_active);
  const is_dark_theme = $derived($theme_store["name"] === "dark");

  // ---------------------------------------------------------------------------
  // Command palette command definitions
  // ---------------------------------------------------------------------------

  const palette_commands = $derived<PaletteCommand[]>([
    // Connect
    {
      id: "connect-signalling",
      label: "Connect via signalling server",
      group: "Connect",
      keywords: ["websocket", "internet", "server", "join"],
      disabled: is_connected,
      action: selectSignalling,
    },
    {
      id: "connect-qr",
      label: "Connect via QR code",
      group: "Connect",
      keywords: ["air-gap", "offline", "scan", "camera", "serverless"],
      action: selectQr,
    },
    {
      id: "new-room",
      label: "New random room",
      group: "Connect",
      keywords: ["generate", "fresh", "different", "random"],
      action: selectRandom,
    },
    {
      id: "disconnect",
      label: "Disconnect",
      group: "Connect",
      keywords: ["leave", "close", "end"],
      disabled: !is_connected,
      action: handleDisconnect,
    },
    // Document
    {
      id: "copy-text",
      label: "Copy all text",
      group: "Document",
      keywords: ["clipboard", "copy"],
      action: copyEditorContent,
    },
    {
      id: "send-file",
      label: "Send file",
      group: "Document",
      keywords: ["transfer", "attach", "upload", "file", "share", "send"],
      disabled: !is_connected,
      action: () => {
        (document.getElementById("file-transfer-input") as HTMLInputElement).click();
      },
    },
    {
      id: "toggle-preview",
      label: $preview_store ? "Hide markdown preview" : "Show markdown preview",
      group: "Document",
      keywords: ["markdown", "render", "preview", "md"],
      action: () => { preview_store.toggle(); },
    },
    {
      id: "toggle-code",
      label: code_mode ? "Exit code mode" : "Enter code mode",
      group: "Document",
      keywords: ["syntax", "highlight", "editor", "code"],
      action: () => { code_mode = !code_mode; },
    },
    {
      id: "import",
      label: "Import text file",
      group: "Document",
      keywords: ["upload", "load", "open", "file"],
      action: importDocument,
    },
    {
      id: "export",
      label: "Export as text file",
      group: "Document",
      keywords: ["download", "save", "file"],
      action: exportDocument,
    },
    {
      id: "share-link",
      label: "Share room link",
      group: "Document",
      keywords: ["url", "invite", "link", "share"],
      action: shareRoomLink,
    },
    {
      id: "clear-doc",
      label: "Clear document",
      group: "Document",
      keywords: ["delete", "erase", "reset", "wipe"],
      action: () => { showConfirm("Clear the document?", clearCurrentDoc); },
    },
    // Chat
    {
      id: "toggle-chat",
      label: chat_open ? "Close chat" : "Open chat",
      group: "Chat",
      keywords: ["message", "talk", "chat"],
      action: () => { chat_open = !chat_open; },
    },
    // Voice
    {
      id: "toggle-voice",
      label: voice_active ? "End voice call" : incoming_voice_call ? "Join voice call" : "Start voice call",
      group: "Voice",
      keywords: ["audio", "call", "phone", "mic", "voice"],
      disabled: !is_connected && !voice_active,
      action: () => { void toggleVoice(); },
    },
    // View
    {
      id: "toggle-focus",
      label: $focus_mode_store ? "Exit focus mode" : "Enter focus mode",
      group: "View",
      keywords: ["distraction", "zen", "fullscreen", "focus"],
      action: () => { focus_mode_store.toggle(); },
    },
    {
      id: "toggle-wide",
      label: $wide_mode_store ? "Exit wide layout" : "Enable wide layout",
      group: "View",
      keywords: ["full", "expand", "width", "wide"],
      action: () => { wide_mode_store.toggle(); },
    },
    {
      id: "theme-toggle",
      label: is_dark_theme ? "Switch to light mode" : "Switch to dark mode",
      group: "View",
      keywords: ["theme", "dark", "light", "mode", "bright", "night"],
      action: () => { theme_store.setBuiltIn(is_dark_theme ? "light" : "dark"); },
    },
    {
      id: "theme-custom",
      label: "Customize theme",
      group: "View",
      keywords: ["color", "tokens", "css", "palette", "theme", "custom"],
      action: () => { show_theme_panel = true; },
    },
    // App
    {
      id: "settings",
      label: "Open settings",
      group: "App",
      keywords: ["preferences", "config", "storage", "connection"],
      action: () => { show_settings = true; },
    },
    {
      id: "user-guide",
      label: "User guide",
      group: "App",
      keywords: ["help", "docs", "documentation", "how"],
      action: openUserGuide,
    },
    {
      id: "about",
      label: "About notapipe",
      group: "App",
      keywords: ["info", "version", "credits"],
      action: openAbout,
    },
  ]);
  // True when we've started/joined a call but haven't received audio from any peer yet.
  const voice_connecting = $derived(voice_active && peers_with_audio.size === 0);
  // True once audio is actually flowing from at least one peer.
  const voice_call_active = $derived(voice_active && peers_with_audio.size > 0);
  // Preview is suppressed in focus mode and code mode
  const show_preview = $derived(
    $preview_store && !$focus_mode_store && !code_mode,
  );
  const show_chat = $derived(chat_open && !$focus_mode_store && !code_mode);
</script>

<svelte:window
  onclick={handleWindowClick}
  onbeforeunload={(e) => {
    if (!$persistence_store && ytext.length > 0) {
      e.preventDefault();
    }
  }}
/>

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
        <div
          class="peer-count"
          class:alert={peer_count_alert}
          title="{remote_handles.size} peer{remote_handles.size === 1 ? '' : 's'} connected"
          aria-label="{remote_handles.size} peer{remote_handles.size === 1 ? '' : 's'} connected"
        >
          <UserIcon size={11} />
          <span class="peer-count-num">{remote_handles.size}</span>
        </div>
      </div>
      <div class="header-right">
        {#if $persistence_store}
          <button
            class="persist-indicator"
            onclick={() => { show_settings = true; }}
            title="Document content is saved in your browser (IndexedDB) — survives tab close. Click to manage storage settings."
            aria-label="Document persistence active — content is saved locally and survives tab close. Open storage settings."
          >
            <HardDriveIcon />
          </button>
        {/if}
        <div class="info-menu-wrapper">
          <button
            class="icon-btn"
            onclick={(e) => {
              const rect = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              info_menu_anchor = {
                top: rect.bottom + 4,
                right: window.innerWidth - rect.right,
              };
              show_info_menu = !show_info_menu;
              if (!show_info_menu) {
                info_menu_anchor = null;
              }
            }}
            title="Info"
            aria-label="Info"
            aria-haspopup="menu"
            aria-expanded={show_info_menu}>?</button
          >
        </div>
        <!-- Sun / moon — visible light/dark toggle (hidden on narrow screens; use ⌘K instead) -->
        <button
          class="icon-btn theme-toggle-btn"
          onclick={() => { theme_store.setBuiltIn(is_dark_theme ? "light" : "dark"); }}
          title={is_dark_theme ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={is_dark_theme ? "Switch to light mode" : "Switch to dark mode"}
        >
          {#if is_dark_theme}
            <SunIcon />
          {:else}
            <MoonIcon />
          {/if}
        </button>
        <div class="share-menu-wrapper">
          <button
            class="icon-btn"
            onclick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              share_menu_anchor = {
                top: rect.bottom + 4,
                right: window.innerWidth - rect.right,
              };
              show_share_menu = !show_share_menu;
              if (!show_share_menu) {
                share_menu_anchor = null;
              }
            }}
            title="Share"
            aria-label="Share"
            aria-haspopup="menu"
            aria-expanded={show_share_menu}
          >
            <ShareIcon size={14} />
          </button>
        </div>
        <button
          class="icon-btn settings-btn"
          onclick={() => {
            show_settings = !show_settings;
          }}
          title="Settings"
          aria-label="Settings">⚙</button
        >
        <!-- ⌘K palette trigger — also serves as the tap target on mobile -->
        <button
          class="icon-btn palette-trigger"
          onclick={() => { show_palette = true; }}
          title="Command palette (⌘K)"
          aria-label="Open command palette"
        >⌘K</button>
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
      <div class="room-name-wrapper">
        <button
          class="room-name-btn"
          onclick={() => { show_room_menu = !show_room_menu; }}
          title="Room: {room_id} — click to switch rooms"
          aria-haspopup="menu"
          aria-expanded={show_room_menu}
        >{room_id}</button>
        {#if show_room_menu}
          <div class="connect-menu room-menu" role="menu">
            <button
              class="menu-item"
              role="menuitem"
              onclick={selectRandom}
            >New random room</button>
          </div>
        {/if}
      </div>
      <button
        class="copy-btn"
        class:active={copy_url_feedback === "success"}
        class:error={copy_url_feedback === "error"}
        onclick={copyRoomUrl}
        title={copy_url_feedback === "success" ? "Copied!" : copy_url_feedback === "error" ? "Copy failed — clipboard access denied" : "Copy room URL"}
        aria-label="Copy room link"
      >
        <CopyIcon copied={copy_url_feedback === "success"} />
      </button>
      <button
        class="copy-btn"
        onclick={() => { show_url_qr = true; }}
        title="Display current URL as QR code"
        aria-label="Display current URL as QR code"
      >
        <QrCodeIcon />
      </button>
      <HandleWidget handle={local_handle} onchange={changeHandle} />
      <PeerList
        peers={Array.from(remote_handles.entries()).map(([id, handle]) => ({ id, handle }))}
      />
      <div class="chat-btn-wrapper">
        <button
          class="copy-btn"
          class:active={show_chat}
          onclick={toggleChat}
          title="Toggle chat"
          aria-label={`Toggle chat${chat_unread > 0 ? ` (${chat_unread} unread)` : ""}`}
          aria-pressed={show_chat}
        >
          <!-- Narrow: swap to document icon when chat is open (editor is hidden) -->
          <!-- Wide: always show chat icon; active state conveys open/closed -->
          {#if show_chat}
            <span class="icon-narrow-only"><DocumentIcon size={13} /></span>
            <span class="icon-wide-only"><ChatIcon /></span>
          {:else}
            <ChatIcon />
          {/if}
        </button>
        {#if chat_unread > 0}
          <span class="chat-badge" aria-hidden="true">{chat_unread > 99 ? "99+" : chat_unread}</span>
        {/if}
      </div>
      <button
        class="copy-btn"
        class:voice-active={voice_call_active}
        class:voice-connecting={voice_connecting}
        class:voice-ringing={incoming_voice_call}
        onclick={toggleVoice}
        disabled={!is_connected && !voice_active}
        title={voice_active ? "End voice call" : incoming_voice_call ? "Join voice call" : "Start voice call"}
        aria-label={voice_active ? "End voice call" : incoming_voice_call ? "Join voice call" : "Start voice call"}
        aria-pressed={voice_active}
      >
        <PhoneIcon />
      </button>
    </div>
  {/if}

  <!-- Relay notice banner — shown when a peer is connected via TURN relay and no custom TURN is configured -->
  {#if any_peer_relayed && !$rtc_config_store.turn_url && !relay_notice_dismissed}
    <div class="relay-notice-bar" role="status">
      <span>
        Connection is relayed — traffic is forwarded through a third-party server (encrypted, but observable metadata).
        File transfers over 5 MB are blocked.
        <button class="relay-notice-link" onclick={() => { show_settings = true; settings_initial_section = "connection"; }}>Configure your own TURN server</button>
        to remove this limit.
      </span>
      <button class="relay-notice-dismiss" onclick={() => { relay_notice_dismissed = true; }} aria-label="Dismiss">✕</button>
    </div>
  {/if}

  <!-- Voice call 4-hour warning banner -->
  {#if voice_warning_visible}
    <div class="voice-warning-bar" role="alert">
      <span>Voice call will end automatically in 15 minutes.</span>
      <button class="voice-warning-dismiss" onclick={() => { voice_warning_visible = false; }} aria-label="Dismiss">✕</button>
    </div>
  {/if}

  <!-- Editor (+ optional preview / chat pane) -->
  <main
    class:preview-split={show_preview && !show_chat}
    class:chat-split={show_chat}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#if drag_over}
      <div class="drop-overlay" aria-hidden="true">
        <div class="drop-overlay-inner">
          <span class="drop-overlay-icon">⇩</span>
          <span class="drop-overlay-label">Drop to send file</span>
        </div>
      </div>
    {/if}
    <!-- On narrow screens hide editor when preview or chat is active -->
    <div class="editor-pane" class:hidden-narrow={show_preview || show_chat}>
      <Editor
        {doc}
        {ytext}
        readonly={false}
        {code_mode}
        language={code_language}
      />
      <PeerToastBar toasts={peer_toasts} ondismiss={dismissPeerToast} />
    </div>
    {#if show_preview && !show_chat}
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
    {#if show_chat}
      <div class="chat-pane">
        <ChatPanel
          messages={chat_messages}
          {local_handle}
          connected={is_connected}
          onclose={toggleChat}
          onsend={sendChatMessage}
        />
      </div>
    {/if}
    <FileTransferBar
      connected={is_connected}
      incoming_offers={ft_incoming_offers}
      transfer_progress={ft_progress}
      completed_files={ft_completed}
      sending_files={ft_sending}
      sent_files={ft_sent}
      pending_sent={ft_pending_sent}
      onaccept={acceptTransfer}
      ondecline={declineTransfer}
      oncancel={cancelTransfer}
      ondismiss={dismissCompleted}
      ondismisssent={dismissSent}
      onsendfile={sendFileToAllPeers}
    />
  </main>

  <!-- Bottom bar — always visible -->
  <div class="bottom-bar" class:chat-open={show_chat}>
    <div class="bottom-left">
      {#if !$focus_mode_store && !code_mode}
        {#if is_connected}
          <button class="action-btn" onclick={connectViaQr} title="Add peer via QR">
            <QrCodeIcon size={14} />
            <span class="btn-text">Add peer via QR</span>
          </button>
          <button class="action-btn" onclick={handleDisconnect} title="Disconnect">
            <DisconnectIcon />
            <span class="btn-text">Disconnect</span>
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
      {/if}
    </div>
    <div class="bottom-right">
      <button
        class="corner-btn"
        class:copy-error={copy_content_feedback === "error"}
        onclick={copyEditorContent}
        title={copy_content_feedback === "success" ? "Copied!" : copy_content_feedback === "error" ? "Copy failed — clipboard not available" : "Copy all text to clipboard"}
        aria-label={copy_content_feedback === "error" ? "Copy failed — clipboard not available" : "Copy editor content to clipboard"}
      >
        <CopyIcon copied={copy_content_feedback === "success"} size={14} />
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
  </div>

  <!-- Overlays -->
  {#if show_qr_overlay}
    <QrOverlay
      packet={qr_packet}
      connection_error={qr_connection_error}
      onscanned={handleQrScanned}
      onclose={closeQrOverlay}
      onstartofferer={startQrAsOfferer}
      onstartanswerer={startQrAsAnswerer}
    />
  {/if}

  {#if show_settings}
    <SettingsPanel
      initial_section={settings_initial_section}
      onclose={() => {
        show_settings = false;
        settings_initial_section = "storage";
      }}
    />
  {/if}

  {#if show_theme_panel}
    <ThemePanel onclose={() => { show_theme_panel = false; }} />
  {/if}

  {#if show_palette}
    <CommandPalette
      commands={palette_commands}
      onclose={() => { show_palette = false; }}
    />
  {/if}

  {#if show_info_menu && info_menu_anchor !== null}
    <div
      class="connect-menu info-menu"
      role="menu"
      style="position: fixed; top: {info_menu_anchor.top}px; right: {info_menu_anchor.right}px; z-index: 200;"
    >
      <button class="menu-item" role="menuitem" onclick={openUserGuide}>
        User Guide
      </button>
      <button class="menu-item" role="menuitem" onclick={openAbout}>
        About
      </button>
    </div>
  {/if}

  {#if show_share_menu && share_menu_anchor !== null}
    <div
      class="connect-menu share-menu"
      role="menu"
      style="position: fixed; top: {share_menu_anchor.top}px; right: {share_menu_anchor.right}px; z-index: 200;"
    >
      <button class="menu-item" role="menuitem" onclick={shareRoomLink}>
        Share room link
      </button>
      {#if can_share}
        <button class="menu-item" role="menuitem" onclick={shareDocument}>
          Share document as file
        </button>
      {/if}
    </div>
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
          show_palette = true;
        }}
      >
        ⌘ Command palette
      </button>
      <div class="menu-divider" role="separator"></div>
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
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          showConfirm(
            "Force reload the page? Any unsynced changes may be lost.",
            () => {
              window.location.reload();
            },
          );
        }}>↺ Force reload</button
      >
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
        }}>Clear current document</button
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
        }}>Clear all documents</button
      >
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => {
          show_actions_menu = false;
          showConfirm(
            "Clear all notapipe settings (theme, persistence)?",
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
      content={USER_GUIDE_CONTENT}
      onclose={() => {
        show_user_guide = false;
      }}
    />
  {/if}

  {#if show_about}
    <InfoModal
      title="About notapipe"
      content={ABOUT_CONTENT}
      onclose={() => {
        show_about = false;
      }}
    />
  {/if}

  {#if show_url_qr}
    <UrlQrModal onclose={() => { show_url_qr = false; }} />
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
    overflow-x: hidden;
  }

  @media (min-width: 768px) {
    .app.wide {
      max-width: calc(100vw - 3rem);
    }
  }

  /* On narrow phones, hide non-essential header buttons — use ⌘K via actions menu */
  @media (max-width: 600px) {
    .info-menu-wrapper,
    .theme-toggle-btn,
    .palette-trigger {
      display: none;
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

  .peer-count {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
    user-select: none;
  }

  .peer-count.alert {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  .peer-count-num {
    font-family: "IBM Plex Mono", monospace;
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

  .copy-btn:hover,
  .copy-btn.active {
    color: var(--color-text);
  }

  .copy-btn.error {
    color: var(--color-error, #e53e3e);
  }

  .chat-btn-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  /* Chat icon swap helpers: narrow shows document icon (back-to-editor),
     wide always shows the chat icon in active/inactive states */
  .icon-narrow-only { display: flex; }
  .icon-wide-only   { display: none; }

  @media (min-width: 768px) {
    .icon-narrow-only { display: none; }
    .icon-wide-only   { display: flex; }
  }

  .chat-badge {
    position: absolute;
    top: 0;
    right: -6px;
    background: var(--color-accent);
    color: #fff;
    font-size: 0.6rem;
    font-weight: 600;
    line-height: 1;
    min-width: 14px;
    height: 14px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    pointer-events: none;
  }

  .copy-btn.voice-active {
    color: #22c55e;
  }

  .copy-btn.voice-active:hover {
    color: #16a34a;
  }

  @keyframes voice-ring {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .copy-btn.voice-connecting {
    color: #22c55e;
    animation: voice-ring 1.2s ease-in-out infinite;
  }

  .copy-btn.voice-ringing {
    color: #22c55e;
    animation: voice-ring 1.2s ease-in-out infinite;
  }

  .copy-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .voice-warning-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--color-accent);
    color: var(--color-bg);
    font-size: 0.78rem;
    padding: 0.4rem 1rem;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .voice-warning-dismiss {
    background: none;
    border: none;
    color: var(--color-bg);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0 0.25rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .relay-notice-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 0.75rem;
    padding: 0.4rem 1rem;
    gap: 0.5rem;
    flex-shrink: 0;
    line-height: 1.4;
  }

  .relay-notice-link {
    background: none;
    border: none;
    color: var(--color-accent);
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .relay-notice-link:hover {
    opacity: 0.8;
  }

  .relay-notice-dismiss {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0 0.25rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .relay-notice-dismiss:hover {
    color: var(--color-text);
  }

  .room-name-wrapper {
    position: relative;
  }

  .room-name-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0.1rem 0.2rem;
    cursor: pointer;
    border-radius: 3px;
  }

  .room-name-btn:hover {
    color: var(--color-text);
    background: var(--color-bg);
  }

  .connect-menu.room-menu {
    top: calc(100% + 4px);
    bottom: auto;
    left: 0;
    right: auto;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .persist-indicator {
    display: flex;
    align-items: center;
    background: none;
    border: none;
    padding: 0.25rem;
    border-radius: 4px;
    color: var(--color-accent);
    opacity: 0.7;
    cursor: pointer;
  }

  .persist-indicator:hover {
    opacity: 1;
    background: var(--color-surface);
  }

  .actions-menu-wrapper,
  .info-menu-wrapper {
    position: relative;
  }

  /* Overrides the .connect-menu defaults — rendered at app root with fixed positioning */
  .actions-menu,
  .info-menu,
  .share-menu {
    position: fixed !important;
    bottom: auto !important;
    left: auto !important;
    min-width: 160px !important;
    z-index: 300 !important;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }

  .actions-menu {
    min-width: 200px !important;
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

  .palette-trigger {
    font-size: 0.65rem;
    letter-spacing: 0.02em;
    opacity: 0.6;
    min-width: unset;
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  .palette-trigger:hover:not(:disabled) {
    opacity: 1;
  }

  main {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 2px dashed var(--color-accent);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .drop-overlay-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .drop-overlay-icon {
    font-size: 2.5rem;
    color: var(--color-accent);
    line-height: 1;
  }

  .drop-overlay-label {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-accent);
    letter-spacing: 0.02em;
  }

  /* Split-pane layout on wide screens */
  @media (min-width: 768px) {
    main.preview-split,
    main.chat-split {
      flex-direction: row;
    }

    main.preview-split .editor-pane,
    main.chat-split .editor-pane {
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

    main.chat-split .chat-pane {
      width: 300px;
      flex-shrink: 0;
      min-height: 0;
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

    /* On narrow screens, chat pane fills the main area like preview does */
    .chat-pane {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
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

  /* Shared pane styles */
  .editor-pane,
  .preview-pane {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .editor-pane {
    position: relative;
  }

  .bottom-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
    gap: 0.5rem;
  }

  @media (max-width: 767px) {
    .bottom-bar.chat-open {
      display: none;
    }
  }

  .bottom-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bottom-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
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
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .action-btn :global(svg) {
    flex-shrink: 0;
  }

  @media (max-width: 599px) {
    .btn-text {
      display: none;
    }

    .action-btn {
      padding: 0.5rem 0.75rem;
    }
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
    transition: opacity 0.15s;
    padding: 0;
  }

  .corner-btn:hover {
    opacity: 0.7;
  }

  .corner-btn.copy-error {
    color: #ef4444;
    border-color: #ef4444;
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

  :global(.focus-mode) .corner-btn {
    background: var(--color-focus-bg);
    border-color: var(--color-focus-rule);
    color: var(--color-focus-text);
  }

  :global(.focus-mode) .bottom-bar {
    background: var(--color-focus-bg);
    border-color: var(--color-focus-rule);
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
