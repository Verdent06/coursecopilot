/**
 * Every tool returns structuredContent plus a short text rendering, per spec §7.1.
 */
export function ok<T extends Record<string, unknown>>(
  data: T,
  text?: string,
): {
  content: [{ type: "text"; text: string }];
  structuredContent: T;
} {
  return {
    content: [{ type: "text", text: text ?? JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function fail(message: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
