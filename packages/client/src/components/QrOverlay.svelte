<script lang="ts">
  import QRCode from "qrcode";
  import { tick } from "svelte";
  import { scanQr, startCamera, stopCamera } from "../rtc/qr_mode/scanner.ts";

  interface Props {
    packet: Uint8Array | null;
    connection_error?: string | null;
    onscanned: (packet: Uint8Array) => void;
    onclose: () => void;
    onstartofferer?: () => void;
    onstartanswerer?: () => void;
  }

  let { packet, connection_error = null, onscanned, onclose, onstartofferer, onstartanswerer }: Props =
    $props();

  let qr_canvas: HTMLCanvasElement = $state() as HTMLCanvasElement;
  let video_element: HTMLVideoElement = $state() as HTMLVideoElement;
  // "choose": initial role-selection screen
  // "show": showing a QR code (offer for offerer, answer for answerer)
  // "scan": camera open, reading a QR code
  // "connecting": offerer has scanned the answer, waiting for WebRTC to connect
  let view = $state<"choose" | "show" | "scan" | "connecting">("choose");
  let role = $state<"offerer" | "answerer" | null>(null);
  let camera_stream: MediaStream | null = null;
  let scan_abort_controller: AbortController | null = null;
  let camera_error = $state<string | null>(null);
  let connect_timed_out = $state(false);
  let spinner_index = $state(0);
  const spinner_states = [..."◴◷◶◵"];
  const spinner = $derived(spinner_states[spinner_index]);

  $effect(() => {
    if (packet !== null) {
      return;
    }
    const interval = setInterval(() => {
      spinner_index = (spinner_index + 1) % 4;
    }, 500);
    return () => clearInterval(interval);
  });

  // Timeout for the "connecting" view — mobile browsers (iOS Safari) often never
  // fire connectionState="failed", so show an error after 15 s as a fallback.
  $effect(() => {
    if (view !== "connecting") {
      return;
    }
    connect_timed_out = false;
    const timeout_id = setTimeout(() => {
      connect_timed_out = true;
    }, 15_000);
    return () => clearTimeout(timeout_id);
  });

  // Render QR code whenever the canvas element is bound and packet is ready.
  $effect(() => {
    if (packet !== null && qr_canvas) {
      // Base64-encode so the QR code contains only ASCII characters (0–127).
      // Passing binary bytes directly causes UTF-8 expansion for bytes ≥ 128,
      // which corrupts the round-trip when BarcodeDetector reads rawValue.
      const base64_string = btoa(
        Array.from(packet, (byte) => String.fromCharCode(byte)).join(""),
      );
      QRCode.toCanvas(qr_canvas, base64_string, {
        errorCorrectionLevel: "L",
        margin: 2,
        width: 240,
      });
    }
  });

  // Answerer: re-render the QR canvas once the answer packet arrives.
  // (view transitions to "show" immediately after scanning — see startScanning)

  function chooseOfferer(): void {
    role = "offerer";
    view = "show";
    onstartofferer?.();
  }

  async function chooseAnswerer(): Promise<void> {
    role = "answerer";
    onstartanswerer?.();
    await startScanning();
  }

  async function startScanning(): Promise<void> {
    view = "scan";
    camera_error = null;
    // Wait for Svelte to render the <video> element before accessing it.
    await tick();

    try {
      camera_stream = await startCamera(video_element);
      scan_abort_controller = new AbortController();
      const scanned_packet = await scanQr(
        video_element,
        scan_abort_controller.signal,
      );

      stopCamera(video_element, camera_stream);
      camera_stream = null;

      onscanned(scanned_packet);

      if (role === "offerer") {
        // Show "connecting" state — the overlay closes automatically via the
        // onStateChange handler in App.svelte when WebRTC reaches "connected".
        // Do NOT call onclose() here: it would trigger teardown() while the
        // peer connection is still establishing.
        view = "connecting";
      } else {
        // Answerer: transition to "show" immediately so the spinner is visible
        // while the answer packet is being generated. The canvas renders once
        // packet becomes non-null (handled by the QR render $effect).
        view = "show";
      }
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

  function stepLabel(): string {
    if (role === "offerer") {
      return view === "show"
        ? "Step 1 of 2 — Show this to the other device"
        : "Step 2 of 2 — Scan the other device's QR code";
    }
    // answerer
    return view === "scan"
      ? "Step 1 of 2 — Scan the other device's QR code"
      : "Step 2 of 2 — Show this to the other device";
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }}
>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Air-gapped QR connection"
  >
    <button
      class="close-btn"
      onclick={handleClose}
      aria-label="Close QR overlay">✕</button
    >

    {#if connection_error !== null}
      <div class="step">
        <p class="error">{connection_error}</p>
        <button class="action-btn secondary" onclick={handleClose}>Close</button>
      </div>
    {:else if view === "choose"}
      <div class="step">
        <p class="step-label">Air-gapped QR connection</p>
        <p class="hint">
          One device shows their QR code first; the other scans it.
        </p>
        <button class="action-btn" onclick={chooseOfferer}>
          Show my QR code first
        </button>
        <button class="action-btn secondary" onclick={chooseAnswerer}>
          Scan their QR code first
        </button>
      </div>
    {:else if view === "show"}
      <div class="step">
        <p class="step-label">{stepLabel()}</p>

        {#if packet === null}
          <div class="hint-container">
            <div class="hint">{role === "answerer" ? "Generating answer…" : "Gathering network info…"}</div>
            <div class="dots">{spinner}</div>
          </div>
        {:else}
          <canvas bind:this={qr_canvas} class="qr-canvas"></canvas>
        {/if}

        {#if role === "offerer"}
          <button
            class="action-btn"
            onclick={startScanning}
            disabled={packet === null}
          >
            → Scan their QR
          </button>
        {:else}
          <p class="hint">Once they scan this, you'll be connected.</p>
        {/if}
      </div>
    {:else if view === "scan"}
      <div class="step">
        <p class="step-label">{stepLabel()}</p>

        {#if camera_error !== null}
          <p class="error">{camera_error}</p>
        {/if}

        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video_element} class="camera-preview" playsinline
        ></video>

        <button
          class="action-btn secondary"
          onclick={() => {
            scan_abort_controller?.abort();
            view = role === null ? "choose" : "show";
          }}
        >
          ← Back
        </button>
      </div>
    {:else}
      <div class="step">
        {#if connect_timed_out}
          <p class="error">Connection timed out.</p>
          <button class="action-btn secondary" onclick={handleClose}>Close</button>
        {:else}
          <p class="hint">Connecting…</p>
          <div class="dots">{spinner}</div>
        {/if}
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
    text-align: center;
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

  .hint-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .dots {
    font-size: 1.5rem;
    color: var(--color-text-muted);
    height: 1.5rem; /* prevent layout shift when changing dot count */
  }
</style>
