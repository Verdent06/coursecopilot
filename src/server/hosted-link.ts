import type { FlowPurpose } from "../hosted/flow.js";
import type { HostedToolContext } from "./index.js";

export function hostedPageLink(
  hosted: HostedToolContext | undefined,
  purpose: FlowPurpose,
): { url: string | null; hint: string } {
  if (hosted?.enabled && hosted.publicUrl && hosted.signFlow && hosted.userId) {
    const token = hosted.signFlow(purpose);
    const path =
      purpose === "canvas"
        ? "/connect/canvas"
        : purpose === "leccap"
          ? "/connect/leccap"
          : "/upload";
    return { url: `${hosted.publicUrl}${path}?t=${encodeURIComponent(token)}`, hint: "" };
  }
  return {
    url: null,
    hint: "This session is local/stdio. Deploy CourseCopilot (see the README) and paste https://<host>/mcp into Claude/ChatGPT/Gemini so these links appear in chat. Advanced: `npx coursecopilot canvas connect` / `login leccap`.",
  };
}
