/**
 * Stdio MCP uses stdout for JSON-RPC. All logging goes to stderr.
 * Never log secrets (Canvas tokens, Authorization headers).
 */
function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll(/Authorization:\s*\S+/gi, "Authorization: [redacted]")
      .replaceAll(/Cookie:\s*[^\n]+/gi, "Cookie: [redacted]")
      .replaceAll(/Set-Cookie:\s*[^\n]+/gi, "Set-Cookie: [redacted]")
      .replaceAll(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replaceAll(/("token"\s*:\s*")[^"]*/gi, "$1[redacted]")
      .replaceAll(/CANVAS_TOKEN=\S+/gi, "CANVAS_TOKEN=[redacted]");
  }
  return value;
}

function write(level: string, args: unknown[]): void {
  console.error(`[coursecopilot:${level}]`, ...args.map(redact));
}

export const log = {
  info: (...args: unknown[]) => write("info", args),
  warn: (...args: unknown[]) => write("warn", args),
  error: (...args: unknown[]) => write("error", args),
};
