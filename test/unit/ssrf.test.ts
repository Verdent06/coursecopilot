import { describe, expect, it } from "vitest";
import { RepoError } from "../../src/db/repo.js";
import {
  assertPublicUrl,
  isBlockedHostname,
  isPrivateIp,
  isPrivateIpv4,
} from "../../src/util/ssrf.js";

describe("SSRF guard", () => {
  it("flags loopback, RFC1918, link-local, CGNAT", () => {
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
    expect(isPrivateIpv4("10.0.0.5")).toBe(true);
    expect(isPrivateIpv4("192.168.1.9")).toBe(true);
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("169.254.169.254")).toBe(true);
    expect(isPrivateIpv4("100.64.0.1")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("::ffff:192.168.0.1")).toBe(true);
  });

  it("blocks localhost and .internal hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("foo.localhost")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
  });

  it("assertPublicUrl rejects private literals and allows public https", () => {
    expect(() => assertPublicUrl("http://127.0.0.1/secret")).toThrow(RepoError);
    expect(() => assertPublicUrl("http://192.168.0.10/x")).toThrow(RepoError);
    expect(() => assertPublicUrl("http://localhost:8787/mcp")).toThrow(RepoError);
    expect(() => assertPublicUrl("ftp://example.com/x")).toThrow(RepoError);
    const u = assertPublicUrl("https://ocw.mit.edu/courses/");
    expect(u.hostname).toBe("ocw.mit.edu");
  });
});
