#!/usr/bin/env npx tsx
import { packMcpbBundle } from "../src/setup/pack-mcpb.js";

const keep = process.argv.includes("--keep-staging");
const outIdx = process.argv.indexOf("--out");
const outputPath = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;

const result = await packMcpbBundle({ outputPath, keepStaging: keep });
process.stdout.write(
  `Wrote ${result.outputPath}` +
    (result.usedOfficialCli ? " (official mcpb CLI)\n" : " (JSZip fallback)\n"),
);
if (result.validated) {
  process.stdout.write("manifest.json validated with @anthropic-ai/mcpb\n");
} else if (result.cliMessage) {
  process.stderr.write(`mcpb CLI: ${result.cliMessage}\n`);
} else {
  process.stdout.write(
    "Official mcpb CLI not found; packed as a zip. Install @anthropic-ai/mcpb to validate.\n",
  );
}
