declare module "tesseract.js" {
  export function recognize(
    image: Buffer | Uint8Array,
    langs: string,
    opts?: { logger?: (m: unknown) => void },
  ): Promise<{ data: { text: string } }>;
}

declare module "playwright" {
  export const chromium: {
    launchPersistentContext: (
      userDataDir: string,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}
