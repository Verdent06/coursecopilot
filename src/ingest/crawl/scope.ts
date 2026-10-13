import { originOf } from "./url.js";

export type CrawlScope = {
  origin: string;
  prefix: string;
};

export function makeScope(seedUrl: string, prefix: string): CrawlScope {
  return { origin: originOf(seedUrl), prefix };
}

export function sameOrigin(url: string, scope: CrawlScope): boolean {
  try {
    return originOf(url) === scope.origin;
  } catch {
    return false;
  }
}

export function inPathPrefix(url: string, scope: CrawlScope): boolean {
  try {
    const path = new URL(url).pathname || "/";
    if (scope.prefix === "/") {
      return true;
    }
    return path === scope.prefix.slice(0, -1) || path.startsWith(scope.prefix);
  } catch {
    return false;
  }
}

/** HTML pages must stay same-origin and under the path prefix. */
export function inPageScope(url: string, scope: CrawlScope): boolean {
  return sameOrigin(url, scope) && inPathPrefix(url, scope);
}

/**
 * Linked PDFs/PPTX may be one hop off-origin (Drive, GitHub raw). Callers must
 * not extract further links from them.
 */
export function inFileScope(url: string, scope: CrawlScope, offOriginOk: boolean): boolean {
  if (inPageScope(url, scope)) {
    return true;
  }
  return offOriginOk;
}
