# notapipe

> Ephemeral, local-first, peer-to-peer text sharing. No servers ever see your content.

Two people open the same URL — identified by a memorable 3-word phrase — and their text stays in sync via Yjs CRDTs over a WebRTC data channel. The signalling server only brokers the WebRTC handshake and sees no content. In QR mode, even that middleman is eliminated.

**No server calls are made without your explicit consent.**

## Typical use case

Copy a list of links from your laptop to your phone:
1. Go to notapipe in your browser → get a room like `apple-river-moon`
2. Choose connection method: Network (uses signalling server) or QR (truly serverless)
3. Open the same URL on your phone, or scan the QR code
4. Type or paste on either device — the other updates instantly

## Packages

- `packages/client` — Vite + Svelte + TypeScript frontend
- `packages/signalling` — Node.js WebSocket signalling server

## Quick Start

```bash
vp install
vp dev
```

## Documentation

- [Architecture Plan](docs/architecture.md) — full implementation blueprint
- [QR Mode Deep-Dive](docs/qr-mode.md) — air-gapped WebRTC via QR codes

## Credits

The QR air-gapped WebRTC technique — semantically compressing an SDP offer into a scannable binary QR code — is based on the research and protocol design by **Mario Garcia**:

> [Air-gapped WebRTC: Breaking the QR Limit](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)

The 3-word room ID wordlist is derived from the [EFF Long Wordlist](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases), released into the public domain.

## License

MIT — see [LICENSE](LICENSE).

Third-party notices (including Apache 2.0 components) — see [NOTICES](NOTICES).
