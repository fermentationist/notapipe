import * as Y from "yjs";
import * as sync_protocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

// y-protocols message type discriminators
const MESSAGE_SYNC = 0;

// ---------------------------------------------------------------------------
// RTCDataChannelProvider
// ---------------------------------------------------------------------------

/**
 * Custom Yjs WebRTC provider.
 * Connects a Y.Doc to a peer via an RTCDataChannel using y-protocols/sync.
 *
 * Lifecycle:
 *   1. Construct with a Y.Doc and a connected RTCDataChannel.
 *   2. Call connect() when the data channel is open, or pass an already-open channel.
 *   3. Call destroy() to unsubscribe and clean up.
 */
export class RTCDataChannelProvider {
  private doc: Y.Doc;
  private channel: RTCDataChannel;
  private update_handler: (update: Uint8Array, origin: unknown) => void;

  constructor(doc: Y.Doc, channel: RTCDataChannel) {
    this.doc = doc;
    this.channel = channel;

    this.update_handler = (update: Uint8Array, origin: unknown) => {
      if (origin === this) {
        return; // Don't re-broadcast our own applied updates
      }
      this.sendUpdate(update);
    };

    if (channel.readyState === "open") {
      this.initialize();
    } else {
      channel.addEventListener("open", () => this.initialize(), { once: true });
    }

    channel.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      this.handleMessage(new Uint8Array(event.data));
    });

    channel.addEventListener("close", () => {
      this.destroy();
    });
  }

  destroy(): void {
    this.doc.off("update", this.update_handler);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private initialize(): void {
    this.doc.on("update", this.update_handler);
    this.sendSyncStep1();
  }

  /**
   * Send sync step 1: our state vector.
   * The remote peer will reply with sync step 2 (all updates we're missing).
   */
  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    sync_protocol.writeSyncStep1(encoder, this.doc);
    this.sendEncoded(encoder);
  }

  private sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    sync_protocol.writeUpdate(encoder, update);
    this.sendEncoded(encoder);
  }

  private sendEncoded(encoder: encoding.Encoder): void {
    if (this.channel.readyState === "open") {
      this.channel.send(encoding.toUint8Array(encoder));
    }
  }

  private handleMessage(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const message_type = decoding.readVarUint(decoder);

    if (message_type === MESSAGE_SYNC) {
      const reply_encoder = encoding.createEncoder();
      encoding.writeVarUint(reply_encoder, MESSAGE_SYNC);
      const has_reply = sync_protocol.readSyncMessage(
        decoder,
        reply_encoder,
        this.doc,
        this, // origin — prevents re-broadcasting our own applied updates
      );
      if (has_reply) {
        this.sendEncoded(reply_encoder);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Textarea ↔ Y.Text binding
// ---------------------------------------------------------------------------

/**
 * Apply a textarea value change to a Y.Text using a prefix/suffix diff.
 * Zero dependencies beyond Yjs — avoids diff libraries.
 *
 * Algorithm:
 *   1. Walk forward while old[i] === new[i] to find the common prefix length.
 *   2. Walk backward while old[end-j] === new[end-j] to find the common suffix length.
 *   3. Delete the differing middle from Y.Text, then insert the new middle.
 */
/**
 * Return true if the character at `index` in `str` is a UTF-16 high surrogate.
 * High surrogates occupy the range 0xD800–0xDBFF and are the first half of a
 * surrogate pair encoding a supplementary code point (e.g. most emoji).
 */
function isHighSurrogate(str: string, index: number): boolean {
  const code = str.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

export function applyTextareaDiff(
  ytext: Y.Text,
  doc: Y.Doc,
  old_value: string,
  new_value: string,
): void {
  // Yjs indexes by UTF-16 code units (same as JavaScript's string .length).
  // Walk forward while code units match.
  let prefix_length = 0;
  while (
    prefix_length < old_value.length &&
    prefix_length < new_value.length &&
    old_value[prefix_length] === new_value[prefix_length]
  ) {
    prefix_length++;
  }
  // Don't stop in the middle of a surrogate pair — back up if we ended on a high surrogate.
  if (prefix_length > 0 && isHighSurrogate(old_value, prefix_length - 1)) {
    prefix_length--;
  }

  // Walk backward while code units match, staying within the non-prefix region.
  let suffix_length = 0;
  while (
    suffix_length < old_value.length - prefix_length &&
    suffix_length < new_value.length - prefix_length &&
    old_value[old_value.length - 1 - suffix_length] ===
      new_value[new_value.length - 1 - suffix_length]
  ) {
    suffix_length++;
  }
  // Don't stop in the middle of a surrogate pair — back up if we ended on a low surrogate.
  // A low surrogate (0xDC00–0xDFFF) must always follow a high surrogate.
  if (suffix_length > 0) {
    const suffix_start_old = old_value.length - suffix_length;
    const code = old_value.charCodeAt(suffix_start_old);
    if (code >= 0xdc00 && code <= 0xdfff) {
      suffix_length--;
    }
  }

  const delete_count = old_value.length - prefix_length - suffix_length;
  const insert_text = new_value.slice(prefix_length, new_value.length - suffix_length);

  doc.transact(() => {
    if (delete_count > 0) {
      ytext.delete(prefix_length, delete_count);
    }
    if (insert_text.length > 0) {
      ytext.insert(prefix_length, insert_text);
    }
  });
}
