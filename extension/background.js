/**
 * CourseCopilot Sync — read-only, user-initiated.
 *
 * While you are signed into Canvas / leccap in this browser (SSO, Okta, Duo),
 * we call the same REST APIs the page already uses (credentials + CSRF) and
 * POST a JSON snapshot to *your* paired CourseCopilot host. Cookies are never
 * uploaded. We do not write to Canvas. Sync runs only when you click the button.
 */

const browserApi = globalThis.browser ?? globalThis.chrome;

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

async function handle(message) {
  if (message?.type === "pair") {
    return pair(message.host, message.code);
  }
  if (message?.type === "sync-canvas") {
    return syncCanvas();
  }
  if (message?.type === "sync-leccap") {
    return syncLeccap();
  }
  return { ok: false, error: "unknown message" };
}

async function pair(host, code) {
  const url = new URL("/api/pair", host);
  const res = await fetch(url.href, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.sync_token) {
    return { ok: false, error: body.hint || body.error || `Pair failed (HTTP ${res.status})` };
  }
  await browserApi.storage.local.set({
    host,
    syncToken: body.sync_token,
    paired: true,
  });
  return { ok: true };
}

async function authHeaders() {
  const { host, syncToken } = await browserApi.storage.local.get(["host", "syncToken"]);
  if (!host || !syncToken) {
    throw new Error("Not paired. Paste the host and code from connect_canvas first.");
  }
  return { host, syncToken };
}

async function syncCanvas() {
  const { host, syncToken } = await authHeaders();
  const tab = await findTab(/instructure\.com|canvas\./i);
  if (!tab?.url) {
    throw new Error("Open a signed-in Canvas tab, then click Sync Canvas.");
  }
  const origin = new URL(tab.url).origin;
  await maybeRequestOrigin(origin);
  const csrf = await csrfToken(origin);
  const get = (path) => canvasGet(origin, path, csrf);
  const self = await get("/api/v1/users/self");
  if (!self || self.error || self.errors) {
    throw new Error("Canvas session is not signed in (or CSRF failed). Sign in and try again.");
  }
  const courses = await canvasList(origin, "/api/v1/courses?enrollment_state=active&include[]=term&per_page=100", csrf);
  const modules = {};
  const pages = {};
  const files = {};
  const assignments = {};
  for (const course of courses) {
    const id = String(course.id);
    modules[id] = await canvasList(
      origin,
      `/api/v1/courses/${id}/modules?include[]=items&per_page=100`,
      csrf,
    );
    pages[id] = await canvasList(origin, `/api/v1/courses/${id}/pages?per_page=100`, csrf);
    const detailed = [];
    for (const page of pages[id].slice(0, 80)) {
      try {
        detailed.push(await get(`/api/v1/courses/${id}/pages/${encodeURIComponent(page.url)}`));
      } catch {
        detailed.push(page);
      }
    }
    pages[id] = detailed;
    try {
      files[id] = await canvasList(origin, `/api/v1/courses/${id}/files?per_page=100`, csrf);
    } catch {
      files[id] = [];
    }
    assignments[id] = await canvasList(
      origin,
      `/api/v1/courses/${id}/assignments?per_page=100`,
      csrf,
    );
  }
  const contextCodes = courses.map((c) => `course_${c.id}`);
  let announcements = [];
  if (contextCodes.length > 0) {
    const q = contextCodes.map((c) => `context_codes[]=${encodeURIComponent(c)}`).join("&");
    announcements = await canvasList(origin, `/api/v1/announcements?${q}&per_page=50`, csrf);
  }
  const snapshot = {
    version: 1,
    synced_at: new Date().toISOString(),
    base_url: origin,
    self: { id: self.id, name: self.name, time_zone: self.time_zone },
    courses,
    modules,
    pages,
    files,
    assignments,
    announcements,
  };
  const res = await fetch(new URL("/api/sync/canvas", host).href, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${syncToken}`,
    },
    body: JSON.stringify(snapshot),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.hint || body.error || `Sync failed (HTTP ${res.status})`);
  }
  return { ok: true, courses: courses.length };
}

async function syncLeccap() {
  const { host, syncToken } = await authHeaders();
  const tab = await findTab(/leccap\.engin\.umich\.edu/i);
  if (!tab?.url) {
    throw new Error("Open a signed-in leccap.engin.umich.edu tab, then click Sync leccap.");
  }
  const origin = "https://leccap.engin.umich.edu";
  await maybeRequestOrigin(origin);
  const parsed = parseLeccap(tab.url);
  const recordings = [];
  const ids = [];
  if (parsed.siteId) {
    const listed = await listLeccapSite(origin, parsed.siteId);
    ids.push(...listed);
  }
  if (parsed.recordingId && !ids.includes(parsed.recordingId)) {
    ids.push(parsed.recordingId);
  }
  if (ids.length === 0) {
    throw new Error("Open a leccap site or player URL (…/leccap/site/… or …/player/r/…).");
  }
  for (const rk of ids.slice(0, 40)) {
    const product = await fetchLeccapProduct(origin, rk, parsed.siteId);
    if (product) {
      recordings.push(product);
    }
  }
  const res = await fetch(new URL("/api/sync/leccap", host).href, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${syncToken}`,
    },
    body: JSON.stringify({ version: 1, recordings }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.hint || body.error || `Sync failed (HTTP ${res.status})`);
  }
  return { ok: true, recordings: recordings.length };
}

async function canvasGet(origin, path, csrf) {
  const headers = { Accept: "application/json+canvas-string-ids, application/json" };
  if (csrf) {
    headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(`${origin}${path}`, { credentials: "include", headers });
  if (!res.ok) {
    throw new Error(`Canvas ${path} HTTP ${res.status}`);
  }
  return res.json();
}

async function canvasList(origin, path, csrf) {
  const out = [];
  let next = path;
  for (let i = 0; i < 20 && next; i++) {
    const headers = { Accept: "application/json+canvas-string-ids, application/json" };
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
    const res = await fetch(`${origin}${next.startsWith("http") ? new URL(next).pathname + new URL(next).search : next}`, {
      credentials: "include",
      headers,
    });
    if (!res.ok) {
      throw new Error(`Canvas ${next} HTTP ${res.status}`);
    }
    const batch = await res.json();
    if (Array.isArray(batch)) {
      out.push(...batch);
    }
    next = parseLinkNext(res.headers.get("link"));
  }
  return out;
}

function parseLinkNext(header) {
  if (!header) {
    return null;
  }
  for (const part of header.split(",")) {
    if (/rel="next"/i.test(part)) {
      const m = /<([^>]+)>/.exec(part);
      return m?.[1] ?? null;
    }
  }
  return null;
}

async function csrfToken(origin) {
  try {
    const cookie = await browserApi.cookies.get({ url: origin, name: "_csrf_token" });
    if (cookie?.value) {
      return decodeURIComponent(cookie.value);
    }
  } catch {
    // optional
  }
  return "";
}

async function findTab(pattern) {
  const tabs = await browserApi.tabs.query({ url: ["https://*/*", "http://*/*"] });
  const hit = tabs.find((t) => t.url && pattern.test(t.url));
  if (hit) {
    return hit;
  }
  const [active] = await browserApi.tabs.query({ active: true, currentWindow: true });
  if (active?.url && pattern.test(active.url)) {
    return active;
  }
  return active;
}

async function maybeRequestOrigin(origin) {
  const originPattern = `${origin}/*`;
  try {
    const have = await browserApi.permissions.contains({ origins: [originPattern] });
    if (have) {
      return;
    }
    await browserApi.permissions.request({ origins: [originPattern] });
  } catch {
    // host_permissions may already cover *.instructure.com
  }
}

function parseLeccap(href) {
  try {
    const url = new URL(href);
    const site = /\/leccap\/site\/([^/?#]+)/i.exec(url.pathname) ?? /\/leccap\/viewer\/s\/([^/?#]+)/i.exec(url.pathname);
    const rec =
      /\/leccap\/player\/r\/([^/?#]+)/i.exec(url.pathname) ??
      /\/leccap\/viewer\/r\/([^/?#]+)/i.exec(url.pathname);
    return { siteId: site?.[1], recordingId: rec?.[1] };
  } catch {
    return {};
  }
}

async function listLeccapSite(origin, siteId) {
  const res = await fetch(`${origin}/leccap/viewer/api/recordings/?sk=${encodeURIComponent(siteId)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    return [];
  }
  const data = await res.json().catch(() => []);
  const ids = [];
  const walk = (value) => {
    if (!value) {
      return;
    }
    if (typeof value === "string" && /^[A-Za-z0-9_-]{6,}$/.test(value)) {
      ids.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (typeof value === "object") {
      if (typeof value.rk === "string") {
        ids.push(value.rk);
      }
      if (typeof value.recordingId === "string") {
        ids.push(value.recordingId);
      }
      for (const v of Object.values(value)) {
        if (v && typeof v === "object") {
          walk(v);
        }
      }
    }
  };
  walk(data);
  return [...new Set(ids)];
}

async function fetchLeccapProduct(origin, rk, siteId) {
  const res = await fetch(`${origin}/leccap/player/api/product/?rk=${encodeURIComponent(rk)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!json) {
    return null;
  }
  const captions = captionsFromProduct(json);
  if (captions.length === 0) {
    const vtt = await fetch(`${origin}/leccap/player/api/webvtt/?rk=${encodeURIComponent(rk)}`, {
      credentials: "include",
    });
    if (vtt.ok) {
      const text = await vtt.text();
      captions.push(...webvttToCaptions(text));
    }
  }
  const thumbnails = json.info?.thumbnails ?? json.thumbnails ?? [];
  const slides = [];
  if (Array.isArray(thumbnails)) {
    for (const row of thumbnails) {
      if (Array.isArray(row) && row.length >= 2) {
        slides.push({ slideIndex: Number(row[0]), start_s: Number(row[1]) });
      }
    }
  }
  const title = json.title || json.info?.title || `Recording ${rk}`;
  const date = json.date || json.info?.date;
  const playerUrl = `${origin}/leccap/player/r/${rk}`;
  return {
    recordingId: rk,
    siteId,
    siteName: json.sitename || json.siteName || json.info?.sitename,
    title,
    date,
    duration_s: json.duration || json.info?.duration,
    playerUrl,
    captions,
    slides,
    slideImageUrls: {},
    auxSources: [],
    hashMaterial: JSON.stringify({ rk, title, date, captions: captions.length, slides: slides.length }),
  };
}

function captionsFromProduct(json) {
  const raw = json.captions || json.info?.captions || [];
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  for (const row of raw) {
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) {
      continue;
    }
    out.push({
      text,
      start_s: parseCaptionTime(row.intime ?? row.start),
      end_s: parseCaptionTime(row.outtime ?? row.end),
    });
  }
  return out;
}

function parseCaptionTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 20_000 ? value / 1000 : value;
  }
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    return parseCaptionTime(Number(value));
  }
  return 0;
}

function webvttToCaptions(vtt) {
  const out = [];
  const blocks = vtt.replace(/^\uFEFF/, "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l && !/^WEBVTT/i.test(l) && !/^\d+$/.test(l));
    const time = lines.find((l) => l.includes("-->"));
    if (!time) {
      continue;
    }
    const [start, end] = time.split("-->").map((s) => parseVttClock(s.trim()));
    const text = lines
      .filter((l) => !l.includes("-->"))
      .join(" ")
      .trim();
    if (text) {
      out.push({ text, start_s: start ?? 0, end_s: end ?? start ?? 0 });
    }
  }
  return out;
}

function parseVttClock(token) {
  const cleaned = token.split(/\s/)[0]?.replace(",", ".") ?? "";
  const bits = cleaned.split(":");
  if (bits.length === 3) {
    return Number(bits[0]) * 3600 + Number(bits[1]) * 60 + Number(bits[2]);
  }
  if (bits.length === 2) {
    return Number(bits[0]) * 60 + Number(bits[1]);
  }
  return 0;
}
