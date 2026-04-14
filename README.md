# notapipe

> Ephemeral, peer-to-peer text, voice, and file sharing. No servers ever see your content.

## What notapipe is for

The modern productivity stack — Google Docs, Slack, Gmail, Zoom — generates a permanent, searchable, subpoenable record of nearly everything you do. notapipe is a suite that systematically replaces those tools for conversations that should not exist in a log:

- **Sensitive negotiations** — lawyers, executives, M&A discussions where discovery risk is real
- **Source protection** — journalists communicating with sources without a Slack thread or email chain
- **Whistleblowing and activist coordination** — communication that must not persist
- **Password and secret transfer** — send a credential without it passing through Gmail, iMessage, or Slack's servers
- **Cross-device text transfer** — move a snippet, a link, or a file from your work machine to your personal machine without emailing yourself or signing into anything
- **Any zero-trace scratchpad** — two people, one shared surface, gone when the tab closes

Everything disappears when both tabs close. That is not scope creep — it is the point.

---

## Threat model

**What notapipe protects against:**

- Your document content, chat messages, voice audio, and transferred files reaching any server — in all modes, content travels only peer-to-peer via encrypted WebRTC data channels
- Server-side logs of what you wrote, said, or sent
- Persistent records: nothing is stored server-side; browser storage is opt-in and local-only (see below)

**What you should know:**

- **Signalling mode contacts a server.** The default connection method uses a signalling server to broker the WebRTC handshake. The server sees only the room ID and WebRTC metadata (SDP/ICE candidates) — never document content. If even that contact is unacceptable, use **QR mode** (see below), which is fully serverless.
- **The room URL is a shared secret.** Your room is identified by a URL path like `notapipe.app/autumn-river-moon`. Anyone who has that URL can join the room. If you share the URL via Gmail, Slack, or iMessage to arrange the session, those platforms now have the room identifier. For high-sensitivity use, share the URL out-of-band (in person, via an already-secure channel), or skip URL sharing entirely by using **QR mode**.
- **Persistence is ephemeral by default — but opt-in storage is not.** If you enable "Save document" in Settings, content is written to your browser's IndexedDB and **survives tab close and browser restart**. A hard-drive icon in the header indicates when this is active. If you enabled it and forgot, your document is no longer ephemeral. Disable it in Settings → Storage to return to ephemeral mode.
- **No formal security audit has been performed.** notapipe is appropriate for operational security hygiene and reducing your exposure to routine discovery and surveillance. It has not been independently audited and should not be treated as the sole protection in a high-stakes adversarial threat environment.

**QR mode is the most private connection method.** It encodes the full WebRTC handshake into a QR code — no server contact whatsoever, not even for the initial handshake. If you are in the same physical location as your peer, QR mode is the recommended path for sensitive use.

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
- **Local persistence** — opt-in `localStorage`/IndexedDB save; off by default; never synced to a server
- **PWA** — installable on desktop and mobile; works offline after first load

---

## How it works

Two or more peers open the same URL — identified by a memorable 3-word path like `/autumn-river-moon` — and connect via one of two methods:

**Signalling mode** (default): A lightweight WebSocket server brokers the WebRTC handshake. The server sees the room ID and connection metadata only — never document content. Once connected, the server is no longer involved.

**QR mode** (most private): The WebRTC offer/answer is compressed into a binary QR code — typically ~78 bytes — and exchanged by scanning. No server contact at all. Recommended for sensitive use when peers are physically co-located.

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

**Self-hosting note:** For high-sensitivity deployments, self-hosting both the client and signalling server means no third party handles even the WebRTC metadata. QR mode eliminates the signalling server entirely.

## Credits

The QR air-gapped WebRTC technique — semantically compressing an SDP offer into a scannable binary QR code — is based on the research and protocol design by **Mario Garcia**:

> [Air-gapped WebRTC: Breaking the QR Limit](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)

The focus mode aesthetic — warm paper palette, ruled lines, IBM Plex Mono — is inspired by **Brandon Alvendia**'s [scratchpad](https://post-content.github.io/scratchpad/).

The 3-word room ID wordlist is derived from the [EFF Long Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases), released into the public domain.

## License

MIT — see [LICENSE](LICENSE).

Third-party notices (including Apache 2.0 components) — see [NOTICES](NOTICES).
