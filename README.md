# notapipe

> Ephemeral, local-first, peer-to-peer text sharing. No servers ever see your content.

Two people open the same URL — identified by a memorable 3-word phrase — and their text stays in sync via Yjs CRDTs over a WebRTC data channel. The signalling server only brokers the WebRTC handshake and sees no document content. In QR mode, even that middleman is eliminated.

**No server calls are made without your explicit action.**

---

## How it works

- Each browser tab generates (or reads from the URL) a **3-word room ID** like `apple-river-moon`
- Two or more peers connect either via the **signalling server** (same Wi-Fi or internet) or via **QR code** (fully air-gapped — no server at all)
- Text is synchronised using **Yjs CRDTs** over a WebRTC data channel — conflicts merge automatically
- Nothing is stored server-side. Content lives only in the browser tabs that are open

## Features

- **Signalling & QR connection modes** — use whichever fits your threat model
- **Multi-peer mesh** — connect more than two devices; each pair syncs independently
- **Focus mode** — distraction-free writing with a ruled-paper aesthetic (`Cmd+F`)
- **Theming** — built-in light/dark themes plus a fully customisable token editor
- **Local persistence** — optional `localStorage` save (off by default)
- **Import / export / share** — load a `.txt` file, save one, or share the room link
- **PWA** — installable on desktop and mobile; works offline after first load

## Packages

| Package | Description |
|---|---|
| `packages/client` | Vite + Svelte 5 + TypeScript frontend |
| `packages/signalling` | Node.js WebSocket signalling server |

## Quick start

```bash
# Install all workspace dependencies
vp install

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
