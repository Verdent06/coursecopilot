import { claudeDesktopEntry } from "../command.js";
import { mcpbCompatibleEntry, mcpbInstallInstructions } from "../mcpb.js";
import { claudeDesktopConfigPath, displayPath } from "../paths.js";
import type { SetupContext } from "../types.js";
import { formatJsonDiff, type MergeResult, mergeMcpServer } from "../write-config.js";

export type ConfigureOutcome = {
  client: "claude-desktop";
  name: "Claude Desktop";
  path: string;
  result: MergeResult;
  notes: string[];
  diff?: string;
};

export function configureClaudeDesktop(
  ctx: SetupContext,
  opts: { dryRun?: boolean } = {},
): ConfigureOutcome {
  const path = claudeDesktopConfigPath(ctx);
  const entry = claudeDesktopEntry();
  const result = mergeMcpServer({
    path,
    entry,
    dryRun: opts.dryRun,
    now: ctx.now,
  });
  const notes = [
    `JSON: ${displayPath(path, ctx)} → mcpServers.coursecopilot = ${JSON.stringify(entry)}`,
    `MCPB-compatible mcp_config: ${JSON.stringify(mcpbCompatibleEntry())}`,
    mcpbInstallInstructions(),
  ];
  return {
    client: "claude-desktop",
    name: "Claude Desktop",
    path,
    result,
    notes,
    diff: result.ok ? formatJsonDiff(result.previous, result.next) : undefined,
  };
}
