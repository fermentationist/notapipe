# notapipe

> Ephemeral, local-first, peer-to-peer text sharing. No servers ever see your content.

## About notapipe

notapipe is an ephemeral, local-first, peer-to-peer text and file sharing tool.

Two people open the same URL — identified by a memorable 3-word phrase — and their text syncs in real time via [Yjs](https://yjs.dev) CRDTs over a WebRTC data channel. **No user text ever touches a server.** The signalling server only relays WebRTC handshake metadata, and even that is eliminated in QR mode.

### Use it for

- Quickly sharing a snippet of text, code, a link or a file between your own devices
- Collaborating on a note with someone in the same room
- Chatting and talking with a peer without any account or cloud service
- Transferring a password or secret without it passing through any cloud service
- Any time you need a zero-friction, zero-trace scratchpad between two people

### Features

- Real-time sync with no account, no login, no installation
- QR code pairing — no signalling server at all
- File transfer (up to 100 MB) directly peer-to-peer
- **Chat** — real-time text chat between peers, separate from the shared document
- **Voice calls** — peer-to-peer audio using the same WebRTC connection
- Markdown preview
- Syntax-highlighted code editor (14 languages)
- Works offline once loaded (PWA)
- Persistent storage is opt-in and local only

---

The primary use case: you want to move a piece of text from one device to another — phone to laptop, work machine to personal machine — without emailing yourself, opening a chat app, or signing into anything. Open the same room URL on both devices, choose your connection method, wait for the green connection indicator, and the text syncs instantly. Hit the copy button and paste it wherever you need it.

Two or more peers open the same URL — identified by a memorable 3-word phrase — and their text stays in sync via Yjs CRDTs over a WebRTC data channel. The signalling server only brokers the WebRTC handshake and sees no document content. In QR mode, even that middleman is eliminated.

**No server calls are made without your explicit action.**

---

## How it works

- Each browser tab generates (or reads from the URL) a **3-word room ID** like `apple-river-moon` plus a random **`#token`** fragment — e.g. `notapipe.app/apple-river-moon#k7mX9qPw`
- Two or more peers connect either via the **signalling server** (same Wi-Fi or internet) or via **QR code** (fully air-gapped — no server at all)
- The `#token` is verified during the WebRTC handshake; only peers who share the full URL can connect — the signalling server never sees the token
- Text is synchronised using **Yjs CRDTs** over a WebRTC data channel — conflicts merge automatically
- Nothing is stored server-side. Content lives only in the browser tabs that are open (and optionally in `localStorage` for persistence across reloads)

## Features

- **Signalling & QR connection modes** — use whichever fits your security needs
- **Multi-peer mesh** — connect more than two devices; each pair syncs independently
- **Chat** — real-time text chat panel between all connected peers; separate from the shared document; optional per-room chat log persistence
- **Voice calls** — peer-to-peer audio using the same WebRTC connection; no server handles your audio
- **Markdown preview** — toggle a live rendered view alongside the editor (`M↓`); local-only, does not affect peers
- **Wide layout** — desktop toggle to expand beyond the default centred column; preference persists across sessions
- **Focus mode** — distraction-free writing with a ruled-paper aesthetic (`Cmd+F`)
- **Code editor mode** — syntax highlighting for 14 languages, bracket matching, and line commands (`</>` button)
- **Theming** — built-in light/dark themes plus a fully customisable token editor
- **Local persistence** — optional `localStorage` save for documents and chat logs (off by default)
- **One-tap copy** — copy all editor content to clipboard instantly (the primary cross-device transfer action)
- **Import / export / share** — load a `.txt` file, save one, or share the room link
- **File transfer** — send any file (up to 100 MB) directly to all connected peers, no server involved
- **PWA** — installable on desktop and mobile; works offline after first load

## Packages

| Package               | Description                           |
| --------------------- | ------------------------------------- |
| `packages/client`     | Vite + Svelte 5 + TypeScript frontend |
| `packages/signalling` | Node.js WebSocket signalling server   |

## Quick start

You will need Node.js 18+ and pnpm installed globally

```bash
# Install all workspace dependencies
vp install # this assumes you have vite-plus installed globally; if not, run `npm install -g vite-plus` first

# Run client dev server + signalling server concurrently
vp dev
```

The client runs at `https://localhost:5173` (HTTPS required for camera/PWA features).  
The signalling server runs at `ws://localhost:3001`.

```bash
vp build          # production build
vp test           # run unit tests
vp check          # format + lint + type-check
vp check --fix    # auto-fix format/lint issues
```

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

## Credits

The QR air-gapped WebRTC technique — semantically compressing an SDP offer into a scannable binary QR code — is based on the research and protocol design by **Mario Garcia**:

> [Air-gapped WebRTC: Breaking the QR Limit](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)

The focus mode aesthetic — warm paper palette, ruled lines, IBM Plex Mono — is inspired by **Brandon Alvendia**'s [scratchpad](https://post-content.github.io/scratchpad/).

The 3-word room ID wordlist is derived from the [EFF Long Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases), released into the public domain.

## License

MIT — see [LICENSE](LICENSE).

Third-party notices (including Apache 2.0 components) — see [NOTICES](NOTICES).
