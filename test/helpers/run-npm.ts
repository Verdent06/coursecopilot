import { execFileSync, execSync } from "node:child_process";

/**
 * Run the npm CLI. Node 20+ on Windows refuses to spawn `.cmd` without a shell
 * (`spawnSync npm.cmd EINVAL`, CVE-2024-27980), so Windows goes through `cmd.exe`.
 */
export function runNpm(
  args: readonly string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): string {
  if (process.platform === "win32") {
    const command = ["npm", ...args].map(quoteCmdArg).join(" ");
    return execSync(command, {
      cwd: opts.cwd,
      env: opts.env,
      encoding: "utf8",
      windowsHide: true,
    });
  }
  return execFileSync("npm", [...args], {
    cwd: opts.cwd,
    env: opts.env,
    encoding: "utf8",
  });
}

function quoteCmdArg(arg: string): string {
  if (!/[\s&|<>^()"]/.test(arg)) {
    return arg;
  }
  return `"${arg.replaceAll('"', '\\"')}"`;
}
