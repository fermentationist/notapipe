<script lang="ts">
  import QRCode from "qrcode";
  import { scanQr, startCamera, stopCamera } from "../../rtc/qr_mode/scanner.ts";

  interface Props {
    packet: Uint8Array | null;
    onscanned: (packet: Uint8Array) => void;
    onclose: () => void;
  }

  let { packet, onscanned, onclose }: Props = $props();

  let qr_canvas: HTMLCanvasElement = $state() as HTMLCanvasElement;
  let video_element: HTMLVideoElement = $state() as HTMLVideoElement;
  let step = $state<1 | 2>(1);
  let camera_stream: MediaStream | null = null;
  let scan_abort_controller: AbortController | null = null;
  let camera_error = $state<string | null>(null);

  // Render QR code when packet is ready
  $effect(() => {
    if (packet !== null && qr_canvas) {
      const binary_string = Array.from(packet, (byte) => String.fromCharCode(byte)).join("");
      QRCode.toCanvas(qr_canvas, binary_string, {
        errorCorrectionLevel: "L",
        // @ts-expect-error — qrcode types don't include "byte" mode but it works
        mode: "byte",
        margin: 2,
        width: 240,
      });
    }
  });

  async function startScanning(): Promise<void> {
    step = 2;
    camera_error = null;

    try {
      camera_stream = await startCamera(video_element);
      scan_abort_controller = new AbortController();
      const scanned_packet = await scanQr(video_element, scan_abort_controller.signal);
      onscanned(scanned_packet);
      handleClose();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      camera_error = error instanceof Error ? error.message : "Camera error";
    }
  }

  function handleClose(): void {
    scan_abort_controller?.abort();
    if (camera_stream !== null) {
      stopCamera(video_element, camera_stream);
      camera_stream = null;
    }
    onclose();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      handleClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { handleClose(); } }}
>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Air-gapped QR connection">
    <button class="close-btn" onclick={handleClose} aria-label="Close QR overlay">✕</button>

    {#if step === 1}
      <div class="step">
        <p class="step-label">Step 1 of 2 — Show this to the other device</p>

        {#if packet === null}
          <p class="hint">Gathering network info…</p>
        {:else}
          <canvas bind:this={qr_canvas} class="qr-canvas"></canvas>
        {/if}

        <button class="action-btn" onclick={startScanning} disabled={packet === null}>
          → Scan their QR
        </button>
      </div>
    {:else}
      <div class="step">
        <p class="step-label">Step 2 of 2 — Scan the other device's QR code</p>

        {#if camera_error !== null}
          <p class="error">{camera_error}</p>
        {/if}

        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video_element} class="camera-preview" playsinline></video>

        <button class="action-btn secondary" onclick={() => { step = 1; }}>
          ← Back
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 2rem;
    width: min(90vw, 340px);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .close-btn {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem 0.5rem;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .step-label {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
    text-align: center;
  }

  .qr-canvas {
    border: 4px solid white;
    border-radius: 4px;
  }

  .camera-preview {
    width: 100%;
    border-radius: 4px;
    background: #000;
    aspect-ratio: 4 / 3;
    object-fit: cover;
  }

  .hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }

  .error {
    color: var(--color-status-error);
    font-size: 0.85rem;
    margin: 0;
    text-align: center;
  }

  .action-btn {
    background: var(--color-accent);
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 0.6rem 1.2rem;
    font-family: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.secondary {
    background: transparent;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }
</style>
