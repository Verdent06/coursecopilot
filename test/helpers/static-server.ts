import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, resolve } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ics": "text/calendar",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

export type StaticServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

/** Serve a directory on 127.0.0.1 with ETag support (for re-sync 304 tests). */
export async function serveDirectory(dir: string): Promise<StaticServer> {
  const root = resolve(dir);
  const server: Server = createServer((req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith("/")) {
        rel += "index.html";
      }
      const full = resolve(root, `.${rel}`);
      if (!full.startsWith(root) || !existsSync(full) || statSync(full).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const buf = readFileSync(full);
      const etag = `"${createHash("sha256").update(buf).digest("hex")}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304);
        res.end();
        return;
      }
      const type = MIME[extname(full).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, ETag: etag, "Cache-Control": "no-cache" });
      res.end(buf);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
    server.on("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("static server did not bind a port");
  }
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}
