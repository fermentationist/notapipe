// ---------------------------------------------------------------------------
// FileTransferManager — binary file transfer over a dedicated RTCDataChannel
// ---------------------------------------------------------------------------
//
// Protocol (JSON messages):
//   sender → receiver:  { type: "offer",  transfer_id, filename, mime_type, total_size, chunk_count }
//   receiver → sender:  { type: "accept", transfer_id }
//   receiver → sender:  { type: "decline", transfer_id }
//   sender → receiver:  { type: "chunk",  transfer_id, index } + binary payload appended
//   sender → receiver:  { type: "done",   transfer_id }
//   either → either:    { type: "cancel", transfer_id }
//
// Binary framing for chunk messages:
//   [4 bytes: JSON header length (big-endian uint32)][JSON header bytes][chunk bytes]
//
// Backpressure: pause chunking when channel.bufferedAmount > BUFFER_HIGH_WATER,
// resume on the "bufferedamountlow" event.

export const FILE_TRANSFER_CHANNEL_LABEL = "files";

const CHUNK_SIZE_BYTES = 16_384; // 16 KB
const BUFFER_HIGH_WATER = 2_097_152; // 2 MB — pause sending above this
const BUFFER_LOW_WATER = 262_144; // 256 KB — resume sending below this
const MAX_FILE_SIZE_BYTES = 104_857_600; // 100 MB

export interface IncomingOffer {
  transfer_id: string;
  filename: string;
  mime_type: string;
  total_size: number;
  chunk_count: number;
}

export interface FileTransferCallbacks {
  onIncomingOffer: (offer: IncomingOffer) => void;
  onProgress: (transfer_id: string, received_chunks: number, total_chunks: number) => void;
  onFileReceived: (transfer_id: string, blob: Blob, filename: string, mime_type: string) => void;
  onFileSent: (transfer_id: string) => void;
  onTransferAccepted: (transfer_id: string) => void;
  onTransferCancelled: (transfer_id: string) => void;
  onError: (message: string) => void;
}

interface OutgoingTransfer {
  file: File;
  transfer_id: string;
  chunk_count: number;
  next_chunk_index: number;
  paused: boolean;
  cancelled: boolean;
}

interface IncomingTransfer {
  offer: IncomingOffer;
  chunks: (ArrayBuffer | null)[];
  received_count: number;
}

type ControlMessage =
  | {
      type: "offer";
      transfer_id: string;
      filename: string;
      mime_type: string;
      total_size: number;
      chunk_count: number;
    }
  | { type: "accept"; transfer_id: string }
  | { type: "decline"; transfer_id: string }
  | { type: "done"; transfer_id: string }
  | { type: "cancel"; transfer_id: string };

export class FileTransferManager {
  private channel: RTCDataChannel;
  private callbacks: FileTransferCallbacks;
  private outgoing = new Map<string, OutgoingTransfer>();
  private incoming = new Map<string, IncomingTransfer>();

  constructor(channel: RTCDataChannel, callbacks: FileTransferCallbacks) {
    this.channel = channel;
    this.callbacks = callbacks;

    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;

    channel.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
      this.handleMessage(event.data);
    });

    channel.addEventListener("bufferedamountlow", () => {
      this.resumePausedTransfers();
    });
  }

  destroy(): void {
    this.outgoing.clear();
    this.incoming.clear();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  sendFile(file: File): string | null {
    if (this.channel.readyState !== "open") {
      this.callbacks.onError("Data channel is not open");
      return null;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      this.callbacks.onError(
        `File exceeds the 100 MB limit (${(file.size / 1_048_576).toFixed(1)} MB)`,
      );
      return null;
    }

    const transfer_id = crypto.randomUUID();
    const chunk_count = Math.ceil(file.size / CHUNK_SIZE_BYTES) || 1;

    this.outgoing.set(transfer_id, {
      file,
      transfer_id,
      chunk_count,
      next_chunk_index: 0,
      paused: false,
      cancelled: false,
    });

    this.sendControl({
      type: "offer",
      transfer_id,
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      total_size: file.size,
      chunk_count,
    });

    return transfer_id;
  }

  acceptTransfer(transfer_id: string): void {
    if (this.incoming.has(transfer_id)) {
      this.sendControl({ type: "accept", transfer_id });
    }
  }

  declineTransfer(transfer_id: string): void {
    this.incoming.delete(transfer_id);
    this.sendControl({ type: "decline", transfer_id });
  }

  cancelTransfer(transfer_id: string): void {
    const outgoing = this.outgoing.get(transfer_id);
    if (outgoing) {
      outgoing.cancelled = true;
      this.outgoing.delete(transfer_id);
    }
    this.incoming.delete(transfer_id);
    this.sendControl({ type: "cancel", transfer_id });
  }

  // ---------------------------------------------------------------------------
  // Internal — sending
  // ---------------------------------------------------------------------------

  private sendControl(message: ControlMessage): void {
    if (this.channel.readyState !== "open") {
      return;
    }
    this.channel.send(JSON.stringify(message));
  }

  private async sendChunks(transfer_id: string): Promise<void> {
    const transfer = this.outgoing.get(transfer_id);
    if (!transfer) {
      return;
    }

    while (transfer.next_chunk_index < transfer.chunk_count && !transfer.cancelled) {
      if (this.channel.bufferedAmount > BUFFER_HIGH_WATER) {
        transfer.paused = true;
        return; // will resume from bufferedamountlow event
      }

      const byte_offset = transfer.next_chunk_index * CHUNK_SIZE_BYTES;
      const slice = transfer.file.slice(byte_offset, byte_offset + CHUNK_SIZE_BYTES);
      const chunk_data = await slice.arrayBuffer();

      if (transfer.cancelled) {
        return;
      }

      const header = JSON.stringify({
        type: "chunk",
        transfer_id,
        index: transfer.next_chunk_index,
      });
      const header_bytes = new TextEncoder().encode(header);
      const frame = new ArrayBuffer(4 + header_bytes.byteLength + chunk_data.byteLength);
      const view = new DataView(frame);
      view.setUint32(0, header_bytes.byteLength, false); // big-endian
      new Uint8Array(frame, 4, header_bytes.byteLength).set(header_bytes);
      new Uint8Array(frame, 4 + header_bytes.byteLength).set(new Uint8Array(chunk_data));

      if (this.channel.readyState !== "open") {
        return;
      }
      this.channel.send(frame);
      transfer.next_chunk_index++;
    }

    if (!transfer.cancelled) {
      this.outgoing.delete(transfer_id);
      this.sendControl({ type: "done", transfer_id });
      this.callbacks.onFileSent(transfer_id);
    }
  }

  private resumePausedTransfers(): void {
    for (const [transfer_id, transfer] of this.outgoing) {
      if (transfer.paused && !transfer.cancelled) {
        transfer.paused = false;
        this.sendChunks(transfer_id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal — receiving
  // ---------------------------------------------------------------------------

  private handleMessage(data: ArrayBuffer | string): void {
    if (typeof data === "string") {
      this.handleControl(data);
    } else {
      this.handleChunkFrame(data);
    }
  }

  private handleControl(raw: string): void {
    let message: ControlMessage;
    try {
      message = JSON.parse(raw) as ControlMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "offer": {
        const offer: IncomingOffer = {
          transfer_id: message.transfer_id,
          filename: message.filename,
          mime_type: message.mime_type,
          total_size: message.total_size,
          chunk_count: message.chunk_count,
        };
        this.incoming.set(message.transfer_id, {
          offer,
          chunks: new Array(message.chunk_count).fill(null) as null[],
          received_count: 0,
        });
        this.callbacks.onIncomingOffer(offer);
        break;
      }
      case "accept": {
        // Remote accepted our outgoing offer — notify then start sending chunks
        this.callbacks.onTransferAccepted(message.transfer_id);
        this.sendChunks(message.transfer_id);
        break;
      }
      case "decline": {
        this.outgoing.delete(message.transfer_id);
        this.callbacks.onTransferCancelled(message.transfer_id);
        break;
      }
      case "done": {
        this.assembleFile(message.transfer_id);
        break;
      }
      case "cancel": {
        this.outgoing.delete(message.transfer_id);
        this.incoming.delete(message.transfer_id);
        this.callbacks.onTransferCancelled(message.transfer_id);
        break;
      }
    }
  }

  private handleChunkFrame(buffer: ArrayBuffer): void {
    if (buffer.byteLength < 4) {
      return;
    }
    const view = new DataView(buffer);
    const header_length = view.getUint32(0, false);
    if (buffer.byteLength < 4 + header_length) {
      return;
    }

    const header_bytes = new Uint8Array(buffer, 4, header_length);
    let header: { type: string; transfer_id: string; index: number };
    try {
      header = JSON.parse(new TextDecoder().decode(header_bytes)) as typeof header;
    } catch {
      return;
    }

    if (header.type !== "chunk") {
      return;
    }

    const transfer = this.incoming.get(header.transfer_id);
    if (!transfer) {
      return;
    }

    const chunk_data = buffer.slice(4 + header_length);
    transfer.chunks[header.index] = chunk_data;
    transfer.received_count++;

    this.callbacks.onProgress(
      header.transfer_id,
      transfer.received_count,
      transfer.offer.chunk_count,
    );
  }

  private assembleFile(transfer_id: string): void {
    const transfer = this.incoming.get(transfer_id);
    if (!transfer) {
      return;
    }

    const valid_chunks = transfer.chunks.filter((c): c is ArrayBuffer => c !== null);
    if (valid_chunks.length !== transfer.offer.chunk_count) {
      this.callbacks.onError(
        `Incomplete transfer: received ${valid_chunks.length}/${transfer.offer.chunk_count} chunks`,
      );
      this.incoming.delete(transfer_id);
      return;
    }

    const blob = new Blob(valid_chunks, { type: transfer.offer.mime_type });
    this.incoming.delete(transfer_id);
    this.callbacks.onFileReceived(
      transfer_id,
      blob,
      transfer.offer.filename,
      transfer.offer.mime_type,
    );
  }
}
