import { basename, posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { MIME_PPTX } from "../mime.js";
import type { ExtractedDocument, ExtractedSegment } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

type Rel = { id: string; type: string; target: string };

export async function extractPptx(
  bytes: Uint8Array,
  fileUri: string,
  filePath: string,
): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const presentationPath = findZipPath(zip, "ppt/presentation.xml");
  if (!presentationPath) {
    throw new Error("PPTX is missing ppt/presentation.xml");
  }
  const presentationXml = await readZipFile(zip, presentationPath);
  if (!presentationXml) {
    throw new Error("PPTX is missing ppt/presentation.xml");
  }
  const rels = parseRels(await readZipFile(zip, relsPathFor(presentationPath)));
  const slideRels = rels.filter((r) => relationshipKind(r.type) === "slide");
  const sldIds = collectSlideRelsIds(parseXml(presentationXml));

  const orderedTargets: string[] = [];
  if (sldIds.length > 0) {
    for (const rid of sldIds) {
      const rel = slideRels.find((r) => r.id === rid);
      if (rel) {
        orderedTargets.push(resolveZipTarget(presentationPath, rel.target));
      }
    }
  } else {
    for (const rel of slideRels) {
      orderedTargets.push(resolveZipTarget(presentationPath, rel.target));
    }
  }

  const segments: ExtractedSegment[] = [];
  let index = 0;
  for (const slidePath of orderedTargets) {
    index += 1;
    const slideXml = await readZipFile(zip, slidePath);
    if (!slideXml) {
      continue;
    }
    const slideTexts = collectTextRuns(parseXml(slideXml));
    const title = slideTexts[0] ?? `Slide ${index}`;
    const body = slideTexts.slice(1);
    const notes = await readNotes(zip, slidePath);
    const parts = [title, ...body];
    if (notes) {
      parts.push(`Notes: ${notes}`);
    }
    const text = parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) {
      continue;
    }
    segments.push({
      text,
      locator: { path: fileUri, slide: index, title },
      headingPath: `Slide ${index} > ${title}`,
    });
  }

  return {
    title: segments[0]?.locator.title || basename(filePath),
    mime: MIME_PPTX,
    segments,
    meta: { slide_count: orderedTargets.length },
  };
}

function relationshipKind(type: string): "slide" | "notesSlide" | "other" {
  if (type.endsWith("/notesSlide")) {
    return "notesSlide";
  }
  if (type.endsWith("/slide")) {
    return "slide";
  }
  return "other";
}

function findZipPath(zip: JSZip, want: string): string | undefined {
  const normalized = want.replace(/\\/g, "/");
  return Object.keys(zip.files).find((n) => n.replace(/\\/g, "/") === normalized);
}

async function readZipFile(zip: JSZip, path: string): Promise<string | undefined> {
  const normalized = path.replace(/\\/g, "/").replace(/^\//, "");
  const file = zip.file(normalized);
  if (!file) {
    return undefined;
  }
  return file.async("string");
}

function relsPathFor(partPath: string): string {
  const normalized = partPath.replace(/\\/g, "/");
  const dir = posix.dirname(normalized);
  const base = posix.basename(normalized);
  return posix.join(dir, "_rels", `${base}.rels`);
}

function resolveZipTarget(fromPart: string, target: string): string {
  const cleaned = target.replace(/\\/g, "/");
  if (cleaned.startsWith("/")) {
    return cleaned.replace(/^\//, "");
  }
  const dir = posix.dirname(fromPart.replace(/\\/g, "/"));
  return posix.normalize(posix.join(dir, cleaned));
}

function parseRels(xml: string | undefined): Rel[] {
  if (!xml) {
    return [];
  }
  const doc = parseXml(xml) as Record<string, unknown>;
  const relsRoot = (doc.Relationships ?? doc) as Record<string, unknown>;
  const raw = relsRoot.Relationship;
  const list = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  return list.map((item) => {
    const rec = item as Record<string, unknown>;
    return {
      id: String(rec["@_Id"] ?? rec.Id ?? ""),
      type: String(rec["@_Type"] ?? rec.Type ?? ""),
      target: String(rec["@_Target"] ?? rec.Target ?? ""),
    };
  });
}

function collectSlideRelsIds(doc: unknown): string[] {
  const ids: string[] = [];
  walk(doc, (rec) => {
    const raw = rec.sldId ?? rec["p:sldId"];
    if (raw == null) {
      return;
    }
    const list = Array.isArray(raw) ? raw : [raw];
    for (const item of list) {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const relId = String(row["@_r:id"] ?? row["@_r:Id"] ?? "");
        if (relId) {
          ids.push(relId);
        }
      }
    }
  });
  return ids;
}

async function readNotes(zip: JSZip, slidePath: string): Promise<string | undefined> {
  const rels = parseRels(await readZipFile(zip, relsPathFor(slidePath)));
  const notesRel = rels.find((r) => relationshipKind(r.type) === "notesSlide");
  if (!notesRel) {
    return undefined;
  }
  const notesPath = resolveZipTarget(slidePath, notesRel.target);
  const xml = await readZipFile(zip, notesPath);
  if (!xml) {
    return undefined;
  }
  const runs = collectTextRuns(parseXml(xml));
  const filtered = runs.filter((t) => !/^\d+$/.test(t.trim()) && !/^click to/i.test(t.trim()));
  const text = filtered.join(" ").trim();
  return text || undefined;
}

function collectTextRuns(node: unknown): string[] {
  const out: string[] = [];
  walk(node, (rec) => {
    const raw = rec.t ?? rec["a:t"];
    if (raw == null) {
      return;
    }
    for (const v of flattenText(raw)) {
      const trimmed = v.replaceAll("\0", "");
      if (trimmed) {
        out.push(trimmed);
      }
    }
  });
  return out;
}

function flattenText(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenText);
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec["#text"] === "string") {
      return [rec["#text"]];
    }
  }
  return [];
}

function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

function walk(node: unknown, visit: (rec: Record<string, unknown>) => void): void {
  if (node == null) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visit);
    }
    return;
  }
  if (typeof node === "object") {
    const rec = node as Record<string, unknown>;
    visit(rec);
    for (const value of Object.values(rec)) {
      walk(value, visit);
    }
  }
}
