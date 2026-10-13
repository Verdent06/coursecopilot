import { log } from "../../util/log.js";
import type { OcrFn } from "./types.js";

type TesseractModule = {
  recognize: (
    image: Buffer | Uint8Array,
    langs: string,
    opts?: { logger?: (m: unknown) => void },
  ) => Promise<{ data: { text: string } }>;
};

/**
 * Load tesseract.js if the user has it installed (optional, never a default dep).
 * Returns null when missing so ingest still records slide indexes without OCR text.
 */
export async function loadOcr(): Promise<OcrFn | null> {
  try {
    const mod = (await import("tesseract.js")) as unknown as TesseractModule;
    if (typeof mod.recognize !== "function") {
      return null;
    }
    return async (imageBytes: Uint8Array) => {
      const result = await mod.recognize(Buffer.from(imageBytes), "eng", {
        logger: () => undefined,
      });
      return result.data.text ?? "";
    };
  } catch {
    log.info(
      "tesseract.js is not installed; lecture-capture ingest will record slide indexes without OCR. Optional: npm install tesseract.js",
    );
    return null;
  }
}
