# notapipe

> Ephemeral, local-first, peer-to-peer text sharing. No servers ever see your content.

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
- **Markdown preview** — toggle a live rendered view alongside the editor (`M↓`); local-only, does not affect peers
- **Wide layout** — desktop toggle to expand beyond the default centred column; preference persists across sessions
- **Focus mode** — distraction-free writing with a ruled-paper aesthetic (`Cmd+F`)
- **Theming** — built-in light/dark themes plus a fully customisable token editor
- **Local persistence** — optional `localStorage` save (off by default)
- **One-tap copy** — copy all editor content to clipboard instantly (the primary cross-device transfer action)
- **Import / export / share** — load a `.txt` file, save one, or share the room link
- **File transfer** — send any file (up to 100 MB) directly to all connected peers, no server involved
- **PWA** — installable on desktop and mobile; works offline after first load

## Packages

| Package | Description |
|---|---|
| `packages/client` | Vite + Svelte 5 + TypeScript frontend |
| `packages/signalling` | Node.js WebSocket signalling server |

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
