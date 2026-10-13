import { claudeCodeEntry, claudeMcpAddArgs } from "../command.js";
import { claudeCodeConfigPath, displayPath } from "../paths.js";
import type { SetupContext } from "../types.js";
import { formatJsonDiff, type MergeResult, mergeMcpServer } from "../write-config.js";

export type ConfigureClaudeCodeOutcome = {
  client: "claude-code";
  name: "Claude Code";
  path: string;
  result: MergeResult;
  cli?: { ran: boolean; status?: number; output?: string };
  notes: string[];
  diff?: string;
};

/**
 * Prefer `claude mcp add -s user …` (writes top-level mcpServers in ~/.claude.json).
 * Always merge the file as well so a missing/old CLI still leaves a valid entry
 * and other servers are preserved.
 */
export function configureClaudeCode(
  ctx: SetupContext,
  opts: { dryRun?: boolean } = {},
): ConfigureClaudeCodeOutcome {
  const path = claudeCodeConfigPath(ctx);
  const entry = claudeCodeEntry();
  const bin = ctx.which("claude");
  const notes: string[] = [];
  let cli: ConfigureClaudeCodeOutcome["cli"];

  const addArgs = claudeMcpAddArgs();
  if (opts.dryRun) {
    notes.push(
      bin
        ? `would run: ${bin} ${addArgs.join(" ")}`
        : `claude not on PATH; would merge ${displayPath(path, ctx)}`,
    );
  } else if (bin) {
    const ran = ctx.runCommand(bin, addArgs);
    cli = { ran: true, status: ran.status, output: `${ran.stdout}${ran.stderr}`.trim() };
    if (ran.status === 0) {
      notes.push(`ran: claude ${addArgs.join(" ")}`);
    } else {
      notes.push(
        `claude mcp add failed (${ran.status}); merging ${displayPath(path, ctx)} instead. ${cli.output}`,
      );
    }
  } else {
    notes.push(`claude not on PATH; merging ${displayPath(path, ctx)}`);
  }

  const result = mergeMcpServer({
    path,
    entry,
    dryRun: opts.dryRun,
    now: ctx.now,
  });
  notes.push(
    `user-scope file: ${displayPath(path, ctx)} (top-level mcpServers, not ~/.claude/mcp.json)`,
  );
  notes.push("Verify: claude mcp get coursecopilot");
  return {
    client: "claude-code",
    name: "Claude Code",
    path,
    result,
    cli,
    notes,
    diff: result.ok ? formatJsonDiff(result.previous, result.next) : undefined,
  };
}
