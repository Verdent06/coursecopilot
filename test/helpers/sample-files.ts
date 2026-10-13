import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

/** Build a minimal PDF 1.4 with Helvetica text, one page per string. */
export function buildSimplePdf(pages: string[]): Buffer {
  if (pages.length < 1) {
    throw new Error("PDF needs at least one page");
  }
  const n = pages.length;
  const pageIds = Array.from({ length: n }, (_, i) => 3 + i);
  const contentIds = Array.from({ length: n }, (_, i) => 3 + n + i);
  const fontId = 3 + 2 * n;

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`,
  );
  for (let i = 0; i < n; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
  }
  for (const page of pages) {
    const stream = pageContentStream(page);
    const len = Buffer.byteLength(stream, "latin1");
    objects.push(`<< /Length ${len} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

function pageContentStream(text: string): string {
  const lines = text.split("\n");
  const ops = lines.map((line, i) => {
    const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const tj = `(${escaped}) Tj`;
    return i === 0 ? tj : `0 -16 Td ${tj}`;
  });
  return `BT /F1 12 Tf 72 720 Td\n${ops.join("\n")}\nET`;
}

export type SampleSlide = {
  title: string;
  body?: string;
  notes?: string;
};

/** Minimal OOXML deck that our PPTX extractor can read (slides + optional notes). */
export async function buildSimplePptx(slides: SampleSlide[]): Promise<Buffer> {
  const zip = new JSZip();
  const sldIds = slides
    .map((_, i) => `    <p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
    .join("\n");
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
${sldIds}
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>
`,
  );

  const rels = slides
    .map(
      (_, i) =>
        `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
    )
    .join("\n");
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
</Relationships>
`,
  );

  slides.forEach((slide, i) => {
    const n = i + 1;
    const bodyXml = slide.body
      ? `<p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(slide.body)}</a:t></a:r></a:p></p:txBody>
      </p:sp>`
      : "";
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      ${bodyXml}
    </p:spTree>
  </p:cSld>
</p:sld>
`,
    );
    if (slide.notes) {
      zip.file(
        `ppt/slides/_rels/slide${n}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>
</Relationships>
`,
      );
      zip.file(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(slide.notes)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>
`,
      );
    }
  });

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return Buffer.from(buf);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const SAMPLE_MD = `# Lecture 7

## Pumping Lemma
The pumping lemma says that every regular language can be pumped.

### Proof
Assume L is regular and derive a contradiction for a^n b^n.
`;

export const SAMPLE_TXT =
  "Office hours are Tuesdays at 3pm in the Beyster building. Bring questions on the pumping lemma.";

/**
 * Write a sample course folder: PDF, PPTX, Markdown, TXT, plus a skipped binary and a dotfile.
 */
export async function writeSampleFolder(dir: string): Promise<{
  dir: string;
  pdf: string;
  pptx: string;
  md: string;
  txt: string;
}> {
  mkdirSync(join(dir, "sub"), { recursive: true });
  const pdf = join(dir, "lec07.pdf");
  const pptx = join(dir, "lec07.pptx");
  const md = join(dir, "notes.md");
  const txt = join(dir, "sub", "office-hours.txt");
  writeFileSync(
    pdf,
    buildSimplePdf([
      "Lecture 7: Nonregular languages",
      "The pumping lemma: if L is regular, there exists p such that any string s in L with |s| >= p can be divided into xyz.",
    ]),
  );
  writeFileSync(
    pptx,
    await buildSimplePptx([
      {
        title: "Pumping Lemma",
        body: "A method to prove languages are not regular",
        notes: "Walk through the lemma hypotheses first",
      },
      {
        title: "Proof idea",
        body: "Pick a string that cannot be pumped, such as a^p b^p",
      },
    ]),
  );
  writeFileSync(md, SAMPLE_MD);
  writeFileSync(txt, SAMPLE_TXT);
  writeFileSync(join(dir, "skip.bin"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(dir, ".hidden.md"), "this dotfile should be ignored");
  return { dir, pdf, pptx, md, txt };
}
