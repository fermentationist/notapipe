# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

notapipe is an ephemeral, local-first, peer-to-peer text sharing tool. Two people open the same URL (identified by a memorable 3-word phrase) and sync text via Yjs CRDTs over a WebRTC data channel. **No user text ever touches a server. No server calls are made without explicit user action.** The signalling server only relays WebRTC handshake metadata (SDP/ICE candidates) and is only contacted when the user chooses that connection method. In QR mode, even that is eliminated.

## Toolchain

This project uses [Vite Plus](https://viteplus.dev/guide/) (`vp` CLI) with pnpm. Vite Plus auto-detects pnpm via `pnpm-workspace.yaml` / `pnpm-lock.yaml`. Tests run via Vitest through `vp test`.

## Commands

```bash
vp install           # install all workspace deps (run from root)
vp dev               # run both client and signalling server concurrently
vp build             # production build
vp test              # run tests once
vp test watch        # run tests in watch mode
vp test run --coverage  # with coverage report
vp check             # format + lint + type-check
vp check --fix       # auto-fix format/lint issues
```

Individual packages:
```bash
vp dev --filter packages/client       # Vite dev server only
vp dev --filter packages/signalling   # signalling server only
```

For local mobile testing (camera/QR requires HTTPS on iOS):
```bash
# Add --https to vite config or vp dev in packages/client for self-signed cert
```

## Scaffolding

Bootstrap with `vp create` using the `vite:monorepo` template for the root, then `vp create svelte` for the client package. The two packages (`client`, `signalling`) are orchestrated via `vp run -r` and the pnpm workspace protocol.

## Testing

Vitest via `vp test`. No separate test runner config needed — Vitest reuses the Vite config.

**Unit tests** (pure logic, no browser APIs needed):
- `src/id/generate.ts` — `generateId`, `parseId`, `isValidId`
- `src/rtc/qr-mode/sdp-codec.ts` — encode/decode round-trips using captured real SDP strings from Chrome, Firefox, and Safari; verify the reconstructed SDP is accepted by `setRemoteDescription` (this is the most critical test surface)
- Yjs textarea prefix/suffix diff algorithm in `src/yjs/provider.ts`
- Signalling server room logic in `packages/signalling/src/rooms.ts`

**Integration tests**:
- Signalling server message routing — spin up a real `ws` server in the test, connect two WebSocket clients, verify the join/signal/leave flow end-to-end
- SDP codec cross-browser: encode a real SDP offer → decode → verify the reconstructed SDP round-trips without loss of candidate data

QR scan and WebRTC DataChannel tests require real hardware (physical devices) — these are manual, not automated.

## Architecture

Vite Plus monorepo with exactly two packages — no Turborepo/Nx.

### `packages/client` — Vite + Svelte + TypeScript

Svelte is used for the UI. It compiles to vanilla JS with a ~10 KB gzipped runtime (Svelte 5), so the main chunk stays well under the 150 KB target alongside Yjs (~20 KB) and qrcode (~40 KB). Bootstrap with `vp create svelte`. No React/Vue. Bundle target: <150 KB gzipped for the main chunk.

Key architectural layers:

**ID system** (`src/id/`): Two derivation paths, same wordlist. `generateId()` uses `crypto.getRandomValues()` — runs on page load with no permissions. `geoId(coords)` hashes quantized GPS coordinates via `crypto.subtle.digest` — only called when the user explicitly taps "Connect nearby". `parseId()` reads from `window.location.pathname`. No server calls are made on page load regardless of whether the URL contains a room ID — the user must explicitly tap a connection action before any network contact occurs. Vite dev server needs `historyApiFallback: true`; production needs SPA rewrite rule (all paths → `index.html`).

**WebRTC layer** (`src/rtc/`): Built on native `RTCPeerConnection` — no `simple-peer` or `y-webrtc`. The key abstraction is `SignalTransport` (in `peer.ts`), an interface with `sendOffer/sendAnswer/sendIceCandidate/onOffer/onAnswer/onIceCandidate/close`. Two implementations:
- `WebSocketTransport` — wraps the WS signalling client
- `QrTransport` — wraps the QR encode/decode flow

Offerer/answerer role is determined locally by lexicographic UUID comparison (larger UUID = offerer), preventing the "glare" condition where both peers create offers simultaneously.

**QR mode** (`src/rtc/qr-mode/`): SDP is semantically compressed into ~78 bytes by extracting only the DTLS fingerprint (32 bytes), ICE ufrag/pwd, and ICE candidates. Each IPv4 candidate = 7 bytes. A hardcoded SDP template reconstructs the full SDP on the receiving side. QR generation uses the `qrcode` package; scanning uses `BarcodeDetector` API with lazy-loaded `zxing-wasm` fallback (~500 KB WASM, never in the main chunk).

**Yjs integration** (`src/yjs/`): Single `Y.Text` named `"content"`. Custom WebRTC provider takes a `Y.Doc` and `RTCDataChannel`, sends `y-protocols/sync` messages directly. Textarea → Yjs binding uses a prefix/suffix diff algorithm (zero deps). Signalling mode uses trickle ICE; QR mode waits for `iceGatheringState === "complete"` (15s timeout) before encoding.

**UI layer** (`src/ui/`, `src/stores/`, `src/themes/`): Svelte stores drive focus mode (`focusMode` boolean) and the active theme. All colors are CSS custom properties on `:root`; themes are plain JSON objects applied via `style.setProperty`. Two built-in themes (light/dark); users can paste custom JSON themes in the settings panel. Active theme persists in `localStorage` (theme config only — no document content). `prefers-color-scheme` sets the initial default.

### `packages/signalling` — Node.js WebSocket server (`ws`)

Stateless in-memory rooms. Max 2 peers per room — third peer receives `room-full` and is closed. Rooms are `Map<string, { peers: Map<string, WebSocket> }>`. On disconnect: broadcast `peer-left`, clean empty rooms. HTTP GET `/` returns `{ status: "ok" }` for health checks. Configured via `VITE_SIGNAL_URL` env var on the client.

Message protocol is defined in `src/types.ts` — client→server: `join`, `signal`, `leave`, `ping`; server→client: `joined`, `peer-joined`, `peer-left`, `signal`, `room-full`, `pong`.

## Key Constraints

- No persistence: no localStorage writes of document content, no database.
- No TURN server in v1 — ~10% of users on symmetric NAT cannot connect. Architecture is ready for TURN (just add URLs to `iceServers`).
- `zxing-wasm` must always be lazy-loaded (dynamic `import()`), never in the main bundle.
- iOS Safari requires HTTPS for `getUserMedia` (camera). `BarcodeDetector` requires iOS 17.4+.
- mDNS candidates (Chromium privacy mode): encode the UUID as 16 raw bytes in the binary packet, reconstruct `uuid.local` hostname on decode.

## Code Style

- Semicolons required
- Double quotes for strings
- Curly braces required after all conditionals (`if`, `else`, `for`, `while`) — no braceless one-liners
- `const` by default; `let` only when the variable is reassigned; never `var`
- Strict equality only (`===` / `!==`); never `==` or `!=`

## Dependencies (client)

| Package | Notes |
|---|---|
| `svelte` | UI framework — compiles away, ~10 KB runtime |
| `yjs` | CRDT |
| `y-protocols` | Transitive dep of yjs — use directly for sync messages |
| `qrcode` | QR generation to canvas |
| `zxing-wasm` | QR scan fallback — **lazy only** |

No `simple-peer`. No `y-webrtc`.
