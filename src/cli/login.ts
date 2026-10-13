import { resolve } from "node:path";
import { importLeccapCookies, loginLeccapBrowser } from "../ingest/providers/leccap/auth.js";

export async function runLoginCommand(provider: string, opts: { cookies?: string }): Promise<void> {
  const id = provider.trim().toLowerCase();
  if (id !== "leccap") {
    console.error(
      `Unknown login provider "${provider}". Currently supported: leccap (UMich CAEN Lecture Capture). Panopto/Kaltura adapters can reuse this command later.`,
    );
    process.exitCode = 1;
    return;
  }
  if (opts.cookies) {
    const path = importLeccapCookies(resolve(opts.cookies));
    console.error(`Imported leccap cookies to ${path} (mode 0600). Passwords were not stored.`);
    console.error("Add the course site or a recording URL with add_source kind=leccap.");
    return;
  }
  if (!process.stdin.isTTY && process.env.COURSECOPILOT_ALLOW_HEADLESS_LOGIN !== "1") {
    console.error(
      "Interactive login needs a terminal. Run `npx coursecopilot login leccap` locally, or pass --cookies <file>.",
    );
    process.exitCode = 1;
    return;
  }
  const path = await loginLeccapBrowser({ headed: true, installPlaywright: true });
  console.error(`Logged in. Session saved to ${path}.`);
}
