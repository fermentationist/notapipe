import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ICE_RESTART_TIMEOUT_MS,
  VISIBILITY_PONG_WAIT_MS,
} from "$lib/constants/rtc.ts";
import type { RTCPeerManager, PeerManagerState } from "./peer.ts";

// ---------------------------------------------------------------------------
// Message types sent over the data channel for heartbeat / keepalive
// ---------------------------------------------------------------------------

export const HEARTBEAT_PING = "__ping";
export const HEARTBEAT_PONG = "__pong";

// ---------------------------------------------------------------------------
// ConnectionManager
// ---------------------------------------------------------------------------

/**
 * Per-peer connection watchdog for signalling-mode peers.
 *
 * Responsibilities:
 *  - Heartbeat: ping over the data channel every HEARTBEAT_INTERVAL_MS;
 *    if no pong arrives within HEARTBEAT_TIMEOUT_MS, trigger ICE restart.
 *  - Visibility probe: when the page becomes visible after being backgrounded,
 *    send a probe ping and wait VISIBILITY_PONG_WAIT_MS; if no pong, restart ICE.
 *  - ICE restart timeout: if the connection doesn't recover within
 *    ICE_RESTART_TIMEOUT_MS after a restart attempt, call on_give_up().
 *  - State routing: onStateChange("disconnected") after first connect → restart;
 *    "failed" after first connect → give up immediately.
 *
 * Not used in QR mode — QR connections have no signalling channel to restart
 * through, so the only recovery path is a full teardown.
 */
export class ConnectionManager {
  private peer_manager: RTCPeerManager;
  private is_offerer: boolean;
  private on_give_up: () => void;

  private data_channel: RTCDataChannel | null = null;

  private was_ever_connected = false;
  private last_pong_at = 0;

  private heartbeat_interval_id: ReturnType<typeof setInterval> | null = null;
  private give_up_timeout_id: ReturnType<typeof setTimeout> | null = null;
  private visibility_probe_timeout_id: ReturnType<typeof setTimeout> | null = null;

  private destroyed = false;

  private bound_visibility_handler: () => void;

  constructor(peer_manager: RTCPeerManager, is_offerer: boolean, on_give_up: () => void) {
    this.peer_manager = peer_manager;
    this.is_offerer = is_offerer;
    this.on_give_up = on_give_up;

    this.bound_visibility_handler = this.handleVisibilityChange.bind(this);
    document.addEventListener("visibilitychange", this.bound_visibility_handler);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Called by App.svelte's registerDataChannel once the data channel is open
   * (or immediately if it is already open). Starts the heartbeat loop.
   */
  setDataChannel(channel: RTCDataChannel): void {
    if (this.destroyed) {
      return;
    }
    this.data_channel = channel;
    this.last_pong_at = Date.now();

    if (channel.readyState === "open") {
      this.startHeartbeat();
    } else {
      channel.addEventListener(
        "open",
        () => {
          this.startHeartbeat();
        },
        { once: true },
      );
    }
  }

  /**
   * Called by App.svelte's onStateChange callback for this peer.
   * Returns true if the manager handled the state and the caller should NOT
   * proceed with its default action (e.g. immediate disconnectPeer).
   */
  onStateChange(state: PeerManagerState): boolean {
    if (this.destroyed) {
      return false;
    }

    if (state === "connected") {
      this.was_ever_connected = true;
      this.cancelGiveUp();
      return false; // caller still records the connected state
    }

    if (!this.was_ever_connected) {
      return false; // initial connection failure — caller handles it
    }

    if (state === "disconnected") {
      // Transient — ICE restart can recover this.
      this.triggerIceRestart();
      return true; // suppress immediate disconnectPeer
    }

    if (state === "failed") {
      // Terminal — give up immediately.
      this.giveUp();
      return true;
    }

    return false;
  }

  /**
   * Route an incoming data-channel message through the manager.
   * Returns true if the message was a heartbeat control message (caller should
   * not pass it to other handlers).
   */
  handleDataMessage(message_type: string): boolean {
    if (this.destroyed) {
      return false;
    }

    if (message_type === HEARTBEAT_PING) {
      this.sendPong();
      return true;
    }

    if (message_type === HEARTBEAT_PONG) {
      this.last_pong_at = Date.now();
      return true;
    }

    return false;
  }

  /**
   * Tear down all timers and event listeners. Must be called when the peer is
   * disconnected (regardless of whether the manager triggered the disconnect).
   */
  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    this.cancelGiveUp();
    this.clearVisibilityProbe();
    document.removeEventListener("visibilitychange", this.bound_visibility_handler);
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    if (this.destroyed || this.heartbeat_interval_id !== null) {
      return;
    }
    this.last_pong_at = Date.now();
    this.heartbeat_interval_id = setInterval(() => {
      this.heartbeatTick();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat_interval_id !== null) {
      clearInterval(this.heartbeat_interval_id);
      this.heartbeat_interval_id = null;
    }
  }

  private heartbeatTick(): void {
    if (this.destroyed) {
      return;
    }
    this.sendPing();
    const elapsed = Date.now() - this.last_pong_at;
    if (elapsed > HEARTBEAT_TIMEOUT_MS) {
      console.warn(
        `[ConnectionManager] heartbeat timeout (${elapsed}ms since last pong) — restarting ICE`,
      );
      this.triggerIceRestart();
    }
  }

  private sendPing(): void {
    this.sendDataMessage(HEARTBEAT_PING);
  }

  private sendPong(): void {
    this.sendDataMessage(HEARTBEAT_PONG);
  }

  private sendDataMessage(type: string): void {
    const channel = this.data_channel;
    if (channel === null || channel.readyState !== "open") {
      return;
    }
    try {
      channel.send(JSON.stringify({ type }));
    } catch {
      // Data channel may have closed between the readyState check and send().
      // The heartbeat timeout will catch the silence.
    }
  }

  // ---------------------------------------------------------------------------
  // Page Visibility
  // ---------------------------------------------------------------------------

  private handleVisibilityChange(): void {
    if (document.visibilityState !== "visible" || this.destroyed) {
      return;
    }
    // Page just became visible (phone unlocked / browser tab re-focused).
    // Send a probe ping; if we don't hear a pong in time, restart ICE.
    this.clearVisibilityProbe();
    const pong_at_probe = this.last_pong_at;
    this.sendPing();
    this.visibility_probe_timeout_id = setTimeout(() => {
      this.visibility_probe_timeout_id = null;
      if (this.destroyed) {
        return;
      }
      if (this.last_pong_at === pong_at_probe) {
        console.warn("[ConnectionManager] visibility probe: no pong received — restarting ICE");
        this.triggerIceRestart();
      }
    }, VISIBILITY_PONG_WAIT_MS);
  }

  private clearVisibilityProbe(): void {
    if (this.visibility_probe_timeout_id !== null) {
      clearTimeout(this.visibility_probe_timeout_id);
      this.visibility_probe_timeout_id = null;
    }
  }

  // ---------------------------------------------------------------------------
  // ICE restart & give-up
  // ---------------------------------------------------------------------------

  private triggerIceRestart(): void {
    if (this.destroyed) {
      return;
    }
    if (this.give_up_timeout_id !== null) {
      return; // restart already in progress
    }
    if (this.is_offerer) {
      console.log("[ConnectionManager] triggering ICE restart");
      this.peer_manager.restartIce();
    }
    // Whether we're the offerer or answerer, arm the give-up timer.
    // The answerer can't restart ICE, but it still needs to give up if the
    // offerer's restart doesn't produce a new connection within the window.
    this.give_up_timeout_id = setTimeout(() => {
      this.give_up_timeout_id = null;
      if (!this.destroyed) {
        console.warn("[ConnectionManager] ICE restart timed out — giving up");
        this.giveUp();
      }
    }, ICE_RESTART_TIMEOUT_MS);
  }

  private cancelGiveUp(): void {
    if (this.give_up_timeout_id !== null) {
      clearTimeout(this.give_up_timeout_id);
      this.give_up_timeout_id = null;
    }
  }

  private giveUp(): void {
    if (this.destroyed) {
      return;
    }
    this.destroy();
    this.on_give_up();
  }
}
