import { geminiCliEntry, geminiMcpAddArgs } from "../command.js";
import { displayPath, geminiCliConfigPath } from "../paths.js";
import type { SetupContext } from "../types.js";
import { formatJsonDiff, type MergeResult, mergeMcpServer } from "../write-config.js";

export type ConfigureGeminiOutcome = {
  client: "gemini";
  name: "Gemini CLI";
  path: string;
  result: MergeResult;
  cli?: { ran: boolean; status?: number; output?: string };
  notes: string[];
  diff?: string;
};

/**
 * Prefer `gemini mcp add -s user …` (writes ~/.gemini/settings.json).
 * Merge the same file so other settings (theme, etc.) and other mcpServers stay.
 */
export function configureGeminiCli(
  ctx: SetupContext,
  opts: { dryRun?: boolean } = {},
): ConfigureGeminiOutcome {
  const path = geminiCliConfigPath(ctx);
  const entry = geminiCliEntry();
  const bin = ctx.which("gemini");
  const notes: string[] = [];
  let cli: ConfigureGeminiOutcome["cli"];
  const addArgs = geminiMcpAddArgs();

  if (opts.dryRun) {
    notes.push(
      bin
        ? `would run: ${bin} ${addArgs.join(" ")}`
        : `gemini not on PATH; would merge ${displayPath(path, ctx)}`,
    );
  } else if (bin) {
    const ran = ctx.runCommand(bin, addArgs);
    cli = { ran: true, status: ran.status, output: `${ran.stdout}${ran.stderr}`.trim() };
    if (ran.status === 0) {
      notes.push(`ran: gemini ${addArgs.join(" ")}`);
    } else {
      notes.push(
        `gemini mcp add failed (${ran.status}); merging ${displayPath(path, ctx)} instead. ${cli.output}`,
      );
    }
  } else {
    notes.push(`gemini not on PATH; merging ${displayPath(path, ctx)}`);
  }

  const result = mergeMcpServer({
    path,
    entry,
    dryRun: opts.dryRun,
    now: ctx.now,
  });
  notes.push(`settings: ${displayPath(path, ctx)} (user scope). Then run /mcp in Gemini CLI.`);
  notes.push("Docs: https://geminicli.com/docs/tools/mcp-server/");
  return {
    client: "gemini",
    name: "Gemini CLI",
    path,
    result,
    cli,
    notes,
    diff: result.ok ? formatJsonDiff(result.previous, result.next) : undefined,
  };
}
