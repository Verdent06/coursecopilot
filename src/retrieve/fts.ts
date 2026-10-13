/** Turn a user query into a safe FTS5 MATCH string (quoted OR of tokens). */
export function ftsMatchQuery(raw: string): string | null {
  const terms = raw
    .replace(/["*():^]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+/, "").replaceAll('"', ""))
    .filter((t) => t.length >= 2);
  if (terms.length === 0) {
    return null;
  }
  return terms.map((t) => `"${t}"`).join(" OR ");
}
