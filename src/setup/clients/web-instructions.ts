import { formatConnectorHelp } from "../../server/transport-http.js";

export type WebInstructionOpts = {
  origin?: string;
  secretPath?: string;
  token?: string;
};

/**
 * Exact click-path copy for clients that cannot be detected locally.
 * Gates are stated in the product README and here so setup never hides them.
 */
export function webClientInstructions(opts: WebInstructionOpts = {}): string {
  const origin = (opts.origin ?? "https://<your-host>").replace(/\/+$/, "");
  const secretPath = opts.secretPath ?? "<secret>";
  const token = opts.token ?? "<token>";
  const secretUrl = `${origin}/mcp/${secretPath}`;
  const oauthUrl = `${origin}/mcp`;
  const live = Boolean(opts.origin);

  const header = live
    ? `Paste these public URLs (tunnel hostname changes every restart):\n`
    : [
        "Web clients cannot be detected locally. They need a public HTTPS URL.",
        "Run `npx coursecopilot setup --remote` (starts serve --http + a Cloudflare tunnel)",
        "or `npx coursecopilot tunnel`, or a one-click deploy (Render / Fly / Railway).",
        "Then paste the URL in each product:",
        "",
      ].join("\n");

  const steps = [
    header,
    "claude.ai (web / mobile / Cowork)",
    `  URL: ${secretUrl}`,
    "  Steps: Customize → Connectors → Add → Custom → Web → paste URL → Authentication: No sign in",
    "  Docs: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    `  OAuth alternative: ${oauthUrl} → Authentication: Sign in now (DCR / Claude published identity)`,
    "  Free plan allows 1 custom connector.",
    "",
    "ChatGPT (developer mode)",
    `  URL: ${secretUrl}`,
    "  Steps: Enable developer mode → Plugins → + → Add custom MCP server → paste URL → No authentication",
    "  Docs: https://developers.openai.com/api/docs/guides/custom-mcp-server",
    "  Plan requirements: ChatGPT support needs a plan with developer mode. Check OpenAI's page:",
    "  https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt",
    "  We did not confirm access on Free/Plus. Pro is read/fetch tools only; recording a quiz may need Claude/Cursor or a Business/Enterprise/Edu plan.",
    "  ChatGPT-only alternative: OpenAI Secure MCP Tunnel (Platform org permissions).",
    "",
    "Gemini app (gemini.google.com + mobile) — Custom apps for Spark",
    `  URL: ${oauthUrl}  (OAuth + Dynamic Client Registration; not the secret path)`,
    "  Steps: gemini.google.com → Settings & help → Connected Apps → Custom apps for Spark → Add a custom app → paste URL",
    "  Docs: https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en",
    "  Eligibility (say so plainly): Gemini Spark, personal Google account (not work/school — a umich.edu login will not work), US, 18+, English, Keep Activity on.",
    "  Add the app on the web first; then it works in Spark on web and mobile.",
    "  School accounts: use Gemini CLI instead (`npx coursecopilot setup` configures it).",
    "  Google AI Studio has no MCP client. Gemini Enterprise is admin-only.",
    "",
    "Cursor / Claude Code / Gemini CLI over HTTP (optional):",
    `  URL ${oauthUrl}  with header  Authorization: Bearer ${token}`,
  ];

  if (live) {
    steps.push("", formatConnectorHelp(origin, opts.secretPath, token));
  }

  return steps.join("\n");
}

export function restartHints(configured: Array<{ id: string; name: string }>): string[] {
  const hints: string[] = [];
  for (const c of configured) {
    if (c.id === "claude-desktop") {
      hints.push("Restart Claude Desktop fully (Quit, then reopen) so it reloads MCP servers.");
    }
    if (c.id === "claude-code") {
      hints.push("In Claude Code, run `/mcp` (or start a new session) to see coursecopilot.");
    }
    if (c.id === "cursor") {
      hints.push("Reload Cursor MCP (Command Palette → “Reload MCP”) or restart Cursor.");
    }
    if (c.id === "gemini") {
      hints.push("In Gemini CLI, run `/mcp` to confirm coursecopilot is connected.");
    }
  }
  return hints;
}
