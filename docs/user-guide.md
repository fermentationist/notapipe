# notapipe — User Guide

**Version 0.0.1 · April 2026**

> Screenshots are intentionally omitted from this version of the guide — the UI is still evolving and static images go stale quickly. All UI elements are described by their visible label or icon.

---

## Table of contents

1. [What is notapipe?](#what-is-notapipe)
2. [The interface at a glance](#the-interface-at-a-glance)
3. [Rooms and room IDs](#rooms-and-room-ids)
4. [Connecting to another device](#connecting-to-another-device)
   - [Via signalling server](#via-signalling-server)
   - [Via QR code (air-gapped)](#via-qr-code-air-gapped)
   - [Adding more devices](#adding-more-devices)
5. [The editor](#the-editor)
6. [Focus mode](#focus-mode)
7. [Importing and exporting text](#importing-and-exporting-text)
8. [Sending and receiving files](#sending-and-receiving-files)
9. [Sharing](#sharing)
10. [Themes](#themes)
11. [Settings and persistence](#settings-and-persistence)
12. [Installing as an app (PWA)](#installing-as-an-app-pwa)
13. [Clearing data](#clearing-data)
14. [Troubleshooting](#troubleshooting)

---

## What is notapipe?

notapipe is a browser-based tool for sharing text between devices in real time. It uses peer-to-peer WebRTC to sync a shared document directly between browsers — no server ever sees your text.

**The primary use case** is moving text from one machine to another without a cable, cloud account, or chat app. Open the same room URL on both devices, wait for the connection indicator to turn green, and whatever you type on one device instantly appears on the other. Then copy it from the editor with the copy button (bottom-right corner) and paste it wherever you need it.

**Key properties:**
- Nothing you type is stored on any server
- The signalling server only brokers the initial connection handshake; it never sees document content
- In QR mode, no server is involved at all — two devices connect directly
- Content lives only in the browser tabs that are currently open (unless you turn on local persistence)

---

## The interface at a glance

The interface has four main regions:

**Header** (top bar)
- App name (`notapipe`) on the left
- Connection status indicator in the centre
- Utility buttons on the right: import (`↑`), export (`↓`), send file (paperclip icon), share (box-with-arrow icon), clear data (`⊗`), settings (`⚙`)

**Room bar** (below the header)
- The current room ID (e.g. `apple-river-moon`)
- A copy button (two-overlapping-pages icon) to copy the room URL to the clipboard
- A **Find a room** dropdown with options to navigate to a random room or find nearby devices

**Editor** (main area)
- A plain-text textarea that fills the available space
- All connected peers see the same content and can edit simultaneously
- A **copy button** (overlapping-pages icon) in the bottom-right copies all editor text to the clipboard in one tap — useful for transferring the synced content into another app

**Action bar** (bottom)
- When not connected: a **Connect to peer** button that opens a dropdown with connection method options
- When connected: an **Add peer via QR** button and a **Disconnect** button

---

## Rooms and room IDs

Every notapipe session is identified by a **3-word room ID** — a phrase like `marble-cloud-seven` — that appears in the URL (e.g. `https://notapipe.app/marble-cloud-seven`).

- When you open notapipe without a path, a new random room ID is generated for you
- The room ID is the only thing peers need to agree on before connecting — share the URL and both devices are in the same room
- Room IDs are not secret by default. Treat them like a short-lived shared link

### Finding a room

Click **Find a room ▾** in the room bar:

- **Nearby** — derives a room ID from your GPS coordinates. Coordinates are quantised to a 0.001° grid (roughly 111 m × 111 m cells), so devices within the same cell automatically get the same room ID. You will be prompted for location permission. A passphrase field appears so you can narrow the match within a cell if needed (useful in dense areas like offices or apartment buildings)
- **Random** — generates a new random room ID and navigates to it

---

## Connecting to another device

notapipe does not connect automatically when you open a URL. You must explicitly choose a connection method. This ensures no network contact happens without your knowledge.

### Via signalling server

Best for: devices on the same Wi-Fi network, or over the internet when both peers can reach the signalling server.

**Workflow:**
1. Both devices navigate to the same room URL (share the link, or use **Find a room → Nearby**)
2. On one device, click **Connect to peer ▾** → **Use signalling server**
3. The status indicator changes to `waiting for peer…`
4. On the second device, repeat step 2
5. The status indicator on both devices changes to `connected`
6. Start typing on either device — text syncs instantly

The signalling server only relays WebRTC handshake metadata (SDP offer/answer and ICE candidates). It never receives document content.

If the signalling connection drops unexpectedly, notapipe will automatically reconnect and resume listening.

### Via QR code (air-gapped)

Best for: maximum privacy (no server contact at all), or when devices are not on the same network.

In QR mode, the WebRTC offer and answer are encoded as QR codes and exchanged by physically scanning each other's screens. No server is involved at any point.

**Workflow:**

1. On device A, click **Connect to peer ▾** → **Use QR code (air-gapped)**
2. A dialog appears asking who goes first. Choose **Show my QR code first** on device A
3. Wait a few seconds while the screen shows `Gathering network info…` — device A is collecting its network addresses
4. A QR code appears on device A's screen
5. On device B, open the same dialog and choose **Scan their QR code first**
6. Device B's camera opens. Point it at device A's QR code
7. Once scanned, device B automatically generates an answer QR code and displays it
8. On device A, tap **→ Scan their QR** and point device A's camera at device B's screen
9. Once device A scans the answer, both devices show `connecting…` briefly then `connected`

**Note on room IDs and QR:** When device B scans device A's QR code, it adopts device A's room ID. If device B already has content and the room IDs differ, a confirmation dialog will appear before the switch.

**Camera requirements:**
- iOS requires HTTPS for camera access — the app must be served over `https://`
- iOS Safari requires iOS 17.4 or later for in-browser QR scanning
- On older devices, a fallback scanner (`zxing-wasm`) is used automatically

### Adding more devices

You can connect more than two devices. Once connected, additional peers can be added at any time:

1. While connected, click **Add peer via QR** in the action bar
2. Follow the QR workflow above with the new device
3. The new device only needs to exchange QR codes with one existing member — Yjs automatically propagates the full document history to the newcomer, and future edits from all peers flow through the connected mesh

Note that scanning the QR code from any existing peer is sufficient to join the room — you do not need to scan every peer's code. However, if the peer you scan disconnects, you will lose connection until you scan another peer's code.

---

## The editor

The editor is a plain-text `textarea`. There is no markdown rendering in the editor itself (a preview mode is planned for a future release).

- **Simultaneous editing** — multiple peers can type at the same time. Conflicts are resolved automatically using Yjs CRDTs. Your cursor position is preserved across remote edits
- **No formatting** — content is plain text only
- **Spellcheck, autocorrect, and autocapitalise** are disabled so the editor behaves consistently across devices
- **Copy button** — the overlapping-pages icon in the bottom-right corner copies the entire editor contents to your clipboard instantly. After syncing text from another device, tap this to grab it without selecting all manually. The icon briefly shows a `✓` to confirm the copy succeeded

---

## Focus mode

Focus mode hides the header and action bar and gives the editor a full-screen ruled-paper aesthetic.

**Entering focus mode:**
- Click the `⛶` button in the bottom-right corner of the editor
- Press `Cmd+F` (Mac) or `Ctrl+F` (Windows/Linux)

**Exiting focus mode:**
- Press `Escape`
- Press `Cmd+F` / `Ctrl+F` again
- Tap the `✕` button that appears in the same corner

Focus mode is local — it does not affect what other peers see.

---

## Importing and exporting text

### Import a text file (`↑`)

Click the `↑` button in the header to load a `.txt` file from your device. The file's content replaces the current document. If other peers are connected, they will see the new content immediately.

### Export as text file (`↓`)

Click the `↓` button to download the current document as a `.txt` file. The filename is the room ID (e.g. `apple-river-moon.txt`).

---

## Sending and receiving files

You can send any file (up to 100 MB) directly to all connected peers over the same peer-to-peer WebRTC connection — no server involved.

### Sending a file

1. Make sure you are connected to at least one peer (the send button is disabled when disconnected)
2. Click the **paperclip icon** in the header (between the `↓` export button and the share icon)
3. Choose a file from the file picker — or drag and drop a file anywhere onto the editor

The file is offered to all connected peers immediately.

### Receiving a file

When a peer sends you a file, a notification strip appears near the bottom of the screen:

- **Incoming: `filename` (size)** — click **Save** to accept and begin receiving, or **Decline** to refuse
- While the transfer is in progress, a progress bar shows the percentage received
- When complete, a **Download** link appears — click it to save the file to your device. The notification dismisses automatically

### Notes

- The 100 MB limit is a soft cap to keep transfers practical on the free TURN relay. On a direct LAN connection (no TURN), larger transfers are possible but untested
- File transfers use a separate WebRTC data channel from the text editor, so large transfers do not interfere with text sync
- If you are connected to multiple peers, the file is sent to all of them simultaneously

---

## Sharing

Click the share icon (box with upward arrow) in the header for two options:

- **Share room link** — opens your device's native share sheet (if available) or copies the room URL to the clipboard. Share this link with anyone you want to invite to the room
- **Share document as file** — shares the current document content as a `.txt` file via the native share sheet (only shown if your device supports file sharing through the browser)

---

## Themes

Click **⚙** (Settings) → **Theme** to access the theme editor.

### Built-in themes

The **Light** and **Dark** tabs show all available CSS color tokens and their values for reference. Clicking either tab applies that theme immediately.

### Custom theme

The **Custom** tab lets you edit any token:

- **Color tokens** — shown with a color picker swatch. Click the swatch to open a color picker, or type a hex value directly into the text field
- **Non-color tokens** (e.g. `--line-height`) — plain text input

Changes apply live as you edit — you see the result immediately.

**Save a custom theme (`↓`):** Downloads your current custom token values as a JSON file (e.g. `notapipe-theme.json`). Keep this file to restore the theme later.

**Load a saved theme (`↑`):** Opens a file picker. Select a previously saved `notapipe-theme.json` to restore it.

Themes are saved to `localStorage` and restored automatically on your next visit.

### Theme JSON format

A theme is a plain JSON object mapping CSS custom property names to values:

```json
{
  "--color-bg": "#1a1a18",
  "--color-surface": "#242420",
  "--color-text": "#e8e3d8",
  "--color-text-muted": "#6b6660",
  "--color-accent": "#e05c4a",
  "--color-border": "#2e2e2a",
  "--color-rule": "#2e2e2a",
  "--color-status-waiting": "#6b6660",
  "--color-status-connecting": "#e0a030",
  "--color-status-connected": "#4caf50",
  "--color-status-error": "#e05c4a",
  "--line-height": "28px",
  "--color-focus-bg": "#141412",
  "--color-focus-text": "#d8d3c8",
  "--color-focus-rule": "#242420"
}
```

---

## Settings and persistence

Click **⚙** to open the Settings panel.

### Local persistence (off by default)

When **Save to localStorage** is enabled, the current document is saved to your browser's local storage under the current room ID. It is restored automatically when you return to the same room URL.

**Important:** This data never leaves your device. It is stored in your browser's local storage, not on any server.

Persistence is per-room: each room ID has its own saved content. If you navigate to a different room, that room's saved content (if any) is loaded.

---

## Installing as an app (PWA)

notapipe is a Progressive Web App and can be installed on your home screen or desktop.

### Desktop (Chrome / Edge)

Look for the install icon in the browser's address bar (a computer screen with a down arrow). Click it and follow the prompt.

### iOS (Safari)

1. Open notapipe in Safari
2. Tap the Share button (box with upward arrow) in the toolbar
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add**

The app opens in standalone mode (no browser chrome) when launched from the home screen.

### Android (Chrome)

Chrome will show an **Add to Home Screen** banner automatically, or you can tap the three-dot menu → **Add to Home Screen**.

---

## Clearing data

Click **⊗** (Clear data) for options to remove stored content:

| Option | What it clears |
|---|---|
| **Clear current doc** | Empties the shared document and removes it from `localStorage` |
| **Clear all docs** | Removes saved documents for all room IDs from `localStorage` |
| **Clear settings** | Removes the saved theme and all other settings |
| **Clear everything** | Clears all of the above |

Each option shows a confirmation dialog before proceeding.

> **Warning — Clear current doc affects connected peers.**
> Unlike the other options, **Clear current doc** is a collaborative action. Clearing the document deletes its content via Yjs, which immediately propagates to all connected peers — their editors will go blank too. If any connected peer has local persistence enabled, their saved copy for this room will also be overwritten with the empty state right away. Only use this option when all connected peers are aware and in agreement.

The remaining options (**Clear all docs**, **Clear settings**, **Clear everything**) affect only your local browser storage and do not propagate to other peers.

---

## Troubleshooting

### "Waiting for peer…" — the other device never connects

- Make sure both devices are using the **exact same URL** (same room ID)
- Check that both devices have clicked **Connect to peer** → **Use signalling server** — the connection does not start automatically
- If the signalling server is unreachable, try the QR code method instead

### QR code: camera does not open / shows an error

- Camera access requires **HTTPS**. If you are running locally, ensure the dev server is configured for HTTPS (`basicSsl` plugin is included in the dev config)
- On iOS, grant camera permission in Settings → Safari → Camera
- iOS 17.4 or later is required for in-browser QR scanning with `BarcodeDetector`. Older versions fall back to `zxing-wasm` automatically — this may be slower to load the first time

### QR code: scanning succeeds but no connection is made

- Each device must be able to reach the other over the network for WebRTC to connect
- If both devices are behind strict symmetric NAT (common on some mobile networks), WebRTC peer-to-peer may fail. notapipe v0.0.1 does not include a TURN server. Try on Wi-Fi or use the signalling server + same network

### QR code: "Gathering network info…" hangs for a long time

- ICE gathering has a 15-second timeout. If no local network candidates are found before the timeout, the QR code is generated anyway with whatever candidates are available
- This can happen if your device has no active network interface. Connect to Wi-Fi or mobile data and try again

### Text appears on both devices but they are not in sync

- This can happen if one device was offline when edits were made. Reconnect — Yjs will merge the diverged states automatically on reconnect

### Theme changes look wrong / editor inputs shifted while editing

- This is expected behaviour for the built-in Light/Dark tabs — clicking them applies the theme immediately
- The Custom tab's text input backgrounds are frozen to the theme values from when you opened Settings. Close and reopen Settings to refresh them to the current theme

### Persistence not restoring content

- Check that **Save to localStorage** is enabled in Settings
- Confirm you are on the same room URL as when the content was saved — persistence is keyed by room ID
- Private/incognito mode blocks `localStorage` in most browsers

---

*notapipe v0.0.1 · April 2026*
