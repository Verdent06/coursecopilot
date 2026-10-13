import { generateRemoteSecrets } from "../remote/auth.js";
import { startQuickTunnel, type TunnelHandle } from "../remote/tunnel.js";
import { type HttpServerHandle, startHttpServer } from "../server/transport-http.js";

export type SetupRemoteHandle = {
  origin: string;
  mcpUrl: string;
  token: string;
  secretPath?: string;
  close: () => Promise<void>;
};

/**
 * Same as `coursecopilot tunnel`: Streamable HTTP on loopback plus a
 * Cloudflare quick tunnel. Hostname changes every restart.
 */
export async function startSetupRemote(opts: {
  port: number;
  token?: string;
  secretPath?: string;
}): Promise<SetupRemoteHandle> {
  const generated = generateRemoteSecrets();
  const token = opts.token || process.env.COURSECOPILOT_TOKEN || generated.token;
  const secretPath = opts.secretPath || process.env.COURSECOPILOT_SECRET_PATH || token;
  const http: HttpServerHandle = await startHttpServer({
    port: opts.port,
    bind: "127.0.0.1",
    token,
    secretPath,
    allowLocalPaths: false,
    oauth: process.env.COURSECOPILOT_OAUTH !== "0",
  });
  let tunnel: TunnelHandle;
  try {
    tunnel = await startQuickTunnel(http.port);
  } catch (err) {
    await http.close();
    throw err;
  }
  return {
    origin: tunnel.url,
    mcpUrl: `${tunnel.url}/mcp/${secretPath}`,
    token,
    secretPath,
    close: async () => {
      tunnel.close();
      await http.close();
    },
  };
}
