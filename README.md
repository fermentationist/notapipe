# notapipe

> Ephemeral, peer-to-peer text, voice, and file sharing. No servers ever see your content.

## What notapipe is for

The primary use case: you want to move a piece of text, a file, or a password from one device to another — phone to laptop, work machine to personal machine — without emailing yourself, opening a cloud app, or signing into anything. Open the same room URL on both devices, connect, and the content syncs instantly. Close both tabs and it's gone.

notapipe is also useful anywhere you want a conversation or file exchange that doesn't leave a permanent record in a cloud service:

- **Cross-device transfer** — move a snippet, a link, a file, or a password between your own devices without routing it through email or a cloud drive
- **Sensitive conversations** — chat and collaborate without the exchange persisting in a server log
- **Secret or credential sharing** — send a password or API key to someone without it passing through a third-party service
- **Quick collaboration** — a shared scratchpad with someone nearby, no account or installation required

---

## Threat model

**What notapipe protects:**

- Document content, chat messages, voice audio, and transferred files never reach any server — content travels only peer-to-peer over encrypted WebRTC data channels
- Nothing is stored server-side; browser storage is opt-in and local-only

**What you should know:**

- **Signalling mode contacts a server.** The default connection method uses a signalling server to broker the WebRTC handshake. The server sees only the room ID and connection metadata — never document content. If even that contact is unacceptable, use **QR mode** (see below), which is fully serverless.
- **Sharing the room URL through a third-party service.** Your room is identified by a full URL like `notapipe.app/autumn-river-moon#HwDW_XR2pDI`. Connecting requires *both* the path and the `#fragment` — the fragment is the access token and is never sent to any server (browsers never include fragments in HTTP requests). However, if you paste the full URL into Gmail, Slack, or iMessage to arrange a session, those services receive both pieces. For sensitive use, share the URL in person or via an already-trusted channel — or use QR mode to skip URL sharing entirely.
- **Enabling persistence breaks ephemerality.** If you enable "Save document" in Settings, content is written to your browser's IndexedDB and survives tab close and browser restart. A hard-drive icon in the header indicates when this is active. Disable it in Settings → Storage to return to ephemeral mode.
- **No independent security audit has been performed.**

**QR mode is the most private connection method.** It encodes the full WebRTC handshake into a QR code — no server contact whatsoever. If you are in the same physical location as your peer, this is the recommended approach.

---

## Features

- **Real-time collaborative editor** — text syncs via Yjs CRDTs over a WebRTC data channel; conflicts merge automatically
- **QR pairing** — fully serverless; no signalling server at all
- **Chat** — real-time text chat between peers, separate from the shared document; no server handles or logs messages
- **Voice calls** — peer-to-peer audio; no server handles your audio
- **File transfer** — send any file up to 100 MB directly to all connected peers; no server involved
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

After the handshake, all data — text, chat, voice, files — flows directly between browsers over encrypted WebRTC data channels.

---

## Quick start

You will need Node.js 18+ and pnpm installed globally.

```bash
# Install vite-plus CLI (build tool used by this project)
npm install -g vite-plus

# Install all workspace dependencies
vp install

# Run client dev server + signalling server concurrently
vp dev
```

The client runs at `https://localhost:5173`.  
The signalling server runs at `ws://localhost:3001`.

```bash
vp build          # production build
vp test           # run unit tests
vp check          # format + lint + type-check
vp check --fix    # auto-fix format/lint issues
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
