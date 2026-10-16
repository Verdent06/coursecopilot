# CourseCopilot Sync (browser extension)

A small **read-only**, **user-initiated** Manifest V3 extension for Chrome, Edge, and Firefox.

Many schools (including the University of Michigan) **block students from creating Canvas personal access tokens**. This extension is the full-access path that does not need one.

## What it does

While you are already signed into Canvas (and, optionally, UMich [leccap](https://leccap.engin.umich.edu)) the normal way — school SSO, Okta, Duo — the extension:

1. Calls the **Canvas REST API** from your browser (`fetch` with session cookies + `X-CSRF-Token` from `_csrf_token`).
2. Calls leccap **`/player/api/product/`** and **`/player/api/webvtt/`** the same way for captions and the slide-change timeline.
3. POSTs a **JSON snapshot** (courses, modules, pages, files metadata, assignments, announcements; or lecture products) to **your** CourseCopilot host, paired with a one-time code from chat.

It does **not**:

- Create, edit, or submit anything in Canvas
- Read or upload your password
- Copy or upload cookies / SSO tokens to the server
- Run in the background or sync on a timer
- Need a Canvas “+ New Access Token”

Cookies stay in the browser. The host only receives the JSON those APIs already return to you.

## Install (unpacked)

The extension is not on the Chrome Web Store yet. Load it from this folder:

1. Clone or download [coursecopilot](https://github.com/Verdent06/coursecopilot) and open `extension/`.
2. **Chrome / Edge:** `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
3. **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `manifest.json`.

On a hosted CourseCopilot instance, `https://<host>/extension` repeats these steps.

## Pair and sync

1. In Claude / ChatGPT / Gemini, call **`connect_canvas`** (or **`connect_leccap`**).
2. Copy the **host URL** and the **one-time pairing code** (also shown on the hosted connect page).
3. Open the extension popup, paste both, click **Pair**.
4. Open a signed-in Canvas tab → **Sync Canvas**.
5. For lecture recordings, open a signed-in `leccap.engin.umich.edu` site or player tab → **Sync leccap**. Then in chat: `add_source` with `kind: "leccap"` and that URL.

Vanity Canvas hosts (not `*.instructure.com`) prompt for optional host permission the first time you Sync.

## Privacy

- Pairing binds this browser to **your** OAuth CourseCopilot library only.
- Snapshots land under that user’s data directory (`canvas-snapshot.json`, `leccap-snapshot.json`, mode 0600).
- The operator of a host you do not control can read the volume — deploy your own if that matters.

## Permissions (manifest)

| Permission | Why |
|---|---|
| `storage` | Host URL + sync token after pairing |
| `tabs` | Find your signed-in Canvas / leccap tab when you click Sync |
| `cookies` | Read Canvas `_csrf_token` so GET/API calls succeed |
| `https://*.instructure.com/*` | Same-origin Canvas REST |
| `https://leccap.engin.umich.edu/*` | product + webvtt APIs |
| optional `https://*/*` | School vanity Canvas domains, requested only when you Sync that tab |
