import { describe, expect, it } from "vitest";
import { createRobotsChecker } from "../../src/ingest/crawl/robots.js";
import { inFileScope, inPageScope, makeScope } from "../../src/ingest/crawl/scope.js";
import { looksLikeFileUrl, urlSkipReason } from "../../src/ingest/crawl/skip.js";
import { canonicalizeUrl, defaultPathPrefix } from "../../src/ingest/crawl/url.js";

describe("URL canonicalization", () => {
  it("strips fragments, tracking params, trailing slashes, and index.html", () => {
    expect(canonicalizeUrl("https://eecs376.org/lec/?utm_source=x#frag")).toBe(
      "https://eecs376.org/lec",
    );
    expect(canonicalizeUrl("https://EECS376.ORG:443/foo/index.html")).toBe(
      "https://eecs376.org/foo",
    );
    expect(canonicalizeUrl("/notes.html", "https://eecs376.org/")).toBe(
      "https://eecs376.org/notes.html",
    );
  });

  it("derives a directory path prefix from the seed", () => {
    expect(defaultPathPrefix("https://eecs376.org/")).toBe("/");
    expect(defaultPathPrefix("https://ocw.mit.edu/courses/6-045j-foo/")).toBe(
      "/courses/6-045j-foo/",
    );
    expect(defaultPathPrefix("https://ocw.mit.edu/courses/6-045j-foo/lec07.pdf")).toBe(
      "/courses/6-045j-foo/",
    );
  });
});

describe("crawl scope", () => {
  const scope = makeScope("https://eecs376.org/", "/");

  it("keeps HTML on-origin and allows off-origin file hops", () => {
    expect(inPageScope("https://eecs376.org/lectures", scope)).toBe(true);
    expect(inPageScope("https://example.com/offsite.html", scope)).toBe(false);
    expect(inFileScope("https://github.com/org/repo/raw/lec07.pdf", scope, true)).toBe(true);
    expect(looksLikeFileUrl("https://eecs376.org/files/lec07.pdf")).toBe(true);
  });

  it("respects a path prefix", () => {
    const course = makeScope("https://ocw.mit.edu/courses/foo/", "/courses/foo/");
    expect(inPageScope("https://ocw.mit.edu/courses/foo/pages/x", course)).toBe(true);
    expect(inPageScope("https://ocw.mit.edu/courses/other/pages/x", course)).toBe(false);
  });
});

describe("URL skip reasons", () => {
  it("skips mailto, zip, video, and calendars", () => {
    expect(urlSkipReason("mailto:a@b.com")).toBe("mailto");
    expect(urlSkipReason("https://eecs376.org/files/pack.zip")).toBe("archive");
    expect(urlSkipReason("https://eecs376.org/intro.mp4")).toBe("video/audio");
    expect(urlSkipReason("https://eecs376.org/calendar.ics")).toBe("calendar");
    expect(urlSkipReason("https://eecs376.org/notes.html")).toBeNull();
  });
});

describe("robots.txt", () => {
  it("disallows paths listed for *", async () => {
    const body = "User-agent: *\nDisallow: /private/\n";
    const fetchFn = async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response(body, { status: 200 });
      }
      return new Response("no", { status: 404 });
    };
    const robots = createRobotsChecker(fetchFn);
    expect(await robots.allowed("https://eecs376.org/lectures.html")).toBe(true);
    expect(await robots.allowed("https://eecs376.org/private/secret.html")).toBe(false);
  });
});
