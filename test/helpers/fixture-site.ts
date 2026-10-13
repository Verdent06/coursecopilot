import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSimplePdf, buildSimplePptx, LEC07_PAGES } from "./sample-files.js";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/site");

/** Copy committed HTML/robots and generate PDF/PPTX/zip/ics into `dir`. */
export async function writeFixtureSite(
  dir: string,
): Promise<{ dir: string; pdf: string; pptx: string }> {
  mkdirSync(dir, { recursive: true });
  cpSync(fixturesRoot, dir, { recursive: true });
  mkdirSync(join(dir, "files"), { recursive: true });
  const pdf = join(dir, "files", "lec07.pdf");
  const pptx = join(dir, "files", "slides.pptx");
  writeFileSync(pdf, buildSimplePdf(LEC07_PAGES, { landscape: true }));
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
  writeFileSync(join(dir, "files", "pack.zip"), Buffer.from("PK\u0003\u0004fixture-zip"));
  writeFileSync(
    join(dir, "calendar.ics"),
    "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Office hours\nEND:VEVENT\nEND:VCALENDAR\n",
  );
  return { dir, pdf, pptx };
}
