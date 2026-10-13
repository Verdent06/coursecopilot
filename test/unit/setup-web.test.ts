import { describe, expect, it } from "vitest";
import { webClientInstructions } from "../../src/setup/clients/web-instructions.js";
import { mcpbInstallInstructions } from "../../src/setup/mcpb.js";
import { runSetup } from "../../src/setup/run-setup.js";
import { createSetupContext } from "../../src/setup/types.js";

describe("web client instructions", () => {
  it("prints exact URLs and eligibility gates without a live origin", () => {
    const text = webClientInstructions();
    expect(text).toContain("https://<your-host>/mcp/<secret>");
    expect(text).toContain("Customize → Connectors → Add → Custom → Web");
    expect(text).toContain("developer mode");
    expect(text).toContain("plan with developer mode");
    expect(text).toContain("Custom apps for Spark");
    expect(text).toContain("personal Google account");
    expect(text).toContain("US");
    expect(text).toContain("18+");
    expect(text).toContain("umich.edu");
    expect(text).toContain("setup --remote");
    expect(text).toContain("https://support.google.com/gemini/answer/17209137");
    expect(text).toContain("https://developers.openai.com/api/docs/guides/custom-mcp-server");
  });

  it("substitutes a tunnel origin when --remote has a URL", () => {
    const text = webClientInstructions({
      origin: "https://abc.trycloudflare.com",
      secretPath: "s3cret",
      token: "tok",
    });
    expect(text).toContain("https://abc.trycloudflare.com/mcp/s3cret");
    expect(text).toContain("https://abc.trycloudflare.com/mcp");
    expect(text).not.toContain("<your-host>");
  });

  it("documents MCPB install for Claude Desktop", () => {
    const text = mcpbInstallInstructions();
    expect(text).toMatch(/\.mcpb/);
    expect(text).toContain("Install Extension");
    expect(text).toContain("canvas_token");
    expect(text).toContain("sensitive");
  });

  it("setup --yes with no clients still prints web instructions", async () => {
    const lines: string[] = [];
    const ctx = createSetupContext({
      homedir: "/tmp/cc-none",
      exists: () => false,
      which: () => undefined,
    });
    const report = await runSetup(
      { yes: true },
      { ctx, interactive: false, out: (l) => lines.push(l) },
    );
    expect(report.ok).toBe(true);
    expect(report.web).toContain("claude.ai");
    expect(report.web).toContain("ChatGPT");
    expect(report.web).toContain("Gemini app");
    expect(lines.join("\n")).toContain("No local clients detected");
  });

  it("optional Canvas / pack / model hooks run when flagged", async () => {
    const calls: string[] = [];
    const ctx = createSetupContext({
      homedir: "/tmp/cc-none",
      exists: () => false,
      which: () => undefined,
    });
    await runSetup(
      { yes: true, canvas: true, pack: "harvard-cs50x", downloadModel: true },
      {
        ctx,
        interactive: false,
        connectCanvasFn: async () => {
          calls.push("canvas");
          return {
            ok: true,
            name: "Jane",
            baseUrl: "https://umich.instructure.com",
            secretsPath: "/tmp/secrets.json",
          };
        },
        addPackFn: async (id) => {
          calls.push(`pack:${id}`);
          return { course_id: "harvard-cs50x", pack_id: id };
        },
        downloadModelFn: async () => {
          calls.push("model");
          return true;
        },
        out: () => undefined,
      },
    );
    expect(calls).toEqual(["canvas", "pack:harvard-cs50x", "model"]);
  });
});
