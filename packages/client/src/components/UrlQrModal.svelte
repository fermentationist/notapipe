<script lang="ts">

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  let qr_canvas = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    const canvas = qr_canvas;
    if (canvas) {
      import("qrcode").then(({ default: QRCode }) => {
        QRCode.toCanvas(canvas, window.location.href, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 260,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });
      });
    }
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") { onclose(); }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="overlay"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) { onclose(); } }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Room URL QR code">
    <button class="close-btn" onclick={onclose} aria-label="Close">✕</button>
    <p class="label">Scan to open this room</p>
    <canvas bind:this={qr_canvas} class="qr-canvas"></canvas>
    <p class="url">{window.location.href}</p>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: #ffffff;
    border-radius: 10px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    position: relative;
    max-width: 90vw;
  }

  .close-btn {
    position: absolute;
    top: 0.6rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem 0.4rem;
    line-height: 1;
  }

  .label {
    margin: 0;
    font-size: 0.85rem;
    color: #444;
    font-family: inherit;
  }

  .qr-canvas {
    display: block;
    border-radius: 4px;
  }

  .url {
    margin: 0;
    font-size: 0.65rem;
    color: #888;
    font-family: monospace;
    word-break: break-all;
    max-width: 260px;
    text-align: center;
  }
</style>
