import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeCodeConfigPath,
  claudeDesktopConfigPath,
  cursorConfigPath,
  geminiCliConfigPath,
} from "../../src/setup/paths.js";
import { createSetupContext } from "../../src/setup/types.js";

const OSES = ["darwin", "win32", "linux"] as const;

function ctxFor(
  platform: (typeof OSES)[number],
  pathMod: path.PlatformPath,
): ReturnType<typeof createSetupContext> {
  const homedir = platform === "win32" ? "C:\\Users\\ada" : "/home/ada";
  const env: NodeJS.ProcessEnv = {
    HOME: homedir,
    USERPROFILE: homedir,
    APPDATA: platform === "win32" ? "C:\\Users\\ada\\AppData\\Roaming" : undefined,
    LOCALAPPDATA: platform === "win32" ? "C:\\Users\\ada\\AppData\\Local" : undefined,
    XDG_CONFIG_HOME: platform === "linux" ? "/home/ada/.config" : undefined,
  };
  return createSetupContext({
    platform,
    homedir,
    env,
    path: pathMod,
    exists: () => false,
    which: () => undefined,
  });
}

describe("client config paths per OS", () => {
  it("resolves Claude Desktop on macOS, Windows, and Linux", () => {
    expect(claudeDesktopConfigPath(ctxFor("darwin", path.posix))).toBe(
      "/home/ada/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(claudeDesktopConfigPath(ctxFor("win32", path.win32))).toBe(
      "C:\\Users\\ada\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
    );
    expect(claudeDesktopConfigPath(ctxFor("linux", path.posix))).toBe(
      "/home/ada/.config/Claude/claude_desktop_config.json",
    );
  });

  it("resolves Claude Code, Cursor, and Gemini CLI on every OS", () => {
    const darwin = ctxFor("darwin", path.posix);
    expect(claudeCodeConfigPath(darwin)).toBe("/home/ada/.claude.json");
    expect(cursorConfigPath(darwin)).toBe("/home/ada/.cursor/mcp.json");
    expect(geminiCliConfigPath(darwin)).toBe("/home/ada/.gemini/settings.json");

    const win = ctxFor("win32", path.win32);
    expect(claudeCodeConfigPath(win)).toBe("C:\\Users\\ada\\.claude.json");
    expect(cursorConfigPath(win)).toBe("C:\\Users\\ada\\.cursor\\mcp.json");
    expect(geminiCliConfigPath(win)).toBe("C:\\Users\\ada\\.gemini\\settings.json");

    const linux = ctxFor("linux", path.posix);
    expect(claudeCodeConfigPath(linux)).toBe("/home/ada/.claude.json");
    expect(cursorConfigPath(linux)).toBe("/home/ada/.cursor/mcp.json");
    expect(geminiCliConfigPath(linux)).toBe("/home/ada/.gemini/settings.json");
  });

  it("honors CLAUDE_CONFIG_DIR for Claude Code", () => {
    const ctx = createSetupContext({
      platform: "linux",
      homedir: "/home/ada",
      env: { CLAUDE_CONFIG_DIR: "/opt/claude" },
      path: path.posix,
    });
    expect(claudeCodeConfigPath(ctx)).toBe("/opt/claude/.claude.json");
  });
});
