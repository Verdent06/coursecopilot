import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryClient } from "../../src/packs/registry.js";
import { resolvePack } from "../../src/packs/resolve.js";
import { PackError } from "../../src/packs/schema.js";

const INDEX = {
  generated_at: "2026-10-13T00:00:00Z",
  packs: [
    {
      id: "mini",
      name: "Mini Automata Fixture",
      term: "F26",
      institution: "CourseCopilot Fixtures",
      version: "1.0.0",
      source_count: 2,
      verified: true,
      url: "https://example.edu/packs/mini.json",
    },
  ],
};

const MINI = {
  schema: 1,
  id: "mini",
  name: "Mini Automata Fixture",
  version: "1.0.0",
  sources: [{ kind: "website", url: "https://example.edu/eecs3760/" }],
};

describe("pack registry + resolve", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), "cc-reg-"));
    temps.push(dir);
    return dir;
  }

  it("fetches the index, caches 24h, and resolves a pack id", async () => {
    const dir = home();
    let indexHits = 0;
    let packHits = 0;
    const fetchFn = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("index.json")) {
        indexHits += 1;
        return new Response(JSON.stringify(INDEX), { status: 200 });
      }
      if (href.endsWith("mini.json")) {
        packHits += 1;
        return new Response(JSON.stringify(MINI), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };
    let now = Date.parse("2026-10-13T00:00:00Z");
    const registry = new RegistryClient({
      url: "https://example.edu/index.json",
      homeDir: dir,
      fetchFn,
      now: () => now,
    });
    const first = await registry.getIndex();
    expect(first.packs[0]?.id).toBe("mini");
    expect(indexHits).toBe(1);
    const cached = await registry.getIndex();
    expect(cached.packs).toHaveLength(1);
    expect(indexHits).toBe(1);

    now += 25 * 60 * 60 * 1000;
    await registry.getIndex();
    expect(indexHits).toBe(2);

    const resolved = await resolvePack("mini", {
      registry,
      fetchFn,
      allowLocalPaths: true,
      allowPrivateNetwork: true,
    });
    expect(resolved.origin).toBe("registry");
    expect(resolved.manifest.id).toBe("mini");
    expect(packHits).toBe(1);

    const cacheFile = readFileSync(join(dir, "cache", "registry-index.json"), "utf8");
    expect(cacheFile).toContain("mini");
  });

  it("resolves a local path and a URL", async () => {
    const dir = home();
    const registry = new RegistryClient({
      url: "https://example.edu/index.json",
      homeDir: dir,
      fetchFn: async () => new Response("no", { status: 500 }),
    });
    const path = join(dir, "mini.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, JSON.stringify(MINI));
    const fromPath = await resolvePack(path, { registry, allowLocalPaths: true });
    expect(fromPath.origin).toBe("path");
    expect(fromPath.manifest.id).toBe("mini");

    const fromUrl = await resolvePack("https://cdn.example.edu/packs/mini.json", {
      registry,
      allowLocalPaths: true,
      allowPrivateNetwork: true,
      fetchFn: async () => new Response(JSON.stringify(MINI), { status: 200 }),
    });
    expect(fromUrl.origin).toBe("url");
    expect(fromUrl.manifest.name).toBe("Mini Automata Fixture");
  });

  it("refuses local paths when allowLocalPaths is false", async () => {
    const dir = home();
    const registry = new RegistryClient({ homeDir: dir, fetchFn: async () => new Response("[]") });
    await expect(
      resolvePack("/tmp/mini.json", { registry, allowLocalPaths: false }),
    ).rejects.toThrow(PackError);
  });

  it("uses a stale cache when the network fails", async () => {
    const dir = home();
    let ok = true;
    const fetchFn = async () => {
      if (!ok) {
        return new Response("down", { status: 503 });
      }
      return new Response(JSON.stringify(INDEX), { status: 200 });
    };
    let now = 1_000_000;
    const registry = new RegistryClient({
      url: "https://example.edu/index.json",
      homeDir: dir,
      fetchFn,
      now: () => now,
    });
    await registry.getIndex();
    ok = false;
    now += 25 * 60 * 60 * 1000;
    const stale = await registry.getIndex();
    expect(stale.packs[0]?.verified).toBe(true);
  });
});
