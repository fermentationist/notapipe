# notapipe — Architecture & Implementation Blueprint

## Table of Contents

1. [Project Overview and Goals](#1-project-overview-and-goals)
2. [Repository Structure](#2-repository-structure)
3. [Technology Choices and Justifications](#3-technology-choices-and-justifications)
4. [Architecture Overview](#4-architecture-overview)
5. [Component Deep-Dives](#5-component-deep-dives)
   - [5.1 The 3-Word ID System](#51-the-3-word-id-system)
   - [5.2 Signalling Server](#52-signalling-server)
   - [5.3 WebRTC Layer](#53-webrtc-layer)
   - [5.4 QR Code Mode (Air-Gapped)](#54-qr-code-mode-air-gapped)
   - [5.5 Yjs Integration](#55-yjs-integration)
   - [5.6 Text Editor UI](#56-text-editor-ui)
6. [Step-by-Step Build Order](#6-step-by-step-build-order)
7. [Potential Pitfalls and Mitigations](#7-potential-pitfalls-and-mitigations)
8. [What Belongs in v2](#8-what-belongs-in-v2)
   - [8.1 TURN Server](#81-turn-server)
   - [8.2 File Sharing](#82-file-sharing)
   - [8.3 Signalling Server SDP Encryption](#83-signalling-server-sdp-encryption)
   - [8.4 Multi-Peer (3+)](#84-multi-peer-3)
   - [8.5 Persistent Sessions](#85-persistent-sessions)
   - [8.6 Geo-Based Room IDs (what3words)](#86-geo-based-room-ids-what3words)
   - [8.7 Encrypted Solo Mode](#87-encrypted-solo-mode)
   - [8.8 Collaborative Code Editor](#88-collaborative-code-editor)
   - [8.9 Markdown Preview Mode](#89-markdown-preview-mode)
   - [8.10 Symmetric QR Exchange (QWBP-style)](#810-symmetric-qr-exchange-qwbp-style)
   - [8.11 PWA / Installable](#811-pwa--installable)
9. [Summary of Dependencies](#9-summary-of-dependencies)

---

## 1. Project Overview and Goals

notapipe is a zero-server-storage, ephemeral text-sharing tool. Two people open the same URL — identified by a memorable 3-word phrase — and their text stays in sync via Yjs CRDTs over a WebRTC data channel. The signalling server only brokers the initial handshake and sees no content; in the QR mode, even that middleman is eliminated.

### Hard Constraints

- No user text EVER touches a server. The signalling server relays WebRTC handshake metadata only (SDP/ICE candidates), never Yjs document content.
- Ephemeral: no persistence layer, no database, no localStorage writes of document content.
- Small bundle: target under 150 KB gzipped for the client main chunk.
- TypeScript throughout.

---

## 2. Repository Structure

The project is a Vite Plus monorepo using pnpm workspaces. No build orchestrator (Turborepo, Nx) — the project has exactly two packages and the overhead isn't worth it at this scale. Bootstrapped with `vp create` using the `vite:monorepo` template; the client package uses the `svelte` template.

```
notapipe/
├── pnpm-workspace.yaml           ← workspace config (auto-detected by Vite Plus)
├── package.json                  ← root scripts
├── .gitignore
├── .nvmrc                        ← pin Node version (e.g. 20)
├── tsconfig.base.json            ← shared TS config extended by packages
├── README.md
│
├── packages/
│   ├── client/                   ← Vite + Svelte + TypeScript frontend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.ts           ← entry point
│   │       ├── App.svelte        ← root Svelte component
│   │       ├── id/
│   │       │   ├── wordlist.ts   ← the word bank (~2048 words)
│   │       │   └── generate.ts   ← ID generation + URL parsing
│   │       ├── rtc/
│   │       │   ├── peer.ts       ← thin WebRTC wrapper + SignalTransport interface
│   │       │   ├── signalling.ts ← WebSocket signalling client
│   │       │   └── qr_mode/
│   │       │       ├── sdp_codec.ts    ← SDP compress/decompress
│   │       │       ├── qr_display.ts   ← renders QR to canvas
│   │       │       └── qr_scanner.ts   ← camera/scan UI
│   │       ├── yjs/
│   │       │   ├── provider.ts   ← custom Yjs WebRTC provider
│   │       │   └── awareness.ts  ← (v2) remote cursor/presence
│   │       ├── ui/
│   │       │   ├── Editor.svelte           ← textarea bound to Y.Text
│   │       │   ├── ConnectionStatus.svelte
│   │       │   ├── QrFlow.svelte           ← QR mode UI flow
│   │       │   └── Settings.svelte         ← theme picker + focus mode toggle
│   │       ├── lib/
│   │       │   └── constants/
│   │       │       ├── webrtc_config.ts    ← ICE servers, timeouts, channel name
│   │       │       ├── qr_codec.ts         ← magic bytes, version, packet offsets
│   │       │       └── geo_config.ts       ← precision tiers, accuracy thresholds
│   │       ├── themes/
│   │       │   ├── light.json              ← built-in light theme
│   │       │   └── dark.json               ← built-in dark theme
│   │       ├── stores/
│   │       │   └── ui.ts                   ← focusMode, activeTheme Svelte stores
│   │       └── style.css
│   │
│   └── signalling/               ← Node.js WebSocket server
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── server.ts         ← main entry
│           ├── rooms.ts          ← room/topic management
│           └── types.ts          ← shared message protocol types
│
└── docs/
    ├── architecture.md           ← this file
    └── qr-mode.md                ← QR mode deep-dive
```

### Why Vite Plus + pnpm (Not Turborepo)?

Two packages. Adding a build orchestration layer would increase cognitive overhead without meaningful benefit. Vite Plus handles workspace orchestration via `vp run -r` and the pnpm workspace protocol, giving shared `node_modules` hoisting and cross-package scripts for free.

### Why Not a Single Package?

The signalling server must be deployable independently — it runs on a server, not in a browser. Keeping it separate enforces this boundary cleanly and allows independent deployment.

---

## 3. Technology Choices and Justifications

### 3.1 Frontend: Vite + Svelte

Native ES module dev server, Rollup-based production builds with tree-shaking, zero-config TypeScript. Svelte 5 is used for the UI — it compiles to vanilla JS with no virtual DOM, adding only ~10 KB gzipped for its runtime. This avoids the imperative DOM manipulation that vanilla TypeScript would require at this UI complexity, without the 30–100 KB overhead of React or Vue. Svelte has first-class Vite support via `@sveltejs/vite-plugin-svelte`.

### 3.2 CRDT: Yjs

Most battle-tested CRDT library for JavaScript. `Y.Text` maps cleanly to a textarea. ~20 KB gzipped. Handles concurrent edits, offline-then-reconnect, and partial sync natively. The awareness protocol provides peer presence for free.

_Alternative considered_: Automerge — heavier bundle, less ecosystem support for custom WebRTC providers.

### 3.3 WebRTC Provider: Custom (not y-webrtc)

`y-webrtc` is built on `simple-peer`, which is unmaintained and adds bundle weight. Its signalling protocol broadcasts to all room members — overkill for a 2-peer point-to-point session.

The custom provider uses the native `RTCPeerConnection` API directly, a single `RTCDataChannel`, and accepts an abstract `SignalTransport` interface implemented by both the WebSocket client and the QR mode. This cuts `simple-peer` entirely.

### 3.4 QR Encoding: qrcode + custom binary SDP codec

- **QR generation**: `qrcode` npm package (maintained, ~40 KB minified). Renders to `<canvas>`.
- **QR scanning**: Browser's `BarcodeDetector` API (Chrome/Edge/Android, zero bundle cost) with a lazy-loaded `zxing-wasm` fallback for Firefox and Safari.
- **SDP compression**: A custom binary codec (~200 lines of TypeScript) inspired by the [QWBP protocol](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/). Encodes only the semantically meaningful parts of the SDP: DTLS fingerprint, ICE ufrag + password (included directly in the packet), and ICE candidates. Total payload ~78 bytes — fits in QR Version 4. No dependency on a library that doesn't have a stable public release yet.

### 3.5 Signalling Server: ws

The `ws` Node.js WebSocket library — minimal, battle-tested. No HTTP framework needed. The server does one thing: relay WebRTC handshake messages between two peers in a room.

Deploy target: Railway, Fly.io, or Render free tier. Stateless across connections — rooms exist only in memory.

### 3.6 3-Word IDs: Custom wordlist

No external library. A hand-curated list of ~2048 short, unambiguous English words. Each word is:
- Verbally communicable (no homophones with other words in the list)
- 3–8 characters
- Unambiguous to spell when heard

With 2048 words: 2048³ = ~8.6 billion combinations. At 1 million simultaneous sessions, collision probability per new ID ≈ 0.012%. Perfectly acceptable for an ephemeral service.

---

## 4. Architecture Overview

### 4.1 System Components

```
┌─────────────────────────────────────────────────────────┐
│                    notapipe.app/[id]                     │
│                                                          │
│  ┌─────────┐    WebRTC DataChannel    ┌─────────┐       │
│  │  Peer A │ ←─────────────────────→ │  Peer B │       │
│  │         │     (Yjs CRDT sync)      │         │       │
│  └────┬────┘                          └────┬────┘       │
│       │                                    │            │
└───────┼────────────────────────────────────┼────────────┘
        │                                    │
        │  (Mode 1 only, handshake only)      │
        ▼                                    ▼
  ┌──────────────────────────────────────────────┐
  │         Signalling Server (WebSocket)         │
  │                                              │
  │  Room: "apple-river-moon"                    │
  │  ┌──────────────────────────────────┐        │
  │  │  [conn_A, conn_B]  (max 2 peers) │        │
  │  └──────────────────────────────────┘        │
  └──────────────────────────────────────────────┘

  Mode 2 (QR): No server involvement at all.
  Device A ──[QR display]──► Device B scans
  Device B ──[QR display]──► Device A scans
  RTCPeerConnection established directly.
```

### 4.2 Connection State Machine

```
  Page load
     │
     ├─ URL has room ID? ──yes──► use existing ID ──────────────────┐
     └─ URL is bare /   ──────► generateId() → update URL           │
                                 (crypto.getRandomValues, no perms)  │
                                                                     │
                                  ▼                                  ▼
                        ┌──────────────────────────────────────────────┐
                        │   WAITING                                     │
                        │   Textarea ready. Zero network calls.         │
                        │   Zero permission prompts.                    │
                        │   Room ID visible in URL and header.          │
                        └─────────────┬──────────────┬─────────────────┘
                                      │              │
                  ┌───────────────────┤              │
                  │                   │              │
          "Copy link"          "Connect nearby"   "Air-gapped"
          (or incoming URL)          │               │
                  │            request geo perm   QR flow ──────────────┐
                  │                  │                                   │
                  │         coords → hash → ID                          │
                  │         navigate to new URL                         │
                  │         prompt for PIN                              │
                  │                  │                                   │
                  ▼                  ▼                                   │
        ┌──────────────────────────────────┐                            │
        │   SIGNALLING                     │                            │
        │   WebSocket connects to server   │                            │
        │   Waiting for peer to join       │                            │
        └────────────────┬─────────────────┘                            │
                         │                                              │
                         ▼                                              │
        ┌──────────────────────────────────────────────────────────────┤
        │   ICE GATHERING                                               │
        │   (STUN lookups to discover public IPs)                      │
        └──────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────┐
                  │   CONNECTED            │
                  │   RTCDataChannel open  │
                  │   Yjs provider syncs   │
                  └────────────────────────┘
```

Geolocation is **never requested on page load**. It is only triggered when the user explicitly taps "Connect nearby". The browser permission prompt is therefore contextually motivated — the user just asked for something location-based.

### 4.3 Data Flow (Mode 1 — Signalling)

```
Peer A                    Signal Server              Peer B
  │                             │                      │
  ├─ join("apple-river-moon") ─►│                      │
  │                             │◄─ join(same) ────────┤
  │                             │                      │
  │◄── peer-joined({id: B}) ────┤                      │
  │                             │                      │
  │  [A has larger UUID → A is offerer]                │
  │                             │                      │
  ├─ signal(offer SDP) ────────►│─────────────────────►│
  │                             │◄─ signal(answer SDP) ┤
  │◄────────────────────────────┤                      │
  │                             │                      │
  ├─ signal(ICE candidate) ────►│─────────────────────►│
  │◄─────────────────────────── │◄─ signal(ICE) ───────┤
  │                             │                      │
  │◄══════════ DataChannel open (P2P) ════════════════►│
  │         [WS connections can close now]             │
```

### 4.4 Data Flow (Mode 2 — QR)

```
Device A                                    Device B
  │                                              │
  │  1. Create RTCPeerConnection (initiator)     │
  │  2. Gather all ICE candidates                │
  │  3. Encode SDP offer → binary packet         │
  │  4. Display QR code                          │
  │                                              │
  │  [User physically shows screen to Device B] │
  │                                              │
  │                        5. Device B scans QR │
  │                        6. Decode packet      │
  │                        7. Set remote desc    │
  │                        8. Create answer SDP  │
  │                        9. Encode → QR code   │
  │                       10. Display QR         │
  │                                              │
  │  [User physically shows Device B to Device A]│
  │                                              │
  │  11. Device A scans QR                       │
  │  12. Decode answer                           │
  │  13. Set remote description                  │
  │                                              │
  │◄════════════════ DataChannel open ══════════►│
```

---

## 5. Component Deep-Dives

### 5.1 The 3-Word ID System

#### Word Selection Criteria

The wordlist should contain approximately 2048 words satisfying:
- Common nouns and adjectives only (easier to communicate verbally)
- 3–8 characters
- No homophones of other words in the list (e.g., include "sea" but not "see", or neither)
- No silent-letter ambiguity (avoid "knight")
- No offensive words
- All lowercase ASCII

Good starting point: the EFF long wordlist for dice, filtered down to the 2048 words meeting these criteria.

#### ID Generation — Random (default)

Uses `crypto.getRandomValues()` to select three indices into the wordlist array. Cryptographically random, entirely in browser — no permissions, no server round-trip.

```
id = wordlist[rand(2048)] + "-" + wordlist[rand(2048)] + "-" + wordlist[rand(2048)]
```

URL updated via `history.replaceState()` without a page reload.

#### ID Generation — Geo-derived (v2, "Connect nearby")

Only triggered by explicit user action. The Geolocation API provides coordinates; cell size is chosen adaptively from `coords.accuracy`; `crypto.subtle.digest("SHA-256", ...)` hashes the quantized coordinate string; three 11-bit indices into the same wordlist produce the room ID. See section 8.6 for full details.

The geo path feeds into the same signalling server transport as the random ID path — geo is purely a room ID derivation mechanism, not a separate transport.

#### URL Routing

1. On load, read `window.location.pathname` (e.g., `/apple-river-moon`).
2. If path is `/` or empty, generate a new random ID and push to history.
3. If path matches `/word-word-word`, use that as the room ID. No server call is made — the user must explicitly tap a connection action.

The Vite dev server needs `historyApiFallback: true`. Production (Netlify/Vercel/Cloudflare Pages) needs a rewrite rule: all paths → `index.html`.

#### Key Exports (`src/id/generate.ts`)

- `generateId(): string` — generates a fresh random 3-word ID
- `generatePassphrase(): string` — generates a random 2-word passphrase for geo mode
- `geoId(coords: GeolocationCoordinates): Promise<string>` — derives a 3-word ID from coordinates
- `parseId(pathname: string): string | null` — extracts ID from URL path
- `isValidId(id: string): boolean` — validates against wordlist

---

### 5.2 Signalling Server

#### Message Protocol (`packages/signalling/src/types.ts`)

```
Client → Server:
  { type: "join",        roomId: string, peerId: string }
  { type: "signal",      roomId: string, to: string, from: string, payload: SdpPayload | IcePayload }
  { type: "leave",       roomId: string, peerId: string }
  { type: "ping" }

Server → Client:
  { type: "joined",      roomId: string, peerId: string, peers: string[] }
  { type: "peer-joined", roomId: string, peerId: string }
  { type: "peer-left",   roomId: string, peerId: string }
  { type: "signal",      roomId: string, from: string, payload: SdpPayload | IcePayload }
  { type: "room-full",   roomId: string }
  { type: "rate-limited" }
  { type: "pong" }
```

Where:
- `SdpPayload = { sdpType: "offer" | "answer", sdp: string }`
- `IcePayload = { candidate: string, sdpMid: string | null, sdpMLineIndex: number | null }`

#### Room Logic

- Maximum 2 peers per room. Third peer → `room-full` + close.
- Rooms stored in `Map<string, { peers: Map<string, WebSocket> }>`.
- On disconnect: broadcast `peer-left` to remaining peers, clean up empty rooms.
- No persistence — rooms live only in memory.

#### Rate Limiting

The server tracks `join` attempts per IP address using a sliding window. Exceeding the limit closes the connection with a `rate-limited` message. This defends against online brute-force of geo mode passphrase-derived room IDs.

- Limit: 10 `join` attempts per IP per minute
- State: `Map<string, number[]>` of IP → timestamps, pruned on each check
- No external dependency (no Redis, no middleware) — pure in-memory sliding window

#### Security Note

The signalling server sees room IDs and peer IDs (random UUIDs). It relays SDP/ICE messages verbatim. SDP contains IP addresses and DTLS fingerprints — unavoidable for WebRTC. Acceptable for v1. For v2, consider encrypting SDP with a key derived from the room ID.

#### Deployment

Plain Node.js process. Include a minimal `Dockerfile` and a `fly.toml` or `railway.toml`. HTTP GET `/` returns `{ status: "ok" }` for health checks. Configured via `VITE_SIGNAL_URL=wss://signal.notapipe.app` env var in the client.

---

### 5.3 WebRTC Layer

#### The `SignalTransport` Interface

The WebRTC peer code is fully decoupled from how signals are exchanged:

```typescript
interface SignalTransport {
  sendOffer(sdp: RTCSessionDescriptionInit): void;
  sendAnswer(sdp: RTCSessionDescriptionInit): void;
  sendIceCandidate(candidate: RTCIceCandidate): void;
  onOffer(cb: (sdp: RTCSessionDescriptionInit) => void): void;
  onAnswer(cb: (sdp: RTCSessionDescriptionInit) => void): void;
  onIceCandidate(cb: (candidate: RTCIceCandidate) => void): void;
  close(): void;
}
```

Implemented by:
1. `WebSocketTransport` — wraps the WebSocket signalling client
2. `QrTransport` — wraps the QR encode/decode flow

`RTCPeerManager` in `src/rtc/peer.ts` accepts a `SignalTransport` and manages the `RTCPeerConnection` lifecycle.

#### Peer Role Determination

Both peers generate a random UUID on page load. When both peers are in the same room, the one with the **lexicographically larger UUID** becomes the offerer. The `joined` server message includes all current peer IDs, so both peers can make this determination locally without additional coordination. This avoids the "glare" condition where both peers create offers simultaneously.

#### ICE / STUN Configuration

```typescript
const iceConfig: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};
```

No TURN for v1 (see [v2 section](#81-turn-server)).

#### Trickle ICE

- **Signalling mode**: Use trickle ICE (default). Send each ICE candidate as it's discovered.
- **QR mode**: Do NOT use trickle ICE. Wait for `iceGatheringState === "complete"` before encoding the QR. The full SDP (with all candidates embedded) is then encoded into a single QR. Include a timeout (~15 seconds) after which encoding proceeds with whatever candidates have been gathered.

#### DataChannel Setup

One ordered data channel, created by the offerer:

```typescript
const channel = pc.createDataChannel("yjs", { ordered: true });
```

The answerer receives it via `pc.ondatachannel`. Yjs requires ordered delivery.

---

### 5.4 QR Code Mode (Air-Gapped)

See [qr-mode.md](./qr-mode.md) for the full technical deep-dive.

**Summary**: The SDP offer (~1500–4000 bytes of text) is semantically compressed into a ~78-byte binary packet by:
1. Extracting the DTLS fingerprint (32 bytes), ICE ufrag (4 bytes), and ICE password (22 bytes)
2. Encoding each IPv4 candidate as 7 bytes (1 flag + 4 IP + 2 port)
3. Encoding the result as a QR code in binary mode (version 4, error correction L)

HKDF-based credential derivation (which would eliminate ufrag + pwd from the payload) was considered but rejected for v1 due to the chicken-and-egg problem with the DTLS certificate. See `qr-mode.md` for the full analysis.

On the receiving side, the packet is decoded and a valid SDP is reconstructed from a template.

---

### 5.5 Yjs Integration

#### Document Setup

```typescript
const doc = new Y.Doc();
const text = doc.getText("content");  // single shared text type
```

#### Custom WebRTC Provider

The provider class:
1. Takes a `Y.Doc` and a `RTCDataChannel`
2. On DataChannel open: sends full initial sync message (state vector)
3. On incoming messages: applies Yjs updates
4. On local Yjs changes: sends updates through the DataChannel

Message types (first byte discriminator):
- `0x00` — sync step 1 (state vector)
- `0x01` — sync step 2 (full state update)  
- `0x02` — incremental update

Uses `y-protocols/sync` directly rather than reimplementing it. `y-protocols` is already a transitive dependency of Yjs.

#### Textarea Binding

Remote changes → DOM: straightforward, preserve cursor position.

Local changes → Yjs: use a prefix/suffix diff algorithm that requires zero extra dependencies:

```typescript
function applyTextareaDiff(ytext: Y.Text, oldVal: string, newVal: string) {
  let i = 0;
  while (i < oldVal.length && i < newVal.length && oldVal[i] === newVal[i]) i++;
  let j = 0;
  while (
    j < oldVal.length - i &&
    j < newVal.length - i &&
    oldVal[oldVal.length - 1 - j] === newVal[newVal.length - 1 - j]
  ) j++;
  const deleteCount = oldVal.length - i - j;
  const insertText = newVal.slice(i, newVal.length - j);
  doc.transact(() => {
    if (deleteCount > 0) ytext.delete(i, deleteCount);
    if (insertText) ytext.insert(i, insertText);
  });
}
```

This handles typical typing correctly and is semantically accurate for concurrent editing.

#### Late Join Sync

Handled automatically by Yjs's sync protocol. When the DataChannel opens, both peers exchange state vectors, then each sends any updates the other is missing. Standard Yjs pattern, works automatically.

---

### 5.6 Text Editor UI

Built with Svelte 5 components. Minimal CSS. Mobile-first responsive layout.

#### Layout

No upfront modal. The textarea and room ID are immediately visible on load with no prompts. Connection actions are contextual — shown below the textarea until a peer connects, then hidden. A settings icon in the header opens the theme/focus controls.

```
┌──────────────────────────────────────────────────┐
│  notapipe              [●] waiting   [↓] [↑] [⚙] │
│  apple-river-moon  [📋]                            │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │                                             │  │
│  │   (textarea — full height)                  │  │
│  │                                             │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  [Share link]  [Connect nearby]  [Air-gapped ↗]   │
└──────────────────────────────────────────────────┘
```

- **Share link / Connect**: connects to the signalling server. Label adapts to context: "Share link" on a freshly generated room (also copies the URL to clipboard); "Connect" when arriving via a shared link. No permissions needed, but requires an explicit tap.
- **Connect nearby**: requests geolocation permission (the only point in the app where this happens), derives a geo room ID, navigates to its URL, prompts for PIN, then connects via signalling server.
- **Air-gapped**: opens the QR flow overlay for offline/serverless connection.
- **[↓] Export**: downloads the document as a `.txt` file (Note mode) or with the appropriate extension in Code mode. Uses `Blob` + `URL.createObjectURL` + a hidden `<a download>` — no dependencies.
- **[↑] Share**: opens the OS native share sheet via the Web Share API (`navigator.share({ files: [file] })`). Allows sending content via email, Messages, AirDrop, or any app registered to handle text files. Hidden when `navigator.canShare()` returns false (primarily affects some desktop browsers); export covers that gap.

**No server calls are made without explicit user action.** The app makes zero network requests on page load, whether the user generated the room or arrived via a shared link. The room ID is always available in the URL; a copy icon sits next to it in the header.

#### Responsive Layout

Mobile-first. The textarea fills the viewport height minus the header. On desktop, a max-width constraint (e.g. 800px) centers the layout. Touch targets are at least 44×44px. No horizontal scrolling at any viewport width.

#### Connection Status Indicator

CSS-only colored dot:
- Gray: disconnected / waiting
- Yellow (pulsing): connecting / ICE checking
- Green: connected
- Red: error / connection failed

#### Focus Mode

A distraction-free mode that hides everything except the textarea. Activated by double-clicking the textarea or pressing `F` (when the textarea is not focused). Exited with `Escape` or by moving the mouse to the top edge of the viewport (reveals a minimal exit button).

In focus mode: header, connection buttons, status indicator, and settings are all hidden. The textarea fills the full viewport. Implemented as a `focusMode` Svelte store; a CSS class on the root element handles the visual transition.

#### Theming

All colors are defined as CSS custom properties on `:root`. Two built-in themes (light and dark) ship as JSON configs. Users can supply their own theme as a JSON object with the same property set, pasted or imported via the settings panel. The active theme config is stored in `localStorage` (theme data only — not document content).

Minimal theme shape:
```json
{
  "name": "forest",
  "--color-bg": "#1a2e1a",
  "--color-surface": "#243824",
  "--color-text": "#c8e6c8",
  "--color-text-muted": "#7aab7a",
  "--color-accent": "#4caf50",
  "--color-border": "#2d4a2d",
  "--color-status-waiting": "#7aab7a",
  "--color-status-connecting": "#f0c040",
  "--color-status-connected": "#4caf50",
  "--color-status-error": "#e05555"
}
```

Theme application is a single `Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v))`. Light/dark auto-detection uses `prefers-color-scheme` as the initial default, overridden by any explicit user selection stored in `localStorage`.

#### QR Mode UI Flow

Overlay with numbered steps:

```
┌─────────────────────────────────────┐
│  Step 1 of 2                        │
│                                     │
│  Show this to the other device:     │
│                                     │
│  ┌───────────┐                      │
│  │  [QR CODE]│                      │
│  └───────────┘                      │
│                                     │
│  When they show you theirs:         │
│  [→ Scan their QR]                  │
└─────────────────────────────────────┘
```

Step 2 activates the camera. Once a valid QR is scanned, connection proceeds automatically.

---

## 6. Step-by-Step Build Order

### Phase 0: Scaffolding

1. `vp create` using the `vite:monorepo` template to generate root workspace structure
2. Bootstrap client package using the `svelte` template: `vp create svelte packages/client`
3. Bootstrap signalling: manual `package.json` + `tsconfig.json`
4. Create `tsconfig.base.json` at root
5. Add `.gitignore`, `.nvmrc`
6. `vp install` from root — verify pnpm hoisting works

**Deliverable**: Correctly structured monorepo that installs without errors.

### Phase 1: ID System

1. Curate wordlist (source from EFF long wordlist, filter to 2048 qualifying words)
2. Implement `generate.ts`
3. Wire up `main.ts`: read URL, generate ID if needed, `history.replaceState`
4. Display ID prominently in placeholder UI

**Deliverable**: Opening the app generates and displays a room ID in the URL.

### Phase 2: Signalling Server

1. `vp add ws` in `packages/signalling`
2. Define message types in `types.ts`
3. Implement `rooms.ts` (max 2 peers, peer tracking, cleanup)
4. Implement `server.ts` (WebSocket upgrade, message routing, ping/pong)
5. Manual test with two `wscat` connections

**Deliverable**: Standalone WebSocket server that relays messages between two peers.

### Phase 3: WebRTC — Signalling Mode

1. Implement `signalling.ts` — WebSocket client, room join, event emission
2. Implement `peer.ts` — `RTCPeerManager` with `SignalTransport` interface
3. Connect them; wire role determination (larger UUID = offerer)
4. Verify DataChannel opens between two browser tabs

**Deliverable**: Two tabs on same machine establish a WebRTC DataChannel via local signalling server.

### Phase 4: Yjs Integration

1. `vp add yjs` in `packages/client`
2. Implement `provider.ts`
3. Implement textarea binding with prefix/suffix diff
4. Wire together in `App.svelte`
5. Test real-time sync between two tabs

**Deliverable**: Real-time collaborative editing between two tabs via WebRTC + Yjs.

### Phase 5: QR Mode

1. Implement `sdp-codec.ts`:
   - DTLS fingerprint extractor
   - ICE candidate parser
   - Binary packet encoder/decoder (fingerprint + ufrag + pwd + candidates)
   - SDP template reconstructor
2. Unit test codec: encode real SDP → decode → verify `setRemoteDescription` accepts it
3. Implement `qr-display.ts` (canvas rendering)
4. Implement `qr-scanner.ts` (`BarcodeDetector` + lazy `zxing-wasm` fallback)
5. Implement `QrTransport` satisfying `SignalTransport`
6. Implement QR mode UI in `QrFlow.svelte`
7. Test on two actual physical devices (not simulators — QR scanning requires real hardware)

**Deliverable**: Two phones establish WebRTC connection by scanning each other's QR codes, zero servers.

### Phase 6: Polish and Integration

1. Unify signalling and QR modes into cohesive app flow
2. Connection status indicator
3. Error handling: ICE failure, scan failure, camera permission denied
4. Mobile responsiveness
5. Clipboard copy button for room URL
6. "Waiting for peer..." state
7. Graceful disconnect handling
8. Export to file (Blob + `<a download>`)
9. Web Share API integration with `navigator.canShare()` feature detection

### Phase 7: Deployment

1. Configure Vite build (`base: "/"`, `VITE_SIGNAL_URL` from env)
2. Deploy client to Cloudflare Pages or Netlify (SPA rewrite rule: all → `index.html`)
3. Add `Dockerfile` for signalling server
4. Deploy signalling server to Fly.io or Railway free tier
5. Test end-to-end on two real devices on different networks

---

## 7. Potential Pitfalls and Mitigations

### 7.1 ICE Gathering Timeout in QR Mode

**Problem**: `RTCPeerConnection` may take 5–30 seconds to gather all ICE candidates.

**Mitigation**: Show "Gathering network info..." progress indicator. Hard timeout at 15 seconds — encode whatever candidates have been gathered. This may fail on some networks, but host candidates alone usually suffice on local networks (the primary QR mode use case).

### 7.2 mDNS Hostnames Instead of IP Addresses

**Problem**: Modern Chromium replaces host IPs with `uuid.local` mDNS hostnames as a privacy measure. 36-character hostnames blow up QR payload size.

**Mitigation**: Extract the UUID from the mDNS hostname and encode as raw 16 bytes. Reconstruct the `uuid.local` hostname on the receiving side from those 16 bytes. Mark as mDNS type in the candidate flags byte. Must be tested explicitly on Chrome.

### 7.3 SDP Fingerprint Extraction

**Problem**: DTLS fingerprint is embedded in SDP as `a=fingerprint:sha-256 AA:BB:CC:...`. String parsing is fragile across browser versions.

**Mitigation**: Targeted regex anchored to `a=fingerprint:sha-256 ` prefix. Fallback to SHA-1 if SHA-256 not found. Write unit tests against captured SDP strings from Chrome, Firefox, and Safari.

### 7.4 `BarcodeDetector` Availability

**Problem**: iOS Safari only added `BarcodeDetector` in iOS 17.4 (March 2024). Firefox still lacks it.

**Mitigation**: Dynamic `zxing-wasm` fallback (~500 KB WASM, lazy-loaded). Check `typeof BarcodeDetector !== "undefined"` before use. Note iOS 17.4+ requirement in the QR mode UI.

### 7.5 Camera Permissions Require HTTPS

**Problem**: iOS requires HTTPS for `getUserMedia`. Local dev (HTTP) fails on iOS.

**Mitigation**: Use `vite --https` with a self-signed cert for local dev. Production is always HTTPS (Cloudflare Pages / Netlify provide it automatically).

### 7.6 Symmetric NAT (~10% of connections)

**Problem**: STUN-derived server-reflexive candidates cannot establish a direct P2P connection through symmetric NAT.

**Mitigation**: Document as known v1 limitation. Connection fails with "ICE failed" error. Architecture is ready for TURN — just add TURN URLs to `iceServers` in v2.

### 7.7 Both Peers Simultaneously Sending Offers (Glare)

**Problem**: Both peers receive `peer-joined` simultaneously and both create offers.

**Mitigation**: Lexicographic UUID comparison — larger UUID is always the offerer. Both peers receive all peer IDs in the `joined` server message, enabling local role determination without coordination.

### 7.8 Large SDP From Some Browsers

**Problem**: Some browsers include video/audio codec lines in SDP even for data-channel-only connections.

**Mitigation**: The binary codec ignores all non-essential SDP fields and encodes only fingerprint + candidates. SDP verbosity doesn't affect QR payload size.

---

## 8. What Belongs in v2

### 8.1 TURN Server

Needed for ~10% of users on symmetric NAT. Twilio NTS provides 10 GB/month free — for ephemeral text, actual TURN-relayed traffic is tiny. Architecture is ready: add TURN URLs to `iceServers`.

### 8.2 File Sharing

Small files over the same `RTCDataChannel` using binary messages. Main challenges: chunking (256 KB DataChannel message size limit) and progress UI. Files never touch the server.

### 8.3 Signalling Server SDP Encryption

Encrypt SDP offers/answers with a key derived from the room ID before sending to the signalling server. Server relays opaque blobs. The room ID itself serves as the shared secret — peers derive the same key independently.

### 8.4 Multi-Peer (3+)

Yjs handles it natively. The WebRTC layer needs to manage multiple connections (mesh topology for small N). Signalling server needs to allow >2 peers per room.

### 8.5 Persistent Sessions

`y-indexeddb` to persist document state in the browser. Survives page refreshes. Still never touches a server.

### 8.6 Geo-Based Room IDs

Derive the room ID from physical location rather than a random phrase. Two people in the same place automatically land in the same session without sharing a URL — useful for impromptu laptop-to-phone transfers at a fixed desk.

Geo mode is a **room ID derivation mechanism only** — it produces a 3-word room ID using the same wordlist as the random ID path, then hands off to the standard `WebSocketTransport` for the WebRTC handshake. The `SignalTransport` interface is unchanged.

No server calls or permission requests are made on page load. The signalling server is only contacted when the user explicitly taps a connect action. Geolocation is only requested when the user taps "Connect nearby", making the browser prompt contextually motivated.

No external API is needed. The mapping is a pure client-side hash:

```
quantize(lat, lng, precision)  →  "37.422,-122.084"
SHA-256("37.422,-122.084")     →  32 bytes
bytes[0..4]                    →  three 11-bit indices into the existing 2048-word wordlist
```

This reuses the existing wordlist and is ~40 lines of TypeScript using `crypto.subtle.digest`.

**Adaptive precision**: The Geolocation API's `coords.accuracy` reports the device's estimated error radius in meters. Cell size is chosen automatically based on this value rather than requiring the user to pick a mode:

| `coords.accuracy` | Decimal places | Cell size | Typical context |
|---|---|---|---|
| < 20m | 4 | ~11m | Outdoors, good signal |
| < 120m | 3 | ~111m | Indoors, urban canyon |
| ≥ 120m | — | — | Warn user; accuracy too poor to match reliably |

The UI displays the current accuracy reading and active cell size so both parties can confirm they are on the same tier. Two devices that resolve to different precision tiers will not produce matching IDs — the display makes this immediately visible.

Because anyone within the same cell derives the same 3-word phrase, a passphrase is required to prevent nearby snooping. The passphrase is never transmitted — it is incorporated into the signalling room ID itself:

```
geo words:            "apple-river-moon"    ← shown in URL and UI
user passphrase:      "forest-table"        ← randomly generated, 2 words

signalling room ID:   SHA-256("apple-river-moon" + "forest-table")
                      → "a3f8c2d1e4b..."    ← sent to server, never shown to user
```

The passphrase is **randomly generated** from 2 words drawn from the existing 2048-word list (2048² ≈ 4.2 million combinations — stronger than a 6-digit PIN). A refresh button generates a new one. Users can also type a custom passphrase. Both peers enter the same passphrase independently on their own devices; a mismatch lands them in a different room with no error, preserving privacy.

This means geo users and random users can never collide on the signalling server: a random user who generates `/apple-river-moon` joins the `apple-river-moon` room; the geo users are in the SHA-256-derived room. A wrong passphrase lands in a different room entirely — no post-connection verification step needed.

The raw SHA-256 hex string is used as the signalling room ID directly. Converting it back to words would compress 256 bits to ~33 bits and reintroduce collisions, so it is left as-is. The server never exposes room IDs to clients, so the format is invisible to users.

**Collision notes (geo words only)**: With a hash-based mapping across 2048³ ≈ 8.6 billion possible word triples, geo word collisions are negligible locally — at 11m precision the probability that any cell within 1km hashes to your same word triple is roughly 1-in-330,000. The passphrase-derived signalling room ID has effectively zero collision probability.

### 8.7 Encrypted Solo Mode

A single-device, encrypted notepad mode backed by IndexedDB. Content never leaves the device and is encrypted at rest using the WebCrypto API, unlocked by a passkey (Face ID / Touch ID / Windows Hello) or passphrase. The [`@lo-fi/local-vault`](https://github.com/lo-fi-dev/local-vault) library provides a tested abstraction over WebCrypto + IndexedDB for this pattern.

Note: passkey decryption is tied to the device's platform authenticator by default. Cross-device access requires a cross-device passkey (iCloud Keychain, etc.) or passphrase-based encryption instead.

### 8.8 Collaborative Code Editor

The app has three editor modes toggled via a header control: **Note** (plain textarea, v1), **Code** (CodeMirror 6, v2), and **Preview** (rendered markdown, v2). "Note mode" is the term for the current plain-text experience — distinct from "code editor" and consistent with the app name.

The Code editor mode is built on **CodeMirror 6** + **`y-codemirror.next`**, lazy-loaded entirely on demand so the main bundle is unaffected.

The switch between Note and Code modes is synced between peers via a `Y.Map("meta")` entry so both sides switch together (both peers need the same editor active to collaborate). The underlying `Y.Text("content")` is reused — no document state is lost when switching modes.

**Bundle strategy:**

| Chunk | Size (gzipped) | When loaded |
|---|---|---|
| Main bundle | ~90–110 KB | Always |
| CodeMirror core (`@codemirror/view` + `@codemirror/state` + `y-codemirror.next`) | ~45 KB | On first switch to code mode |
| Language pack (e.g. `@codemirror/lang-javascript`) | ~5–20 KB each | On language selection |

**Features included:**
- Syntax highlighting
- Line numbers (toggleable)
- Bracket matching and auto-close
- Smart indentation / Tab key behaviour
- Language selector (dropdown of common languages)

**Explicitly excluded** to preserve leanness:
- LSP / autocomplete / intellisense
- Multi-file / tabs
- Diff view

### 8.9 Markdown Preview Mode

A read-only rendered view of the `Y.Text("content")` document, activated by switching to **Preview** mode. Lazy-loads a ~31 KB chunk on first use; the main bundle is unaffected.

| Chunk | Size (gzipped) | When loaded |
|---|---|---|
| `marked` | ~25 KB | On first switch to Preview mode |
| `DOMPurify` | ~6 KB | Bundled with `marked` — required for safe `innerHTML` rendering |

Preview re-renders on each Yjs document update. The source is always `Y.Text("content")` — no separate document or additional sync logic.

**Preview mode is local, not synced between peers.** Each peer independently chooses their rendering view. Unlike Code mode (where both peers must have the same editor active), Preview is purely a read-only display concern and requires no coordination.

On desktop, Preview renders as a split pane (write on the left, rendered output on the right). On mobile, the `[ Note ] [ Code ] [ Preview ]` toggle switches the full viewport between modes.

### 8.10 Symmetric QR Exchange (QWBP-style)

Both devices display and scan simultaneously, halving the time. More complex UI (camera + display active at once) and role determination by fingerprint comparison. See the QWBP article for the full protocol.

### 8.11 PWA / Installable

Add `manifest.json` and a service worker that caches the app shell. Enables "Add to Home Screen" on mobile.

---

## 9. Summary of Dependencies

### `packages/client`

| Package | Purpose | Bundle Impact |
|---|---|---|
| `svelte` | UI framework | ~10 KB gzipped runtime (main chunk) |
| `yjs` | CRDT document | ~20 KB gzipped (main chunk) |
| `y-protocols` | Yjs sync protocol messages | Transitive dep of yjs |
| `qrcode` | QR code generation | ~40 KB (main chunk) |
| `zxing-wasm` | QR scanning fallback | ~500 KB WASM — **lazy, only loaded when `BarcodeDetector` unavailable** |
| `@codemirror/view` + `@codemirror/state` | Code editor core (v2) | ~40 KB — **lazy, only loaded when code mode activated** |
| `y-codemirror.next` | Yjs binding for CodeMirror 6 (v2) | ~5 KB — **lazy, bundled with code editor chunk** |
| `@codemirror/lang-*` | Language packs (v2) | ~5–20 KB each — **lazy, loaded per language selection** |
| `marked` | Markdown parser (v2) | ~25 KB — **lazy, only loaded when Preview mode activated** |
| `DOMPurify` | HTML sanitization for markdown output (v2) | ~6 KB — **lazy, bundled with `marked`** |

No `simple-peer`. No `y-webrtc`.

### `packages/signalling`

| Package | Purpose |
|---|---|
| `ws` | WebSocket server |
| `tsx` | Dev-only TS runner (devDependency) |

### Target Bundle Size

- Core JS (main chunk): Svelte + Yjs + qrcode + app code ≈ **90–110 KB gzipped**
- Lazy chunk (zxing-wasm): ~500 KB, loaded only as BarcodeDetector fallback

Well within the minimal bundle size goal for the main critical path.
