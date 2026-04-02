# notapipe

> Ephemeral, local-first, peer-to-peer text sharing. No servers ever see your content.

Two people open the same URL — identified by a memorable 3-word phrase — and their text stays in sync via Yjs CRDTs over a WebRTC data channel. The signalling server only brokers the WebRTC handshake and sees no content. In QR mode, even that middleman is eliminated.

## Typical use case

Copy a list of links from your laptop to your phone:
1. Go to notapipe in your browser → get a room like `apple-river-moon`
2. Choose connection method: Network (uses signalling server) or QR (truly serverless)
3. Open the same URL on your phone, or scan the QR code
4. Type or paste on either device — the other updates instantly

## Packages

- `packages/client` — Vite + TypeScript frontend
- `packages/signalling` — Node.js WebSocket signalling server

## Documentation

- [Architecture Plan](docs/architecture.md) — full implementation blueprint
- [QR Mode Deep-Dive](docs/qr-mode.md) — air-gapped WebRTC via QR codes

## Quick Start

```bash
npm install
# Run both packages in dev mode:
npm run dev
```
