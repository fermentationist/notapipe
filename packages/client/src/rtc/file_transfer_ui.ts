import { RELAY_FILE_SIZE_LIMIT_BYTES } from "$lib/constants/rtc.ts";
import type { FileTransferManager, IncomingOffer } from "./file_transfer.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A displayable entry for an outgoing file transfer strip. */
export interface FtPeerEntry {
  filename: string;
  handle: string;
}

// ---------------------------------------------------------------------------
// Dependency interface — injected by App.svelte
// ---------------------------------------------------------------------------

export interface FileTransferUIDeps {
  // Accessors for reactive state (always reflect current value at call time).
  get_incoming_offers(): Map<string, IncomingOffer>;
  get_progress(): Map<string, { received: number; total: number }>;
  get_completed(): Map<string, { url: string; filename: string }>;
  get_sent(): Map<string, FtPeerEntry>;
  get_sending(): Map<string, FtPeerEntry>;
  get_pending_sent(): Map<string, FtPeerEntry>;

  // Setters — App.svelte updates its $state vars when these are called.
  set_incoming_offers(value: Map<string, IncomingOffer>): void;
  set_progress(value: Map<string, { received: number; total: number }>): void;
  set_completed(value: Map<string, { url: string; filename: string }>): void;
  set_sent(value: Map<string, FtPeerEntry>): void;
  set_sending(value: Map<string, FtPeerEntry>): void;
  set_pending_sent(value: Map<string, FtPeerEntry>): void;

  // Connection state accessors.
  get_file_transfer_managers(): Map<string, FileTransferManager>;
  get_peer_relay_status(peer_id: string): boolean;
  has_custom_turn(): boolean;
  get_remote_handle(peer_id: string): string;

  // Side-effect callbacks.
  add_peer_toast(message: string): void;
  set_error(message: string): void;
}

// ---------------------------------------------------------------------------
// FileTransferUIManager
//
// Owns the non-reactive bookkeeping for file transfers (outgoing name/peer
// tracking) and all the logic for updating the reactive UI state maps.
// Reactive state lives in App.svelte; this class controls it entirely
// through the deps callbacks.
//
// Designed to be unit-testable: pass mock deps, call methods, assert callbacks.
// ---------------------------------------------------------------------------

export class FileTransferUIManager {
  // transfer_id → filename (for callbacks that receive only transfer_id)
  private outgoing_names = new Map<string, string>();
  // transfer_id → peer_id (so cancelTransfer hits the right manager)
  private transfer_to_peer = new Map<string, string>();

  constructor(private readonly deps: FileTransferUIDeps) {}

  // ---------------------------------------------------------------------------
  // Callbacks factory — passed to FileTransferManager at peer registration
  // ---------------------------------------------------------------------------

  /**
   * Returns the callbacks object to pass to FileTransferManager for a given peer.
   * Wires protocol-level events into reactive UI state updates.
   */
  make_callbacks(peer_id: string) {
    const d = this.deps;
    return {
      onIncomingOffer(offer: IncomingOffer): void {
        d.set_incoming_offers(
          new Map(d.get_incoming_offers()).set(offer.transfer_id, offer),
        );
      },
      onProgress(transfer_id: string, received: number, total: number): void {
        const next = new Map(d.get_progress());
        next.set(transfer_id, { received, total });
        d.set_progress(next);
        // Remove from incoming once we start receiving chunks.
        if (d.get_incoming_offers().has(transfer_id)) {
          const offers = new Map(d.get_incoming_offers());
          offers.delete(transfer_id);
          d.set_incoming_offers(offers);
        }
      },
      onFileReceived(transfer_id: string, blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const progress = new Map(d.get_progress());
        progress.delete(transfer_id);
        d.set_progress(progress);
        d.set_completed(
          new Map(d.get_completed()).set(transfer_id, { url, filename }),
        );
      },
      onTransferAccepted(transfer_id: string): void {
        const filename = d.get_sending().get(transfer_id)?.filename ?? "file";
        const handle = d.get_remote_handle(peer_id);
        const pending = new Map(d.get_pending_sent());
        pending.delete(transfer_id);
        d.set_pending_sent(pending);
        d.set_sending(
          new Map(d.get_sending()).set(transfer_id, { filename, handle }),
        );
      },
      onFileSent(transfer_id: string): void {
        const sending_entry = d.get_sending().get(transfer_id);
        const filename =
          sending_entry?.filename ?? "file";
        const handle = sending_entry?.handle ?? d.get_remote_handle(peer_id);
        const sending = new Map(d.get_sending());
        sending.delete(transfer_id);
        d.set_sending(sending);
        d.set_sent(
          new Map(d.get_sent()).set(transfer_id, { filename, handle }),
        );
      },
      onTransferCancelled(transfer_id: string): void {
        // Incoming-side cleanup.
        const offers = new Map(d.get_incoming_offers());
        offers.delete(transfer_id);
        d.set_incoming_offers(offers);
        const progress = new Map(d.get_progress());
        progress.delete(transfer_id);
        d.set_progress(progress);
        // Outgoing-side cleanup.
        const sending = new Map(d.get_sending());
        sending.delete(transfer_id);
        d.set_sending(sending);
        const pending = new Map(d.get_pending_sent());
        pending.delete(transfer_id);
        d.set_pending_sent(pending);
      },
      onError(message: string): void {
        d.set_error(message);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // UI actions
  // ---------------------------------------------------------------------------

  /** Accept an incoming file transfer offer. */
  accept(transfer_id: string): void {
    for (const manager of this.deps.get_file_transfer_managers().values()) {
      manager.acceptTransfer(transfer_id);
    }
    const offers = new Map(this.deps.get_incoming_offers());
    offers.delete(transfer_id);
    this.deps.set_incoming_offers(offers);
  }

  /** Decline an incoming file transfer offer. */
  decline(transfer_id: string): void {
    for (const manager of this.deps.get_file_transfer_managers().values()) {
      manager.declineTransfer(transfer_id);
    }
    const offers = new Map(this.deps.get_incoming_offers());
    offers.delete(transfer_id);
    this.deps.set_incoming_offers(offers);
  }

  /** Cancel an in-progress transfer (outgoing or incoming). */
  cancel(transfer_id: string): void {
    const peer_id = this.transfer_to_peer.get(transfer_id);
    if (peer_id !== undefined) {
      // Outgoing: cancel only the specific peer's manager.
      this.deps.get_file_transfer_managers().get(peer_id)?.cancelTransfer(transfer_id);
      this.transfer_to_peer.delete(transfer_id);
      this.outgoing_names.delete(transfer_id);
      const pending = new Map(this.deps.get_pending_sent());
      pending.delete(transfer_id);
      this.deps.set_pending_sent(pending);
      const sending = new Map(this.deps.get_sending());
      sending.delete(transfer_id);
      this.deps.set_sending(sending);
    } else {
      // Incoming: cancel across all managers (receiver doesn't track which one owns it).
      for (const manager of this.deps.get_file_transfer_managers().values()) {
        manager.cancelTransfer(transfer_id);
      }
      const progress = new Map(this.deps.get_progress());
      progress.delete(transfer_id);
      this.deps.set_progress(progress);
    }
  }

  /** Dismiss a completed (downloaded) file entry from the UI. */
  dismiss_completed(transfer_id: string): void {
    const completed = new Map(this.deps.get_completed());
    const entry = completed.get(transfer_id);
    if (entry !== undefined) {
      URL.revokeObjectURL(entry.url);
    }
    completed.delete(transfer_id);
    this.deps.set_completed(completed);
  }

  /** Dismiss a sent-confirmation entry from the UI. */
  dismiss_sent(transfer_id: string): void {
    const sent = new Map(this.deps.get_sent());
    sent.delete(transfer_id);
    this.deps.set_sent(sent);
  }

  /**
   * Send a file to all currently connected peers.
   * Enforces the relay file-size cap when no custom TURN server is configured.
   */
  send_to_all_peers(file: File): void {
    const has_custom_turn = this.deps.has_custom_turn();
    let showed_relay_warning = false;
    for (const [peer_id, manager] of this.deps.get_file_transfer_managers()) {
      const is_relayed = this.deps.get_peer_relay_status(peer_id);
      if (!has_custom_turn && is_relayed && file.size > RELAY_FILE_SIZE_LIMIT_BYTES) {
        if (!showed_relay_warning) {
          this.deps.add_peer_toast(
            `File too large for relayed connection (limit: ${RELAY_FILE_SIZE_LIMIT_BYTES / 1_048_576} MB). ` +
              "Add a TURN server in Settings → Connection to remove this limit.",
          );
          showed_relay_warning = true;
        }
        continue;
      }
      const transfer_id = manager.sendFile(file);
      if (transfer_id !== null) {
        const handle = this.deps.get_remote_handle(peer_id);
        this.outgoing_names.set(transfer_id, file.name);
        this.transfer_to_peer.set(transfer_id, peer_id);
        this.deps.set_pending_sent(
          new Map(this.deps.get_pending_sent()).set(transfer_id, {
            filename: file.name,
            handle,
          }),
        );
      }
    }
  }
}
