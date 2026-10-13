import { CLIENT_NAMES, type LocalClientId, type SetupContext } from "./types.js";

export function claudeDesktopConfigPath(ctx: SetupContext): string {
  const { path: p, homedir, env, platform } = ctx;
  if (platform === "darwin") {
    return p.join(
      homedir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (platform === "win32") {
    const appdata = env.APPDATA?.trim() || p.join(homedir, "AppData", "Roaming");
    return p.join(appdata, "Claude", "claude_desktop_config.json");
  }
  const xdg = env.XDG_CONFIG_HOME?.trim() || p.join(homedir, ".config");
  return p.join(xdg, "Claude", "claude_desktop_config.json");
}

/** Linux also sees a lowercase `claude` dir from some packages. Detect-only. */
export function claudeDesktopConfigPathAliases(ctx: SetupContext): string[] {
  const primary = claudeDesktopConfigPath(ctx);
  if (ctx.platform !== "linux") {
    return [primary];
  }
  const xdg = ctx.env.XDG_CONFIG_HOME?.trim() || ctx.path.join(ctx.homedir, ".config");
  const alt = ctx.path.join(xdg, "claude", "claude_desktop_config.json");
  return primary === alt ? [primary] : [primary, alt];
}

export function claudeDesktopAppPaths(ctx: SetupContext): string[] {
  const { path: p, homedir, env, platform } = ctx;
  if (platform === "darwin") {
    return ["/Applications/Claude.app", p.join(homedir, "Applications", "Claude.app")];
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim() || p.join(homedir, "AppData", "Local");
    const pf = env.ProgramFiles?.trim() || p.join("C:", "Program Files");
    return [
      p.join(local, "AnthropicClaude"),
      p.join(local, "Programs", "Claude"),
      p.join(pf, "Claude"),
    ];
  }
  return [];
}

export function claudeCodeConfigPath(ctx: SetupContext): string {
  const dir = ctx.env.CLAUDE_CONFIG_DIR?.trim();
  if (dir) {
    return ctx.path.join(dir, ".claude.json");
  }
  return ctx.path.join(ctx.homedir, ".claude.json");
}

export function cursorConfigPath(ctx: SetupContext): string {
  return ctx.path.join(ctx.homedir, ".cursor", "mcp.json");
}

export function cursorAppPaths(ctx: SetupContext): string[] {
  const { path: p, homedir, env, platform } = ctx;
  if (platform === "darwin") {
    return ["/Applications/Cursor.app", p.join(homedir, "Applications", "Cursor.app")];
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim() || p.join(homedir, "AppData", "Local");
    return [p.join(local, "Programs", "cursor"), p.join(local, "cursor")];
  }
  return [];
}

export function geminiCliConfigPath(ctx: SetupContext): string {
  return ctx.path.join(ctx.homedir, ".gemini", "settings.json");
}

export function clientConfigPath(id: LocalClientId, ctx: SetupContext): string {
  switch (id) {
    case "claude-desktop":
      return claudeDesktopConfigPath(ctx);
    case "claude-code":
      return claudeCodeConfigPath(ctx);
    case "cursor":
      return cursorConfigPath(ctx);
    case "gemini":
      return geminiCliConfigPath(ctx);
  }
}

export function displayPath(abs: string, ctx: SetupContext): string {
  if (abs.startsWith(ctx.homedir)) {
    const rest = abs.slice(ctx.homedir.length).replace(/^[\\/]/, "");
    return ctx.platform === "win32" ? `%USERPROFILE%\\${rest}` : `~/${rest.replace(/\\/g, "/")}`;
  }
  return abs;
}

export function clientLabel(id: LocalClientId): string {
  return CLIENT_NAMES[id];
}
