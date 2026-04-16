# notapipe

>---
>
>**Move data between devices. No storage. No trail.**
>*It's like AirDrop – but ephemeral, cross-platform, and serverless.*
>
>---

[notapipe](https://notapipe.app) is a peer-to-peer data bridge for transferring information directly between devices—without uploading it, saving it, or leaving a record.

*No accounts.*
*No backend.*
*No history.*

Your data exists only while you’re using it.

---


## Why this exists

Most tools turn everything into a file, a document, or a message.

But sometimes you just need to:

- move data between work and personal devices  
- transfer files without email or cloud storage  
- share something sensitive without leaving a record  
- use a shared or temporary machine safely  
- collaborate briefly without creating artifacts  

notapipe is built for those moments.

---

## Core properties

#### Ephemeral by default

- Sessions are not stored  
- There is no backend database  
- Closing the session destroys the data  

If you don’t explicitly save it, it doesn’t exist.

---

#### Direct device-to-device transfer

- Peer-to-peer connections over WebRTC  
- End-to-end encrypted  
- No server ever sees your data  

Optional QR mode can eliminate even the need for a signalling server.

---

#### Works with text and files

- Paste or type text  
- Drag and drop files between devices  
- Transfer structured or unstructured data  

The editor is just the interface—the goal is moving data.

---

#### Local-first execution

- All operations happen locally  
- Instant updates using CRDTs (Yjs)  
- No waiting on a server once connected  

---

#### No trust required

notapipe has no access to your data.

- No accounts  
- No telemetry  
- No cloud storage  

Don’t trust it?

- Inspect the code  
- Run your own signalling server  
- Use QR mode  

There is nothing hidden because there is nowhere for your data to go.

---

#### You stay in control

You decide if anything persists:

- Default: ephemeral sessions  
- Optional: local persistence (IndexedDB)  
- Export your data anytime  

Your data exists only when—and where—you choose.

---

#### Longevity

notapipe is designed to outlive its original host.

- Installable as a PWA  
- Works independently of notapipe.app once installed  
- Uses open standards (WebRTC, IndexedDB)  
- Signalling and TURN servers are fully configurable  
- Open source (MIT), self-hostable, forkable  

If the original service disappears, the app—and your workflow—can continue.

---

## How it works (high level)

- A session creates a shared state (CRDT via Yjs)  
- Peers connect using WebRTC
- Two connection methods:  
  - Signalling mode: lightweight signalling (WebSocket) server brokers the handshake; never sees content  
  - QR mode: full handshake encoded in a binary QR code; no server contact at all
- Data flows directly between devices whenever possible, and is relayed only to establish connectivity—not to store or process content, and remains end-to-end encrypted in transit

**No central server ever stores your data.**

---

## Use cases

- Move data between work and personal devices  
- Transfer files without cloud storage or email  
- Share sensitive information without leaving a trail  
- Use on shared or temporary machines  
- Quick, disposable collaboration  
- Cross-device copy/paste that disappears when done  

---

# Philosophy

[notapipe](https://notapipe.app) is inspired by the principles of [*local-first software*](https://www.inkandswitch.com/essay/local-first/
).

It prioritizes local execution, peer-to-peer communication, and user control over both data and infrastructure.

## Local-first principles

- **Local-first execution**  
  All edits happen locally using CRDTs. Once connected, changes are instant and do not depend on a server.

- **Seamless collaboration**  
  Multiple peers can edit simultaneously with automatic conflict resolution.

- **Privacy by default**  
  Connections are end-to-end encrypted over WebRTC. No server ever has access to your content.

- **Ownership and control**  
  No accounts, no lock-in, open source (MIT), and fully self-hostable.

- **The Long Now**  
  [notapipe](https://notapipe.app) does not depend on any single service or vendor.  
  - It can be installed as a PWA and run independently of [notapipe](https://notapipe.app).app  
  - Signalling and TURN servers are configurable  
  - It uses open web standards (WebRTC, IndexedDB)

  Your ability to use the software—and access your data—does not depend on the continued existence of the original host.

## Data lifecycle: fully user-controlled

[notapipe](https://notapipe.app) gives you explicit control over whether data persists:

- By default, sessions are **ephemeral**
- You can enable **local persistence** (IndexedDB)
- You can **export** your data at any time

There is no backend database and no implicit cloud storage.

> Your data exists only when—and where you choose it to.

## Learn more

For the original local-first philosophy, see:  
https://www.inkandswitch.com/essay/local-first/

---

## Threat model

**What [notapipe](https://notapipe.app) protects:**

- No server can read your content — all data is end-to-end encrypted over WebRTC. By default, content flows directly peer-to-peer. If you configure a TURN relay server, packets are forwarded by that server but remain encrypted and unreadable to it.
- Nothing is stored server-side; browser storage is opt-in and local-only

**What you should know:**

- **Signalling mode contacts a server.** The default connection method uses a signalling server to broker the WebRTC handshake. The server sees only the room ID and connection metadata — never document content. If even that contact is unacceptable, use **QR mode** (see below), which is fully serverless.
- **TURN relay routes encrypted traffic through a third party.** By default, [notapipe](https://notapipe.app) uses STUN only — connections are direct. If you configure a TURN server in Settings → Connection (to traverse a restrictive firewall), traffic is relayed through that server. Traffic is encrypted in transit (DTLS) and the relay cannot decrypt your content, but it is in the network path and can observe packet sizes and timing. File transfers over relayed connections are limited to 5 MB; you can remove this limit by supplying your own TURN credentials.
- **Sharing the room URL through a third-party service.** Your room is identified by a full URL like `notapipe.app/autumn-river-moon#HwDW_XR2pDI`. The `#fragment` is a randomly generated access token (~96 bits of entropy) that browsers never include in HTTP requests, so it never reaches any server. However, if you paste the full URL into Gmail, Slack, or iMessage to arrange a session, those services receive both the path and the token. For sensitive use, share the URL in person or via an already-trusted channel — or use QR mode to skip URL sharing entirely.
- **Enabling persistence breaks ephemerality.** If you enable "Save document" in Settings, content is written to your browser's IndexedDB and survives tab close and browser restart. A hard-drive icon in the header indicates when this is active. Disable it in Settings → Storage to return to ephemeral mode.
- **No independent security audit has been performed.**

**QR mode is the most private connection method.** It encodes the full WebRTC handshake into a QR code — no server contact whatsoever. If you are in the same physical location as your peer, this is the recommended approach.

---

## Features

- **Real-time collaborative editor** — text syncs via Yjs CRDTs over a WebRTC data channel; conflicts merge automatically
- **QR pairing** — fully serverless; no signalling server at all
- **Chat** — real-time text chat between peers, separate from the shared document; no server handles or logs messages
- **Voice calls** — peer-to-peer audio; no server can hear your audio; calls end automatically after 4 hours
- **File transfer** — send files up to 100 MB directly to peers (5 MB cap on relayed connections); no server can read the files
- **Multi-peer mesh** — more than two devices; each pair syncs independently
- **Markdown preview** — toggle a live rendered view alongside the editor; local-only
- **Code editor mode** — syntax highlighting for 14 languages, bracket matching, line commands
- **Theming** — built-in light/dark themes plus a fully customisable token editor (⌘K → Theme)
- **Focus mode** — distraction-free writing (⌘F)
- **Local persistence** — opt-in IndexedDB/localStorage save; off by default; never synced to a server
- **PWA** — installable on desktop and mobile; works offline after first load

---

## How it works

Two or more peers open the same URL — identified by a memorable 3-word path like `/autumn-river-moon` — and connect via one of two methods:

**Signalling mode** (default): A lightweight WebSocket server brokers the WebRTC handshake. The server sees the room ID and connection metadata only — never document content. Once connected, the server is no longer involved.

**QR mode** (most private): The WebRTC offer/answer is compressed into a binary QR code — typically ~78 bytes — and exchanged by scanning. No server contact at all. Recommended when peers are physically co-located.

After the handshake, all data — text, chat, voice, files — is end-to-end encrypted over WebRTC. By default it flows directly browser-to-browser. If you have configured a TURN relay, the relay forwards packets but cannot decrypt them.

---

## Development

### Quick start

You will need Node.js 18+ and pnpm installed globally.

```bash

# Install all workspace dependencies
pnpm install

# Run client dev server + signalling server concurrently
pnpm dev
```

The client runs at `https://localhost:5173`.  
The signalling server runs at `wss://localhost:3001/ws`.

```bash
pnpm build          # production build
pnpm test           # run unit tests
pnpm check          # format + lint + type-check
pnpm check --fix    # auto-fix format/lint issues
```

## Packages

| Package               | Description                           |
| --------------------- | ------------------------------------- |
| `packages/client`     | Vite + Svelte 5 + TypeScript frontend |
| `packages/signalling` | Node.js WebSocket signalling server   |

## Documentation

- [User Guide](docs/user-guide.md) — UI walkthrough, connection workflows, theming, PWA installation
- [Architecture](docs/architecture.md) — system design and implementation blueprint
- [QR Mode Deep-Dive](docs/qr-mode.md) — air-gapped WebRTC via QR codes

## Deployment

The client is a static SPA — deploy `packages/client/dist` to any static host. Configure the host to serve `index.html` for all paths (SPA rewrite rule).

Set `VITE_SIGNAL_URL` at build time to point the client at your signalling server:

```bash
VITE_SIGNAL_URL=wss://signal.example.com/ws vp build
```

The signalling server is a plain Node.js process — run it behind a reverse proxy (nginx, Caddy) that terminates TLS and forwards `/ws` as a WebSocket upgrade.

**Self-hosting:** For privacy-sensitive deployments, self-hosting both the client and signalling server means no third party handles even the WebRTC metadata. QR mode eliminates the signalling server entirely.

## Credits

The QR air-gapped WebRTC technique — semantically compressing an SDP offer into a scannable binary QR code — is based on the research and protocol design by **Mario Garcia**:

> [Air-gapped WebRTC: Breaking the QR Limit](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)

The focus mode aesthetic — warm paper palette, ruled lines, IBM Plex Mono — is inspired by **Brandon Alvendia**'s [scratchpad](https://post-content.github.io/scratchpad/).

The 3-word room ID wordlist is derived from the [EFF Long Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases), released into the public domain.

## License

MIT — see [LICENSE](LICENSE).

Third-party notices (including Apache 2.0 components) — see [NOTICES](NOTICES).
