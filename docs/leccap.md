# UMich CAEN Lecture Capture (leccap)

Index lecture recordings from [leccap.engin.umich.edu](https://leccap.engin.umich.edu) into CourseCopilot. Captions become timestamped chunks; slide-change thumbnails become a slide timeline; optional OCR can name the matching course PDF in citations.

This is a **generic lecture-capture adapter**. Panopto and Kaltura can implement the same provider interface later. The source kind for CAEN is `leccap`.

You never download the video. CourseCopilot never stores your UMich password.

## Hosted / in-chat (no terminal)

Call `connect_leccap` in Claude / ChatGPT / Gemini. It returns a link to `/connect/leccap` on the same host.

**Limit:** UMich Weblogin + Duo cannot run on the server. The practical handoff is a **cookie export** from a browser where you already signed in:

1. Open [leccap.engin.umich.edu](https://leccap.engin.umich.edu) and complete Duo.
2. Export cookies with an extension (Cookie-Editor, etc.) as Playwright `storageState` JSON or Netscape `cookies.txt`. Include HttpOnly cookies for `umich.edu` / Shibboleth — a bookmarklet cannot see those.
3. Paste the export on the hosted page.
4. Back in chat, `add_source` with `kind: "leccap"` and the site or player URL.

The bookmarklet on that page is a fallback for non-HttpOnly cookies and often fails after Duo. Self-host Advanced (headed Playwright) is below.

## One-minute setup (local laptop)

1. **Sign in once** (a real browser window; Okta + Duo):

   ```bash
   npx coursecopilot login leccap
   ```

   Complete Weblogin / Duo in the window that opens. When it finishes, the session is saved under `~/.coursecopilot/` (mode 0600). Playwright is installed on first use into that folder so the base `npx` package stays small.

2. **Add the course recordings.** In Canvas, open **Lecture Recordings** (the CAEN LTI). Copy the site URL (`https://leccap.engin.umich.edu/leccap/site/...`) or a single player URL (`.../leccap/player/r/...`). Then, in your AI assistant:

   - `add_source` with `kind: "leccap"` and that URL.

   A site URL lists every recording. Re-running `add_source` on the same URL only indexes **new** recordings.

3. **Ask with citations.** Search results look like:

   `[EECS 376 – Lecture 10/12 @ 23:14, slide 12](https://leccap.engin.umich.edu/leccap/player/r/…#t=1394)`

## Cookie import (no browser)

If you prefer not to install Playwright, export cookies from a signed-in session (Playwright `storageState` JSON or Netscape `cookies.txt`) and import them:

```bash
npx coursecopilot login leccap --cookies cookies.json
```

## Session expired

If ingest fails with a 401/403 after SSO, sign in again:

```bash
npx coursecopilot login leccap
```

## What is indexed

| Signal | Source |
|---|---|
| Transcript | Product `captions[]` `{text,intime,outtime}`, else `/player/api/webvtt/` |
| Slide timeline | `info.thumbnails` `[slideIndex, seconds]` |
| Slide images | `{mediaPrefix}{sitekey}/{slides_folder\|thumbnails_folder}/{n}.jpg` |
| OCR (optional) | `tesseract.js` if installed (`npm install tesseract.js`); otherwise slide **index** is still stored |
| Whiteboard | `aux_sources` metadata only by default (`options.whiteboard: true` to request images) |
| Lecture id | Product `title` / `date` (e.g. `Lecture 10/12`) or `options.lecture_no` |

Deep links use `#t=<seconds>` (HTML Media Fragments). The live player JS is behind login, so whether CAEN honors the hash is **[UNVERIFIED]**; the URL still opens the right recording.

## Privacy

- Passwords are never stored.
- Session cookies live in `~/.coursecopilot/leccap-session.json` (0600) and the Playwright profile `~/.coursecopilot/browser-profiles/leccap`.
- Recordings stay on your machine’s SQLite index. Packs never include leccap cookies or caption text.
