const hostEl = document.getElementById("host");
const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");

const browserApi = globalThis.browser ?? globalThis.chrome;

function setStatus(text) {
  statusEl.textContent = text;
}

async function load() {
  const stored = await browserApi.storage.local.get(["host", "paired"]);
  if (stored.host) {
    hostEl.value = stored.host;
  }
  if (stored.paired) {
    setStatus("Paired. Open a signed-in Canvas or leccap tab, then Sync.");
  }
}

document.getElementById("pair").addEventListener("click", async () => {
  const host = hostEl.value.trim().replace(/\/+$/, "");
  const code = codeEl.value.trim();
  if (!host || !code) {
    setStatus("Paste the host URL and pairing code from chat.");
    return;
  }
  setStatus("Pairing…");
  try {
    const res = await browserApi.runtime.sendMessage({ type: "pair", host, code });
    if (!res?.ok) {
      setStatus(res?.error || "Pairing failed.");
      return;
    }
    setStatus("Paired. Open Canvas (SSO) and click Sync Canvas. For recordings, open leccap and Sync leccap.");
  } catch (err) {
    setStatus(String(err));
  }
});

document.getElementById("sync-canvas").addEventListener("click", async () => {
  setStatus("Syncing Canvas (read-only)…");
  try {
    const res = await browserApi.runtime.sendMessage({ type: "sync-canvas" });
    if (!res?.ok) {
      setStatus(res?.error || "Canvas sync failed.");
      return;
    }
    setStatus(`Canvas synced: ${res.courses} course(s). Return to chat and ask what’s due or to list courses.`);
  } catch (err) {
    setStatus(String(err));
  }
});

document.getElementById("sync-leccap").addEventListener("click", async () => {
  setStatus("Syncing leccap (captions + slides)…");
  try {
    const res = await browserApi.runtime.sendMessage({ type: "sync-leccap" });
    if (!res?.ok) {
      setStatus(res?.error || "leccap sync failed.");
      return;
    }
    setStatus(`leccap synced: ${res.recordings} recording(s). In chat, add_source kind leccap with the site URL.`);
  } catch (err) {
    setStatus(String(err));
  }
});

void load();
