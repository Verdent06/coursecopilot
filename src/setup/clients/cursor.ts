import { cursorDeeplink, cursorEntry } from "../command.js";
import { cursorConfigPath, displayPath } from "../paths.js";
import type { SetupContext } from "../types.js";
import { formatJsonDiff, type MergeResult, mergeMcpServer } from "../write-config.js";

export type ConfigureCursorOutcome = {
  client: "cursor";
  name: "Cursor";
  path: string;
  result: MergeResult;
  deeplink: string;
  notes: string[];
  diff?: string;
};

export function configureCursor(
  ctx: SetupContext,
  opts: { dryRun?: boolean } = {},
): ConfigureCursorOutcome {
  const path = cursorConfigPath(ctx);
  const entry = cursorEntry();
  const result = mergeMcpServer({
    path,
    entry,
    dryRun: opts.dryRun,
    now: ctx.now,
  });
  const deeplink = cursorDeeplink(entry);
  const notes = [
    `JSON: ${displayPath(path, ctx)} (global). Project alternative: .cursor/mcp.json`,
    `Deeplink: ${deeplink}`,
    "Docs: https://cursor.com/docs/mcp/install-links",
  ];
  return {
    client: "cursor",
    name: "Cursor",
    path,
    result,
    deeplink,
    notes,
    diff: result.ok ? formatJsonDiff(result.previous, result.next) : undefined,
  };
}
