import { createRequire } from "node:module";
import { crawlUserAgent } from "./ua.js";
import { originOf } from "./url.js";

const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (url: string, body: string) => Robot;

export type RobotsChecker = {
  allowed(url: string): Promise<boolean>;
};

type Robot = {
  isAllowed(url: string, ua?: string): boolean | undefined;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetch and cache robots.txt per origin. A missing or unreadable file allows all
 * paths (standard crawler behavior). `isAllowed === false` is a disallow.
 */
export function createRobotsChecker(
  fetchFn: FetchLike,
  options: { userAgent?: string; throttle?: (url: string) => Promise<void> } = {},
): RobotsChecker {
  const ua = options.userAgent ?? crawlUserAgent();
  const cache = new Map<string, Robot | null>();

  async function load(origin: string): Promise<Robot | null> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      if (options.throttle) {
        await options.throttle(robotsUrl);
      }
      const res = await fetchFn(robotsUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": ua, Accept: "text/plain,*/*" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return null;
      }
      const body = await res.text();
      return robotsParser(robotsUrl, body) as Robot;
    } catch {
      return null;
    }
  }

  return {
    async allowed(url: string): Promise<boolean> {
      let origin: string;
      try {
        origin = originOf(url);
      } catch {
        return false;
      }
      let robot = cache.get(origin);
      if (robot === undefined) {
        robot = await load(origin);
        cache.set(origin, robot);
      }
      if (!robot) {
        return true;
      }
      return robot.isAllowed(url, ua) !== false;
    },
  };
}
