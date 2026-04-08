// QR scanner: BarcodeDetector API (primary) with lazy-loaded zxing-wasm fallback.
//
// IMPORTANT: zxing-wasm must ALWAYS be dynamically imported — never in the main bundle.
// It is ~500 KB of WASM and would blow the 150 KB gzipped main chunk budget.

export type ScanResult = { packet: Uint8Array } | { error: Error };

/**
 * Check if the BarcodeDetector API is available in this browser.
 */
export function hasBarcodeDetector(): boolean {
  return typeof BarcodeDetector !== "undefined";
}

/**
 * Scan a QR code from a video element using BarcodeDetector.
 * Polls every animation frame until a QR code is detected.
 * Returns the raw binary payload as a Uint8Array.
 */
export async function scanWithBarcodeDetector(
  video_element: HTMLVideoElement,
  abort_signal: AbortSignal,
): Promise<Uint8Array> {
  const detector = new BarcodeDetector({ formats: ["qr_code"] });

  return new Promise<Uint8Array>((resolve, reject) => {
    let animation_frame_id: number;

    const scan = async (): Promise<void> => {
      if (abort_signal.aborted) {
        reject(new DOMException("Scan aborted", "AbortError"));
        return;
      }

      try {
        const barcodes = await detector.detect(video_element);
        if (barcodes.length > 0) {
          const raw_value = barcodes[0]!.rawValue;
          const bytes = Uint8Array.from(atob(raw_value), (char) => char.charCodeAt(0));
          resolve(bytes);
          return;
        }
      } catch {
        // Frame not ready yet or detection error — continue scanning
      }

      animation_frame_id = requestAnimationFrame(() => {
        scan().catch(reject);
      });
    };

    abort_signal.addEventListener("abort", () => {
      cancelAnimationFrame(animation_frame_id);
      reject(new DOMException("Scan aborted", "AbortError"));
    });

    scan().catch(reject);
  });
}

/**
 * Scan a QR code using the zxing-wasm fallback.
 * zxing-wasm is dynamically imported to keep it out of the main bundle.
 */
export async function scanWithZxingWasm(
  video_element: HTMLVideoElement,
  abort_signal: AbortSignal,
): Promise<Uint8Array> {
  // Dynamic import — NEVER move this to a static import at the top of the file
  const { readBarcodesFromImageData } = await import("zxing-wasm/reader");

  return new Promise<Uint8Array>((resolve, reject) => {
    let animation_frame_id: number;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) {
      reject(new Error("Could not get canvas 2D context for zxing-wasm scan"));
      return;
    }

    const scan = async (): Promise<void> => {
      if (abort_signal.aborted) {
        reject(new DOMException("Scan aborted", "AbortError"));
        return;
      }

      canvas.width = video_element.videoWidth;
      canvas.height = video_element.videoHeight;
      context.drawImage(video_element, 0, 0);
      const image_data = context.getImageData(0, 0, canvas.width, canvas.height);

      try {
        const results = await readBarcodesFromImageData(image_data, {
          formats: ["QRCode"],
          tryHarder: false,
        });
        if (results.length > 0 && results[0]!.isValid) {
          const bytes = Uint8Array.from(atob(results[0]!.text), (char) => char.charCodeAt(0));
          resolve(bytes);
          return;
        }
      } catch {
        // Frame not decodable — continue scanning
      }

      animation_frame_id = requestAnimationFrame(() => {
        scan().catch(reject);
      });
    };

    abort_signal.addEventListener("abort", () => {
      cancelAnimationFrame(animation_frame_id);
      reject(new DOMException("Scan aborted", "AbortError"));
    });

    scan().catch(reject);
  });
}

/**
 * Start the device camera (rear-facing preferred) and attach it to a video element.
 * Requires HTTPS in production and on iOS in development.
 */
export async function startCamera(video_element: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  video_element.srcObject = stream;
  await video_element.play();
  return stream;
}

/**
 * Stop all tracks in a media stream and detach it from a video element.
 */
export function stopCamera(video_element: HTMLVideoElement, stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    track.stop();
  });
  video_element.srcObject = null;
}

/**
 * Scan a QR code from the camera, using BarcodeDetector if available,
 * falling back to zxing-wasm.
 */
export async function scanQr(
  video_element: HTMLVideoElement,
  abort_signal: AbortSignal,
): Promise<Uint8Array> {
  if (hasBarcodeDetector()) {
    return scanWithBarcodeDetector(video_element, abort_signal);
  }
  return scanWithZxingWasm(video_element, abort_signal);
}

/**
 * Attempt a single-frame QR decode from the current video frame.
 * Returns the decoded bytes, or null if no QR code was found.
 */
export async function detectFrame(
  video_element: HTMLVideoElement,
): Promise<Uint8Array | null> {
  if (hasBarcodeDetector()) {
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const barcodes = await detector.detect(video_element);
      if (barcodes.length > 0) {
        return Uint8Array.from(atob(barcodes[0]!.rawValue), (char) => char.charCodeAt(0));
      }
    } catch {
      // Frame not ready or detection error
    }
    return null;
  }

  // zxing-wasm fallback
  const { readBarcodesFromImageData } = await import("zxing-wasm/reader");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context === null) { return null; }
  canvas.width = video_element.videoWidth;
  canvas.height = video_element.videoHeight;
  context.drawImage(video_element, 0, 0);
  const image_data = context.getImageData(0, 0, canvas.width, canvas.height);
  try {
    const results = await readBarcodesFromImageData(image_data, {
      formats: ["QRCode"],
      tryHarder: true,
    });
    if (results.length > 0 && results[0]!.isValid) {
      return Uint8Array.from(atob(results[0]!.text), (char) => char.charCodeAt(0));
    }
  } catch {
    // Frame not decodable
  }
  return null;
}
