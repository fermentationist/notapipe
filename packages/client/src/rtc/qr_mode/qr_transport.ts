// QrTransport — SignalTransport implementation for air-gapped QR mode.
//
// Flow (offerer side):
//   1. startAsOfferer() in peer.ts calls createOffer() + setLocalDescription()
//   2. QR mode waits for iceGatheringState === "complete" (ICE_GATHERING_TIMEOUT_MS timeout)
//   3. Encodes the full SDP (with all candidates) into a binary packet via sdp_codec
//   4. Renders the packet as a QR code on a canvas
//   5. Waits for the user to scan the answerer's QR
//
// Flow (answerer side):
//   1. User scans the offerer's QR → binary packet → decoded SDP
//   2. transport.onOffer fires with the decoded SDP
//   3. peer.ts creates an answer, sets local description, waits for ICE gathering
//   4. Encodes the answer and renders as a QR for the offerer to scan
//
// Note: trickle ICE is NOT used in QR mode. The full gathered SDP is encoded once.

import type { SignalTransport } from "../peer.ts";
import { encodeSdp, decodeSdp } from "./sdp_codec.ts";
import { QR_ICE_GATHERING_TIMEOUT_MS } from "$lib/constants/rtc.ts";

type OfferCallback = (sdp: RTCSessionDescriptionInit) => void;
type AnswerCallback = (sdp: RTCSessionDescriptionInit) => void;
type IceCandidateCallback = (candidate: RTCIceCandidate) => void;

export interface QrTransportCallbacks {
  /** Called when the QR code packet is ready to render */
  onQrPacketReady: (packet: Uint8Array) => void;
  onError: (error: Error) => void;
}

export class QrTransport implements SignalTransport {
  private readonly peer_connection: RTCPeerConnection;
  private readonly callbacks: QrTransportCallbacks;
  private readonly room_id: string;
  private room_token: string;

  private offer_callback: OfferCallback | null = null;
  private answer_callback: AnswerCallback | null = null;
  // ICE candidates are not sent individually in QR mode — they accumulate in the SDP
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _ice_candidate_callback: IceCandidateCallback | null = null;

  constructor(
    peer_connection: RTCPeerConnection,
    callbacks: QrTransportCallbacks,
    room_id: string,
    room_token: string,
  ) {
    this.peer_connection = peer_connection;
    this.callbacks = callbacks;
    this.room_id = room_id;
    this.room_token = room_token;
  }

  /** Update the token — called by the answerer after scanning the offerer's QR to adopt their token. */
  setToken(token: string): void {
    this.room_token = token;
  }

  // ---------------------------------------------------------------------------
  // SignalTransport implementation
  // ---------------------------------------------------------------------------

  sendOffer(sdp: RTCSessionDescriptionInit): void {
    this.waitForIceGatheringAndEncode(sdp, false);
  }

  sendAnswer(sdp: RTCSessionDescriptionInit): void {
    this.waitForIceGatheringAndEncode(sdp, true);
  }

  /** No-op in QR mode — ICE candidates are embedded in the full SDP */
  sendIceCandidate(_candidate: RTCIceCandidate): void {
    // Intentional no-op: QR mode waits for gathering complete before encoding
  }

  onOffer(callback: OfferCallback): void {
    this.offer_callback = callback;
  }

  onAnswer(callback: AnswerCallback): void {
    this.answer_callback = callback;
  }

  onIceCandidate(callback: IceCandidateCallback): void {
    this._ice_candidate_callback = callback;
  }

  close(): void {
    // Nothing to clean up — no persistent connection
  }

  // ---------------------------------------------------------------------------
  // Called by the scanner when a QR packet is decoded from the camera
  // ---------------------------------------------------------------------------

  receiveScannedPacket(packet: Uint8Array): void {
    try {
      const { sdp, type } = decodeSdp(packet);
      console.log(
        `[QR scan] decoded ${type}, candidates:\n`,
        sdp.match(/a=candidate:[^\r\n]+/g)?.join("\n") ?? "(none)",
      );
      const sdp_init: RTCSessionDescriptionInit = { type, sdp };
      if (type === "offer") {
        this.offer_callback?.(sdp_init);
      } else {
        this.answer_callback?.(sdp_init);
      }
    } catch (error) {
      console.error("[QR scan] decode error:", error);
      this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private waitForIceGatheringAndEncode(sdp: RTCSessionDescriptionInit, is_answer: boolean): void {
    const pc = this.peer_connection;

    if (pc.iceGatheringState === "complete") {
      this.encodeCurrentSdp(is_answer);
      return;
    }

    let done = false;
    const timeout_id = setTimeout(() => {
      if (!done) {
        done = true;
        this.encodeCurrentSdp(is_answer);
      }
    }, QR_ICE_GATHERING_TIMEOUT_MS);

    const on_state_change = (): void => {
      if (!done && pc.iceGatheringState === "complete") {
        done = true;
        clearTimeout(timeout_id);
        pc.removeEventListener("icegatheringstatechange", on_state_change);
        this.encodeCurrentSdp(is_answer);
      }
    };
    pc.addEventListener("icegatheringstatechange", on_state_change);
  }

  private encodeCurrentSdp(is_answer: boolean): void {
    const local_description = this.peer_connection.localDescription;
    if (local_description === null || local_description.sdp === "") {
      this.callbacks.onError(new Error("No local description available for QR encoding"));
      return;
    }
    try {
      const packet = encodeSdp(local_description.sdp, is_answer, this.room_id, this.room_token);
      this.callbacks.onQrPacketReady(packet);
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
