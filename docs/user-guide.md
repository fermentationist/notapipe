# notapipe — User Guide

**April 2026**

> Screenshots are intentionally omitted from this guide — the UI is still evolving and static images go stale quickly. All UI elements are described by their visible label or icon.

---

## Table of contents

1. [What is notapipe?](#what-is-notapipe)
2. [The interface at a glance](#the-interface-at-a-glance)
3. [Rooms and room IDs](#rooms-and-room-ids)
4. [Connecting to another device](#connecting-to-another-device)
   - [Via signalling server](#via-signalling-server)
   - [Via QR code (air-gapped)](#via-qr-code-air-gapped)
   - [Adding more devices](#adding-more-devices)
5. [The command palette](#the-command-palette)
6. [The editor](#the-editor)
7. [Chat](#chat)
8. [Voice calls](#voice-calls)
9. [Markdown preview](#markdown-preview)
10. [Wide layout](#wide-layout)
11. [Focus mode](#focus-mode)
12. [Code editor mode](#code-editor-mode)
13. [Importing and exporting text](#importing-and-exporting-text)
14. [Sending and receiving files](#sending-and-receiving-files)
15. [Sharing](#sharing)
16. [Themes](#themes)
17. [Settings and persistence](#settings-and-persistence)
18. [Installing as an app (PWA)](#installing-as-an-app-pwa)
19. [Clearing data](#clearing-data)
20. [Troubleshooting](#troubleshooting)

---

## What is notapipe?

notapipe is a browser-based tool for sharing text between devices in real time. It uses peer-to-peer WebRTC to sync a shared document directly between browsers — no server ever sees your text.

**The primary use case** is moving text from one machine to another without a cable, cloud account, or chat app. Open the same room URL on both devices, wait for the connection indicator to turn green, and whatever you type on one device instantly appears on the other. Then copy it from the editor with the copy button (bottom-right corner) and paste it wherever you need it.

It also works anywhere you want a conversation, file transfer, or shared document that doesn't leave a permanent record in a cloud service — sending a password without routing it through email, collaborating on a note with someone nearby, or having a text or voice exchange that disappears when the tab closes.

**Key properties:**

- Nothing you type is stored on any server
- The signalling server only brokers the initial connection handshake; it never sees document content or the room token
- In QR mode, no server is involved at all — two devices connect directly
- The `#token` in the URL prevents two strangers who happen to generate the same 3-word room ID from accidentally connecting to each other
- Content lives only in the browser tabs that are currently open (unless you turn on local persistence)

---

## The interface at a glance

The interface has four main regions:

**Header** (top bar)

- App name (`notapipe`) on the left
- Connection status indicator and **peer count badge** in the centre — the badge shows how many peers are currently connected and flashes when someone joins
- On the right: a **hard-drive icon** (only visible when document persistence is on — click it to open storage settings), an **ⓘ** info button, a **sun/moon** theme toggle, a **⚙** settings button, and a **⌘K** command palette button

**Room bar** (below the header)

- The current **room name** (e.g. `apple-river-moon`) — click it to open a menu with the option to navigate to a new random room
- A **copy URL** button (overlapping-pages icon) to copy the full room URL to the clipboard
- A **QR code** button to display the current room URL as a scannable QR code
- Your display **handle** (click to rename yourself — the new name is shown to all connected peers)
- A **peer list** showing the handles of all connected peers
- A **chat button** (speech-bubble icon) — opens the chat panel; shows a numbered badge for unread messages
- A **voice button** (phone icon) — starts or ends a voice call with all connected peers
- A `···` **actions menu** — tap this on mobile (or whenever you prefer a menu over direct buttons) to access all document actions and the command palette

**Editor** (main area)

- A plain-text textarea that fills the available space
- All connected peers see the same content and can edit simultaneously
- A **copy button** in the bottom-right copies all editor text to the clipboard in one tap — useful for transferring the synced content to another app

**Action bar** (bottom)

- When not connected: a **Connect to peer** button that opens a dropdown with connection method options
- When connected: an **Add peer via QR** button and a **Disconnect** button

---

## Rooms and room IDs

Every notapipe session is identified by a **3-word room ID** — a phrase like `marble-cloud-seven` — that appears in the URL path, plus a short random **room token** in the URL fragment (the `#` part):

```
https://notapipe.app/marble-cloud-seven#k7mX9qPw
```

- When you open notapipe without a path, a new random room ID and token are generated for you
- **Share the full URL** — both the path and the `#token` are required to connect. Two devices that share only the same room ID but have different tokens will not be matched
- The token is never sent to the signalling server (browsers strip `#` fragments from HTTP requests); it is only exchanged between peers as part of the WebRTC handshake
- In QR mode the token is embedded in the QR code, so the scanning device adopts it automatically

### Switching rooms

Click the **room name** in the room bar to open the room menu. Select **New random room** to generate a fresh room ID and token. This disconnects any active session and navigates to the new room.

---

## Connecting to another device

notapipe does not connect automatically when you open a URL. You must explicitly choose a connection method. This ensures no network contact happens without your knowledge.

### Via signalling server

Best for: devices on the same Wi-Fi network, or over the internet when both peers can reach the signalling server.

**Workflow:**

1. Both devices navigate to the same room URL (share the full link)
2. On one device, click **Connect to peer ▾** → **Use signalling server**
3. The status indicator changes to `waiting for peer…`
4. On the second device, repeat step 2
5. The status indicator on both devices changes to `connected`
6. Start typing on either device — text syncs instantly

The signalling server only relays WebRTC handshake metadata (SDP offer/answer and ICE candidates). It never receives document content.

If the signalling connection drops unexpectedly, notapipe will automatically reconnect and resume listening.

### Via QR code (air-gapped)

Best for: maximum privacy (no server contact at all), or when devices are not on the same network. This is the recommended method for sensitive use.

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

---

## The command palette

Press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) — or tap the **⌘K** button in the header, or choose **⌘ Command palette** from the `···` actions menu — to open the command palette.

The palette gives keyboard access to every feature in the app. Start typing to filter commands; use **↑↓** to navigate, **↵** to run, and **Esc** (or click the `esc` badge) to close.

Commands are organised into groups:

| Group        | Commands                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connect**  | Connect via signalling server, Connect via QR code, New random room, Disconnect                                                                    |
| **Document** | Copy all text, Send file, Show/hide markdown preview, Enter/exit code mode, Import text file, Export as text file, Share room link, Clear document |
| **Chat**     | Open/close chat                                                                                                                                    |
| **Voice**    | Start/join/end voice call                                                                                                                          |
| **View**     | Enter/exit focus mode, Enable/exit wide layout, Switch to light/dark mode, Customize theme                                                         |
| **App**      | Open settings, User guide, About notapipe                                                                                                          |

---

## The editor

The editor is a plain-text `textarea`.

- **Simultaneous editing** — multiple peers can type at the same time. Conflicts are resolved automatically using Yjs CRDTs. Your cursor position is preserved across remote edits
- **No formatting** — content is plain text only
- **Spellcheck, autocorrect, and autocapitalise** are disabled so the editor behaves consistently across devices
- **Copy button** — the overlapping-pages icon in the bottom-right corner copies the entire editor contents to your clipboard instantly. After syncing text from another device, tap this to grab it without selecting all manually. The icon briefly shows a `✓` to confirm the copy succeeded

---

## Chat

The chat panel provides a real-time text chat channel between all connected peers. Chat messages are separate from the shared document — they do not affect the editor contents.

**Opening chat:**

- Click the speech-bubble icon in the room bar (or use **⌘K → Open chat**)
- An unread-message badge appears on the icon when new messages arrive while the panel is closed

**Sending a message:**

- Type in the input field at the bottom of the chat panel and press **Enter** (or click the send button)

**Identity:** Your messages are labelled with your display handle. To change your handle, click it in the room bar before or during the conversation.

**Chat and other panels:** Chat and markdown preview cannot be open at the same time. Opening one will close the other.

**Chat in focus mode / code mode:** The chat panel is not available while focus mode or code editor mode is active.

### Chat persistence (off by default)

Chat messages are ephemeral by default — they are not saved and will be lost when you close or reload the tab. To keep a chat log across reloads, enable **Save chat log** in Settings (⚙). When enabled, messages are saved to `localStorage` under the current room ID and restored on your next visit.

**Note:** Chat messages are only saved on your own device — they are not pushed to other peers when you reconnect.

---

## Voice calls

Voice calls let you speak with all connected peers over the same peer-to-peer WebRTC connection used for text sync — no server handles your audio.

**Starting a voice call:**

1. Make sure you are connected to at least one peer (the phone icon is disabled when disconnected)
2. Click the phone icon in the room bar — the browser will prompt for microphone permission
3. Once permission is granted, the icon turns **green** to indicate an active call
4. Connected peers receive a notification: _"[handle] started a voice call"_
5. Each peer clicks their own phone icon to join the call

**Ending a voice call:**

- Click the green phone icon again — your microphone is released and the audio channel is torn down

**Incoming call:**

When a peer starts a voice call while you are connected, the phone icon begins **pulsing**. Click it to join.

### Notes

- Each peer must individually click the phone icon to join. Voice does not auto-connect.
- If a peer hangs up and calls again, you will see the pulsing notification again — you do not automatically rejoin.
- Reloading the page ends your participation in any active call. Other peers remain connected to each other; you will need to click the phone icon again after reconnecting.
- Voice uses your browser's `getUserMedia` API. **HTTPS is required** — on iOS, microphone access is not available over plain HTTP.

---

## Markdown preview

**⌘K → Show markdown preview**, or `···` → **M↓ Markdown preview**, toggles a rendered view of the editor contents.

- **Wide screens** — the editor and preview are shown side by side. The left pane remains editable; the right pane renders the markdown in real time
- **Narrow screens (mobile)** — the preview replaces the editor. An `← Edit` button appears to switch back

Markdown preview is a **local-only view** — it does not affect what other peers see.

**Focus mode** is edit-only: activating focus mode while the preview is open will hide the preview.

---

## Wide layout

**⌘K → Enable wide layout**, or `···` → **⬌ Wide layout**, expands the app to nearly the full browser width (the default is a narrower centred column). The preference is saved across sessions. This option is only shown on desktop.

---

## Focus mode

Focus mode hides the header and action bar and gives the editor a full-screen ruled-paper aesthetic.

**Entering focus mode:**

- Press `Cmd+F` (Mac) or `Ctrl+F` (Windows/Linux)
- Click the `⛶` button in the bottom-right corner of the editor
- **⌘K → Enter focus mode**

**Exiting focus mode:**

- Press `Escape` or `Cmd+F` / `Ctrl+F` again
- Tap the `✕` button that appears in the same corner

Focus mode is local — it does not affect what other peers see.

---

## Code editor mode

Code editor mode adds syntax highlighting powered by [Prism](https://prismjs.com), bracket matching, and a set of line-editing keyboard shortcuts. Text remains fully synced with peers in real time.

**Entering code editor mode:**

- Click the `</>` button in the bottom-right corner
- **⌘K → Enter code mode**

**Exiting code editor mode:**

- Press `Escape`
- Tap the `✕` button that replaces `</>` while active

**Selecting a language:**

A language dropdown appears in the bottom-right corner while code mode is active. The selected language controls syntax highlighting only — the underlying document is plain text and peers do not need to be in code mode to receive edits.

Supported languages: JavaScript, TypeScript, JSX, TSX, HTML, CSS, JSON, Python, Rust, Bash, SQL, YAML, PHP, Ruby, and plain Text.

**Keyboard shortcuts (code mode):**

| Shortcut                      | Action                          |
| ----------------------------- | ------------------------------- |
| `Alt+↑` / `Alt+↓`             | Move line up / down             |
| `Shift+Alt+↑` / `Shift+Alt+↓` | Copy line up / down             |
| `Cmd+]` / `Cmd+[`             | Indent / outdent                |
| `Cmd+/`                       | Toggle line comment             |
| `Shift+Cmd+K`                 | Delete line                     |
| `Cmd+Enter`                   | Insert blank line below         |
| `Tab` / `Shift+Tab`           | Indent / outdent selected lines |

Auto-closing of brackets, quotes, and backticks is also enabled.

Code editor mode is local — it does not affect what other peers see.

---

## Importing and exporting text

### Import a text file (`↑`)

`···` → **↑ Load text file** (or **⌘K → Import text file**) loads a `.txt` file from your device. If the editor is not empty, a confirmation dialog will appear first — the file's content replaces the entire document, and if peers are connected the change syncs to them immediately.

### Export as text file (`↓`)

`···` → **↓ Save as text file** (or **⌘K → Export as text file**) downloads the current document as a `.txt` file. The filename is the room ID (e.g. `apple-river-moon.txt`).

---

## Sending and receiving files

You can send any file (up to 100 MB) directly to all connected peers over the same peer-to-peer WebRTC connection — no server involved.

### Sending a file

1. Make sure you are connected to at least one peer
2. Click `···` → **⌂ Send file**, or use **⌘K → Send file**
3. Choose a file from the file picker

The file is offered to each connected peer individually.

### Receiving a file

When a peer sends you a file, a notification strip appears near the bottom of the screen:

- **Incoming: `filename` (size)** — click **Save** to accept and begin receiving, or **Decline** to refuse
- While the transfer is in progress, a progress bar shows the percentage received
- When complete, a **Download** link appears — click it to save the file to your device

### Notes

- File transfers use a separate WebRTC data channel from the text editor, so large transfers do not interfere with text sync
- If you are connected to multiple peers, the file is sent to each of them separately and each peer's transfer strip shows their handle

---

## Sharing

From the `···` actions menu:

- **Share room link** — opens your device's native share sheet (if available) or copies the room URL to the clipboard
- **Share document as file** — shares the current document content as a `.txt` file via the native share sheet (only shown if your device supports file sharing through the browser)

You can also click the **QR code** button in the room bar to display the current room URL as a QR code — useful for sharing across devices without copy-pasting.

---

## Themes

### Switching between light and dark

- Click the **sun/moon icon** in the header
- Or use **⌘K → Switch to light/dark mode**

### Custom themes

Use **⌘K → Customize theme** (or **⚙ → Theme**) to open the theme editor.

The **Light** and **Dark** tabs show the built-in themes and apply them immediately when clicked.

The **Custom** tab lets you edit any token:

- **Color tokens** — shown with a color picker swatch. Click the swatch to open a color picker, or type a hex value directly
- **Non-color tokens** (e.g. `--line-height`) — plain text input

Changes apply live as you edit.

**Save (`↓`):** Downloads your current custom token values as a JSON file (e.g. `notapipe-theme.json`).

**Load (`↑`):** Opens a file picker to restore a previously saved theme file.

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

Click **⚙** to open the Settings panel. It has two tabs: **Storage** and **Connection**.

### Storage tab

#### Document persistence (off by default)

When **Save document** is enabled, the current document is saved to your browser's IndexedDB. Content **survives tab close and browser restart** — it is no longer ephemeral. It is restored automatically when you return to the same room URL.

A **hard-drive icon** appears in the header while this is active. Click it to return to storage settings. To return to ephemeral mode, disable **Save document**.

**Important:** This data never leaves your device. It is stored locally in your browser, never on any server.

Persistence is per-room — each room ID has its own saved content.

#### Chat log persistence (off by default)

When **Save chat log** is enabled, chat messages for each room are saved to `localStorage` and restored when you return to that room URL. Like document persistence, chat logs are stored locally only.

### Connection tab

Override the default signalling server URL or configure a custom TURN server. Changes take effect on the next connection attempt.

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

From the `···` actions menu:

| Option                     | What it clears                                                |
| -------------------------- | ------------------------------------------------------------- |
| **Clear current document** | Empties the shared document and removes it from local storage |
| **Clear all documents**    | Removes saved documents for all room IDs                      |
| **Clear settings**         | Removes the saved theme and all other settings                |
| **Clear everything**       | Clears all of the above                                       |

Each option shows a confirmation dialog before proceeding.

> **Warning — Clear current document affects connected peers.**
> Unlike the other options, **Clear current document** is a collaborative action. Clearing the document deletes its content via Yjs, which immediately propagates to all connected peers — their editors will go blank too. If any connected peer has local persistence enabled, their saved copy for this room will also be overwritten with the empty state. Only use this option when all connected peers are aware and in agreement.

The remaining options (**Clear all documents**, **Clear settings**, **Clear everything**) affect only your local browser storage and do not propagate to other peers.

---

## Troubleshooting

### "Waiting for peer…" — the other device never connects

- Make sure both devices are using the **exact same URL** (same room ID and `#token`)
- Check that both devices have clicked **Connect to peer** → **Use signalling server**
- If the signalling server is unreachable, try the QR code method instead

### Connection fails after a few seconds

notapipe includes a default TURN relay server (freestun.net) for traversing NATs, but some corporate networks and strict firewalls may still block WebRTC. If connection fails and you see a notification suggesting it, try:

1. **QR mode** — avoids the signalling server entirely and can sometimes find a path that signalling mode cannot
2. **A custom TURN server** — configure one in Settings → Connection. Free TURN servers are available from providers such as [Metered](https://www.metered.ca/tools/openrelay/) and [Open Relay](https://openrelay.metered.ca/)

### QR code: camera does not open / shows an error

- Camera access requires **HTTPS**. If you are running locally, ensure the dev server is configured for HTTPS
- On iOS, grant camera permission in Settings → Safari → Camera
- iOS 17.4 or later is required for in-browser QR scanning with `BarcodeDetector`. Older versions fall back to `zxing-wasm` automatically — this may be slower to load the first time

### QR code: scanning succeeds but no connection is made

- Each device must be able to reach the other over the network for WebRTC to connect
- Try on Wi-Fi rather than mobile data, or use the signalling server method

### QR code: "Gathering network info…" hangs for a long time

- ICE gathering has a 15-second timeout. If no local network candidates are found before the timeout, the QR code is generated anyway with whatever candidates are available
- This can happen if your device has no active network interface. Connect to Wi-Fi or mobile data and try again

### Text appears on both devices but they are not in sync

- This can happen if one device was offline when edits were made. Reconnect — Yjs will merge the diverged states automatically

### Voice call: phone icon is disabled / greyed out

- The voice button is disabled when you have no connected peers. Connect first.

### Voice call: microphone permission denied

- Check your browser's site permissions (address bar → lock icon → microphone) and grant access
- On iOS, go to Settings → Safari → Microphone and make sure notapipe is allowed
- HTTPS is required for `getUserMedia`

### Voice call: other peer does not hear me (or I don't hear them)

- Both peers must click the phone icon to join the call
- Check that your device's audio output is not muted
- On networks with symmetric NAT, WebRTC audio may fail. Try on a different network or configure a TURN server in Settings → Connection

### Chat messages not persisting across reloads

- Enable **Save chat log** in Settings → Storage
- Private/incognito mode blocks `localStorage` in most browsers

### Persistence not restoring content

- Check that **Save document** is enabled in Settings → Storage
- Confirm you are on the same room URL as when the content was saved — persistence is keyed by room ID
- Private/incognito mode blocks local storage in most browsers

---

_notapipe · April 2026_
