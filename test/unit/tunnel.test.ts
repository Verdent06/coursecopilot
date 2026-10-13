import { describe, expect, it } from "vitest";
import { cloudflaredAssetName, parseQuickTunnelUrl } from "../../src/remote/tunnel.js";
import { isAllowedHostHeader } from "../../src/server/transport-http.js";

describe("cloudflared helpers", () => {
  it("parses a trycloudflare URL from mixed logs", () => {
    const log = `
2026-10-13T00:00:00Z INF Starting tunnel
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://random-words-hash.trycloudflare.com                                               |
+--------------------------------------------------------------------------------------------+
`;
    expect(parseQuickTunnelUrl(log)).toBe("https://random-words-hash.trycloudflare.com");
  });

  it("names release assets per platform", () => {
    expect(cloudflaredAssetName("linux", "x64")).toBe("cloudflared-linux-amd64");
    expect(cloudflaredAssetName("linux", "arm64")).toBe("cloudflared-linux-arm64");
    expect(cloudflaredAssetName("darwin", "arm64")).toBe("cloudflared-darwin-arm64.tgz");
    expect(cloudflaredAssetName("win32", "x64")).toBe("cloudflared-windows-amd64.exe");
  });
});

describe("Host header allowlist", () => {
  it("allows localhost and trycloudflare on a loopback bind", () => {
    const allowed = ["localhost", "127.0.0.1", "[::1]"];
    expect(isAllowedHostHeader("127.0.0.1:8787", allowed)).toBe(true);
    expect(isAllowedHostHeader("localhost:8787", allowed)).toBe(true);
    expect(isAllowedHostHeader("abc.trycloudflare.com", allowed)).toBe(true);
    expect(isAllowedHostHeader("evil.example", allowed)).toBe(false);
    expect(isAllowedHostHeader("anything", ["*"])).toBe(true);
  });
});
