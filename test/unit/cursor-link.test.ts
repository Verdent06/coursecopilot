import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURSOR_INSTALL_BADGE_SRC,
  claudeCodeOneLiner,
  cursorConfigBase64,
  cursorDeeplink,
  cursorHttpsInstallUrl,
  cursorInstallBadgeMarkdown,
  decodeCursorDeeplink,
  geminiCliOneLiner,
  PUBLISHED_STDIO_SPEC,
} from "../../src/setup/command.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Cursor install link", () => {
  it("encodes npx -y coursecopilot@latest and round-trips", () => {
    const url = cursorDeeplink(PUBLISHED_STDIO_SPEC);
    expect(url.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);
    const decoded = decodeCursorDeeplink(url);
    expect(decoded.name).toBe("coursecopilot");
    expect(decoded.config).toEqual(PUBLISHED_STDIO_SPEC);
    expect(cursorConfigBase64()).toBe(
      Buffer.from(JSON.stringify(PUBLISHED_STDIO_SPEC), "utf8").toString("base64"),
    );
  });

  it("HTTPS badge href decodes to the same config", () => {
    const httpsUrl = cursorHttpsInstallUrl();
    expect(httpsUrl.startsWith("https://cursor.com/en/install-mcp?")).toBe(true);
    const decoded = decodeCursorDeeplink(httpsUrl);
    expect(decoded).toEqual(decodeCursorDeeplink(cursorDeeplink(PUBLISHED_STDIO_SPEC)));
    const badge = cursorInstallBadgeMarkdown();
    expect(badge).toContain(CURSOR_INSTALL_BADGE_SRC);
    expect(badge).toContain(httpsUrl);
  });

  it("README ships the badge and client one-liners", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain(CURSOR_INSTALL_BADGE_SRC);
    expect(readme).toContain("install-mcp?name=coursecopilot");
    expect(readme).toContain(claudeCodeOneLiner());
    expect(readme).toContain(geminiCliOneLiner());
  });
});
