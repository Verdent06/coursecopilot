import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LectureCaptureSession } from "../../src/ingest/lecture-capture/types.js";
import { createLeccapClient, type LeccapClient } from "../../src/ingest/providers/leccap/client.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/leccap");

export const FIXTURE_SITE = "testsitexxx";
export const FIXTURE_RK = "abc123";
export const FIXTURE_RK_VTT = "def456";
export const FIXTURE_ORIGIN = "https://leccap.engin.umich.edu";

export const TEST_SESSION: LectureCaptureSession = {
  cookies: [
    {
      name: "cosign-leccap.engin",
      value: "test-session-not-real",
      domain: "leccap.engin.umich.edu",
      path: "/",
    },
  ],
};

export function fixtureText(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
}

export function fakeLeccapFetch(expired = false): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (expired) {
      return new Response("<html>Please sign in at weblogin.umich.edu</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("/viewer/api/recordings/")) {
      return json(fixtureText("site-recordings.json"));
    }
    if (url.includes("/leccap/site/")) {
      return new Response(fixtureText("site.html"), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("/player/api/product/") && url.includes("rk=def456")) {
      return json(fixtureText("product-vtt-only.json"));
    }
    if (url.includes("/player/api/product/")) {
      return json(fixtureText("product-lecture.json"));
    }
    if (url.includes("/player/api/webvtt/")) {
      return new Response(fixtureText("captions.vtt"), {
        status: 200,
        headers: { "content-type": "text/vtt" },
      });
    }
    if (url.includes(".jpg") || url.includes("/media/")) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

export function fakeLeccapClient(opts: { expired?: boolean } = {}): LeccapClient {
  return createLeccapClient({
    session: TEST_SESSION,
    fetch: fakeLeccapFetch(opts.expired),
    origin: FIXTURE_ORIGIN,
    sleep: async () => undefined,
  });
}

function json(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}
