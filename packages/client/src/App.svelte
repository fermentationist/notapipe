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
    CHAT_LOG_PREFIX,
  } from "$lib/constants/storage.ts";
  import { ICE_SERVERS } from "$lib/constants/rtc.ts";
  import {
    rtc_config_store,
    RTC_CONFIG_DEFAULTS,
  } from "./stores/rtc_config.ts";
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
  import FileTransferBar from "./components/FileTransferBar.svelte";
  import HandleWidget from "./components/HandleWidget.svelte";
  import PeerList from "./components/PeerList.svelte";
  import PeerToastBar, { type PeerToast } from "./components/PeerToastBar.svelte";
  import ChatPanel, { type ChatMessage } from "./components/ChatPanel.svelte";
  import InfoModal from "./components/InfoModal.svelte";
  import UrlQrModal from "./components/UrlQrModal.svelte";
  import CommandPalette, { type PaletteCommand } from "./components/CommandPalette.svelte";
  import ThemePanel from "./components/ThemePanel.svelte";
  import { loadHandle, saveHandle } from "$lib/handle.ts";
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
  desktop_mq.addEventListener("change", (e) => {
    is_desktop = e.matches;
  });

  let show_qr_overlay = $state(false);
  let show_settings = $state(false);
  let show_palette = $state(false);
  let show_theme_panel = $state(false);
  let show_connect_menu = $state(false);
  let show_find_room_menu = $state(false);
  let show_actions_menu = $state(false);
  let show_url_qr = $state(false);
  let actions_menu_anchor = $state<{ top: number; right: number } | null>(null);
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
  const data_channels = new Map<string, RTCDataChannel>();
  const peer_states = new Map<
    string,
    import("./rtc/peer.ts").PeerManagerState
  >();

  // ---------------------------------------------------------------------------
  // Handle (username) state
  // ---------------------------------------------------------------------------

  let local_handle = $state("");
  // Reactive map: remote_peer_id → handle string. Drives the peer list UI.
  let remote_handles = $state(new Map<string, string>());
  let peer_toasts = $state<PeerToast[]>([]);

  // ---------------------------------------------------------------------------
  // Chat state
  // ---------------------------------------------------------------------------

  let chat_messages = $state<ChatMessage[]>([]);
  let chat_open = $state(false);
  let chat_unread = $state(0);

  // ---------------------------------------------------------------------------
  // Voice call state
  // ---------------------------------------------------------------------------

  let voice_active = $state(false);
  let local_voice_stream: MediaStream | null = null;
  // Maps peer_id → HTMLAudioElement for playing remote audio.
  const remote_audio_nodes = new Map<string, HTMLAudioElement>();
  // Tracks peers where the answerer's mic has been added via beforeAnswer,
  // to prevent duplicate addTrack calls on subsequent renegotiations.
  const answerer_voice_added = new Set<string>();
  // Reactive: remote peers who currently have voice active (peer_id → handle).
  let remote_voice_active = $state(new Map<string, string>());
  // Reactive: peers from whom we have received at least one audio track in the
  // current call cycle. Used to distinguish "connecting" from "active".
  let peers_with_audio = $state(new Set<string>());

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
  let ft_sent = $state(new Map<string, string>()); // transfer_id → filename
  let ft_sending = $state(new Map<string, string>()); // transfer_id → filename (accepted, in-flight)
  let ft_pending_sent = $state(new Map<string, string>()); // transfer_id → filename (offered, awaiting acceptance)
  // Non-reactive map: tracks filenames for in-flight outgoing transfers so
  // onTransferAccepted / onFileSent can surface the name without re-querying the file object.
  const ft_outgoing_names = new Map<string, string>();

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
      onTransferAccepted(transfer_id: string) {
        const filename = ft_outgoing_names.get(transfer_id) ?? "file";
        const pending = new Map(ft_pending_sent);
        pending.delete(transfer_id);
        ft_pending_sent = pending;
        ft_sending = new Map(ft_sending).set(transfer_id, filename);
        void peer_id; // suppress unused warning
      },
      onFileSent(transfer_id: string) {
        ft_sending = (() => {
          const m = new Map(ft_sending);
          m.delete(transfer_id);
          return m;
        })();
        const filename = ft_outgoing_names.get(transfer_id) ?? "file";
        ft_outgoing_names.delete(transfer_id);
        ft_sent = new Map(ft_sent).set(transfer_id, filename);
      },
      onTransferCancelled(transfer_id: string) {
        const offers = new Map(ft_incoming_offers);
        offers.delete(transfer_id);
        ft_incoming_offers = offers;
        const progress = new Map(ft_progress);
        progress.delete(transfer_id);
        ft_progress = progress;
        ft_sending = (() => {
          const m = new Map(ft_sending);
          m.delete(transfer_id);
          return m;
        })();
        const pending = new Map(ft_pending_sent);
        pending.delete(transfer_id);
        ft_pending_sent = pending;
        ft_outgoing_names.delete(transfer_id);
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
    console.log("[sendFileToAllPeers] managers:", file_transfer_managers.size, "file:", file.name);
    for (const manager of file_transfer_managers.values()) {
      const transfer_id = manager.sendFile(file);
      console.log("[sendFileToAllPeers] transfer_id:", transfer_id);
      if (transfer_id !== null) {
        ft_outgoing_names.set(transfer_id, file.name);
        ft_pending_sent = new Map(ft_pending_sent).set(transfer_id, file.name);
        console.log("[sendFileToAllPeers] ft_pending_sent size:", ft_pending_sent.size);
      }
    }
  }

  function dismissSent(transfer_id: string): void {
    const sent = new Map(ft_sent);
    sent.delete(transfer_id);
    ft_sent = sent;
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
      room_id = generateId();
      history.replaceState(null, "", roomPath(room_id));
    }
    room_token = ensureToken();
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

  let copy_url_feedback = $state(false);

  function copyRoomUrl(): void {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        copy_url_feedback = true;
        setTimeout(() => {
          copy_url_feedback = false;
        }, 1500);
      })
      .catch(() => {
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
    data_channels.forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(msg);
      }
    });
  }

  function registerDataChannel(remote_peer_id: string, channel: RTCDataChannel): void {
    data_channels.set(remote_peer_id, channel);

    const send_initial_state = (): void => {
      channel.send(JSON.stringify({ type: "identity", handle: local_handle }));
      // Let the new peer know our current voice state immediately.
      if (voice_active) {
        channel.send(JSON.stringify({ type: "voice-start", handle: local_handle }));
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
        } else if (msg.type === "voice-start" && typeof msg.handle === "string") {
          const was_anyone_calling = remote_voice_active.size > 0;
          remote_voice_active = new Map(remote_voice_active).set(remote_peer_id, msg.handle);
          // Reset so beforeAnswer can add our mic again on the next renegotiation.
          answerer_voice_added.delete(remote_peer_id);
          if (!was_anyone_calling && !voice_active) {
            addPeerToast(`${msg.handle} started a voice call`);
          }
          // If we are the offerer and already in a call, the answerer just joined.
          // Our original offer was sent before they had voice_active=true, so
          // beforeAnswerAddVoice returned early without adding their mic. Send a
          // fresh offer now so beforeAnswerAddVoice gets another chance to run.
          const joining_manager = peer_managers.get(remote_peer_id);
          if (joining_manager?.getIsOfferer() === true && voice_active) {
            joining_manager.sendRenegotiationOffer();
          }
        } else if (msg.type === "voice-stop") {
          const updated = new Map(remote_voice_active);
          updated.delete(remote_peer_id);
          remote_voice_active = updated;
          // Reset so the next call cycle can add our mic cleanly.
          answerer_voice_added.delete(remote_peer_id);
          // If we are the offerer for this peer, trigger a renegotiation to remove
          // the answerer's audio from the SDP. Without this, the answerer's removeTrack()
          // fires onnegotiationneeded on their side where there is no handler, leaving
          // the SDP out of sync.
          const manager = peer_managers.get(remote_peer_id);
          if (manager?.getIsOfferer() === true) {
            manager.removeAudioTracks();
          }
          // If this was the last peer in the call, auto-stop so our icon returns to
          // inactive. Without this, voice_active stays true and the icon stays green
          // even though there is nobody left to talk to.
          if (updated.size === 0 && voice_active) {
            stopVoice();
          }
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
    localStorage.setItem(`${CHAT_LOG_PREFIX}${room_id}`, JSON.stringify(chat_messages));
  }

  function sendChatMessage(text: string): void {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      handle: local_handle,
      text,
      timestamp: Date.now(),
      is_local: true,
    };
    chat_messages = [...chat_messages, message];
    saveChatLog();
    const payload = JSON.stringify({
      type: "chat",
      id: message.id,
      handle: message.handle,
      text: message.text,
      timestamp: message.timestamp,
    });
    data_channels.forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(payload);
      }
    });
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
  // Voice call
  // ---------------------------------------------------------------------------

  async function startVoice(): Promise<void> {
    try {
      local_voice_stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      connection_store.setError("Microphone permission denied or unavailable");
      return;
    }
    voice_active = true;
    // Notify all connected peers that we're starting a voice call.
    const voice_start_msg = JSON.stringify({ type: "voice-start", handle: local_handle });
    data_channels.forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(voice_start_msg);
      }
    });
    // Add mic track to each connected peer where we are the offerer —
    // adding a track triggers onnegotiationneeded, which creates a new offer.
    // Answerer peers get their own mic added via the beforeAnswer hook.
    for (const [peer_id, manager] of peer_managers) {
      if (peer_states.get(peer_id) === "connected" && manager.getIsOfferer()) {
        for (const track of local_voice_stream.getTracks()) {
          manager.addTrack(track, local_voice_stream);
        }
      }
    }
  }

  function stopVoice(): void {
    voice_active = false;
    // Notify all connected peers that we're ending the voice call.
    const voice_stop_msg = JSON.stringify({ type: "voice-stop" });
    data_channels.forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(voice_stop_msg);
      }
    });
    // Remove all audio tracks from every peer connection — covers both the
    // offerer (tracks added via addTrack) and answerer (tracks added via beforeAnswer).
    for (const manager of peer_managers.values()) {
      manager.removeAudioTracks();
    }
    answerer_voice_added.clear();
    // Clear remote voice active state so the icon returns to inactive (not ringing).
    remote_voice_active = new Map();
    // Clear audio-received tracking so the next call starts in "connecting" state.
    peers_with_audio = new Set();
    // Stop the local mic.
    local_voice_stream?.getTracks().forEach((track) => track.stop());
    local_voice_stream = null;
    // Detach remote audio.
    for (const audio_el of remote_audio_nodes.values()) {
      audio_el.srcObject = null;
      audio_el.remove();
    }
    remote_audio_nodes.clear();
  }

  async function toggleVoice(): Promise<void> {
    if (voice_active) {
      stopVoice();
    } else {
      await startVoice();
    }
  }

  function handleRemoteTrack(peer_id: string, event: RTCTrackEvent): void {
    if (event.streams.length === 0) {
      return;
    }
    let audio_el = remote_audio_nodes.get(peer_id);
    if (audio_el === undefined) {
      audio_el = document.createElement("audio");
      audio_el.autoplay = true;
      document.body.appendChild(audio_el);
      remote_audio_nodes.set(peer_id, audio_el);
    }
    audio_el.srcObject = event.streams[0];
    // Mark this peer as having delivered audio — transitions icon from connecting → active.
    peers_with_audio = new Set(peers_with_audio).add(peer_id);
  }

  async function beforeAnswerAddVoice(peer_id: string, pc: RTCPeerConnection): Promise<void> {
    // Only add our mic when:
    // 1. We have voice active (user clicked the phone button)
    // 2. The remote peer also has voice active (they sent voice-start)
    //    — this prevents auto-adding during a hang-up renegotiation where the
    //    offerer removed their tracks but voice-stop already cleared remote_voice_active
    // 3. We haven't already added our mic for this peer in the current call cycle
    if (
      !voice_active ||
      local_voice_stream === null ||
      !remote_voice_active.has(peer_id) ||
      answerer_voice_added.has(peer_id)
    ) {
      return;
    }
    for (const track of local_voice_stream.getTracks()) {
      pc.addTrack(track, local_voice_stream);
    }
    answerer_voice_added.add(peer_id);
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
    const departed_handle = remote_handles.get(remote_peer_id);
    data_channels.delete(remote_peer_id);
    const updated_handles = new Map(remote_handles);
    updated_handles.delete(remote_peer_id);
    remote_handles = updated_handles;
    // Clean up voice resources for this peer.
    answerer_voice_added.delete(remote_peer_id);
    if (remote_voice_active.has(remote_peer_id)) {
      const updated = new Map(remote_voice_active);
      updated.delete(remote_peer_id);
      remote_voice_active = updated;
    }
    if (peers_with_audio.has(remote_peer_id)) {
      const updated = new Set(peers_with_audio);
      updated.delete(remote_peer_id);
      peers_with_audio = updated;
    }
    const audio_el = remote_audio_nodes.get(remote_peer_id);
    if (audio_el !== undefined) {
      audio_el.srcObject = null;
      audio_el.remove();
      remote_audio_nodes.delete(remote_peer_id);
    }
    connection_store.removeRemotePeer(remote_peer_id);
    manager.close();
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
        onTrack(event) {
          handleRemoteTrack(remote_peer_id, event);
        },
        async beforeAnswer(pc) {
          await beforeAnswerAddVoice(remote_peer_id, pc);
        },
      },
      undefined,
      getEffectiveIceServers(),
    );

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
    const using_default_turn =
      turn_url === RTC_CONFIG_DEFAULTS.turn_url &&
      turn_username === RTC_CONFIG_DEFAULTS.turn_username &&
      turn_credential === RTC_CONFIG_DEFAULTS.turn_credential;
    if (using_default_turn) {
      return ICE_SERVERS;
    }
    if (turn_url === "") {
      return [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
    }
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
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
      peer_states.get(active_qr_session_id) !== "connected"
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
                  if (peer_managers.has(session_id)) {
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
        onError(error) {
          connection_store.setError(error.message);
        },
        onTrack(event) {
          handleRemoteTrack(session_id, event);
        },
        async beforeAnswer(pc_arg) {
          await beforeAnswerAddVoice(session_id, pc_arg);
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
      id: "nearby-room",
      label: "Connect to nearby device",
      group: "Connect",
      keywords: ["geo", "location", "proximity", "local"],
      action: selectNearby,
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
  const show_actions = $derived(!$focus_mode_store && !code_mode);
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
      </div>
      <div class="header-right">
        {#if $persistence_store}
          <span
            class="persist-indicator"
            title="localStorage persistence is on"
            aria-label="Persistence active">●</span
          >
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
        <!-- Sun / moon — visible light/dark toggle -->
        <button
          class="icon-btn"
          onclick={() => { theme_store.setBuiltIn(is_dark_theme ? "light" : "dark"); }}
          title={is_dark_theme ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={is_dark_theme ? "Switch to light mode" : "Switch to dark mode"}
        >
          {#if is_dark_theme}
            <!-- sun -->
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          {:else}
            <!-- moon -->
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          {/if}
        </button>
        <button
          class="icon-btn"
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
      <span class="room-id">{room_id}</span>
      <button
        class="copy-btn"
        class:active={copy_url_feedback}
        onclick={copyRoomUrl}
        title={copy_url_feedback ? "Copied!" : "Copy room URL"}
        aria-label="Copy room link"
      >
        {#if copy_url_feedback}
          <!-- checkmark -->
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        {:else}
          <!-- copy (two overlapping pages, Lucide style) -->
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        {/if}
      </button>
      <button
        class="copy-btn"
        onclick={() => { show_url_qr = true; }}
        title="Display current URL as QR code"
        aria-label="Display current URL as QR code"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="1" y="1" width="4" height="4" rx="0.5"></rect>
          <rect x="9" y="1" width="4" height="4" rx="0.5"></rect>
          <rect x="1" y="9" width="4" height="4" rx="0.5"></rect>
          <rect x="2.5" y="2.5" width="1" height="1" fill="currentColor" stroke="none"></rect>
          <rect x="10.5" y="2.5" width="1" height="1" fill="currentColor" stroke="none"></rect>
          <rect x="2.5" y="10.5" width="1" height="1" fill="currentColor" stroke="none"></rect>
          <path d="M9 9h1.5v1.5"></path>
          <path d="M12 9v1.5H13"></path>
          <path d="M9 12h1.5v1"></path>
          <path d="M12 12.5h1"></path>
        </svg>
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
          title={show_chat ? "Back to document" : "Toggle chat"}
          aria-label={show_chat ? "Back to document" : `Toggle chat${chat_unread > 0 ? ` (${chat_unread} unread)` : ""}`}
          aria-pressed={show_chat}
        >
          {#if show_chat}
            <!-- document icon — indicates clicking returns to the editor -->
            <svg width="13" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          {:else}
            <!-- speech bubble icon — indicates clicking opens chat -->
            <svg width="15" height="14" viewBox="0 0 16 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3l3 3 3-3h3a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1z"/>
            </svg>
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
        <!-- phone (Lucide) — single icon for all states -->
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.35 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
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

  <!-- Editor (+ optional preview / chat pane) -->
  <main class:preview-split={show_preview && !show_chat} class:chat-split={show_chat}>
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
          onclick={() => {
            focus_mode_store.toggle();
            code_mode = false;
          }}
          title={$focus_mode_store ? "Exit focus mode" : "Enter focus mode"}
          aria-label={$focus_mode_store
            ? "Exit focus mode"
            : "Enter focus mode"}
        >
          {$focus_mode_store ? "✕" : "⛶"}
        </button>
      {/if}
      <button
        class="corner-btn"
        class:active={code_mode}
        onclick={() => {
          code_mode = !code_mode;
          if (code_mode) {
            focus_mode_store.disable();
          }
        }}
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
        <button class="action-btn" onclick={connectViaQr} title="Add peer via QR">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="1" y="1" width="4" height="4" rx="0.5"></rect>
            <rect x="9" y="1" width="4" height="4" rx="0.5"></rect>
            <rect x="1" y="9" width="4" height="4" rx="0.5"></rect>
            <rect x="2.5" y="2.5" width="1" height="1" fill="currentColor" stroke="none"></rect>
            <rect x="10.5" y="2.5" width="1" height="1" fill="currentColor" stroke="none"></rect>
            <rect x="2.5" y="10.5" width="1" height="1" fill="currentColor" stroke="none"></rect>
            <path d="M9 9h1.5v1.5"></path>
            <path d="M12 9v1.5H13"></path>
            <path d="M9 12h1.5v1"></path>
            <path d="M12 12.5h1"></path>
          </svg>
          <span class="btn-text">Add peer via QR</span>
        </button>
        <button class="action-btn" onclick={handleDisconnect} title="Disconnect">
          <svg class="btn-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 10L10 6"></path>
            <path d="M4.5 12.5 A4.5 4.5 0 0 1 4.5 5.5 L6 7"></path>
            <path d="M11.5 3.5 A4.5 4.5 0 0 1 11.5 10.5 L10 9"></path>
          </svg>
          <span class="btn-text">Disconnect</span>
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
      connection_error={qr_connection_error}
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex-shrink: 1;
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

  .chat-btn-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
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

  .actions-menu-wrapper,
  .info-menu-wrapper {
    position: relative;
  }

  /* Overrides the .connect-menu defaults — rendered at app root with fixed positioning */
  .actions-menu,
  .info-menu {
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

  /* Shared pane styles for non-split mode */
  .editor-pane {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .btn-icon {
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
