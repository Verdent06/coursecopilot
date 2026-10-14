export const CANVAS_ERROR = {
  notConfigured: "canvas_not_configured",
  tokenRejected: "token_rejected",
  tokensBlocked: "tokens_blocked",
} as const;

export type CanvasErrorCode = (typeof CANVAS_ERROR)[keyof typeof CANVAS_ERROR];

export const CANVAS_FALLBACK =
  "Many schools (including UMich) block student personal access tokens. You do not need one. Tier 1: Canvas → Calendar → Calendar Feed — paste the ICS URL on the connect_canvas page (due dates across every course). Tier 2: install the CourseCopilot browser extension, pair it with the one-time code from chat, and Sync while signed into Canvas. Tier 3: a personal token, only if your school still shows “+ New Access Token.” You can also add a public course website, a course pack, or upload files.";

export const TOKEN_REJECTED_HINT =
  "Canvas returned 401. Your token may be expired or revoked. Prefer the calendar feed or the browser extension (connect_canvas). Or create a new token at Account → Settings → Approved Integrations → “+ New Access Token” if your school allows it.";

export const TOKENS_BLOCKED_HINT =
  "This Canvas instance rejected personal access tokens (403 or a school policy error). The “+ New Access Token” button is often missing when the school blocks them. Use the calendar feed or the browser extension instead — call connect_canvas.";

export const NOT_CONFIGURED_HINT =
  "Canvas is not configured. Call connect_canvas: first paste the Calendar → Calendar Feed ICS URL (no token). For courses, modules, pages, and files, pair the browser extension. A personal token is optional and only works if your school allows it.";

export type CanvasErrorPayload = {
  error: CanvasErrorCode;
  fallback: string;
};

export function canvasFallbackMessage(code: CanvasErrorCode): string {
  if (code === CANVAS_ERROR.notConfigured) {
    return `${NOT_CONFIGURED_HINT}\n\n${CANVAS_FALLBACK}`;
  }
  if (code === CANVAS_ERROR.tokensBlocked) {
    return `${TOKENS_BLOCKED_HINT}\n\n${CANVAS_FALLBACK}`;
  }
  return `${TOKEN_REJECTED_HINT}\n\n${CANVAS_FALLBACK}`;
}

export function canvasErrorPayload(code: CanvasErrorCode): CanvasErrorPayload {
  return { error: code, fallback: canvasFallbackMessage(code) };
}

export class CanvasApiError extends Error {
  readonly code: CanvasErrorCode;
  readonly status: number | undefined;
  readonly fallback: string;

  constructor(input: { code: CanvasErrorCode; message?: string; status?: number }) {
    const fallback = canvasFallbackMessage(input.code);
    super(input.message ?? fallback);
    this.name = "CanvasApiError";
    this.code = input.code;
    this.status = input.status;
    this.fallback = fallback;
  }

  payload(): CanvasErrorPayload {
    return { error: this.code, fallback: this.fallback };
  }
}

export function looksLikeTokenPolicy(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    /personal access tokens? (are )?disabled/.test(lower) ||
    /access tokens? (are )?disabled/.test(lower) ||
    /tokens? (are )?(not allowed|blocked|forbidden)/.test(lower) ||
    (/approved integrations/.test(lower) && /disabled/.test(lower))
  );
}

export function classifyCanvasAuthError(status: number, body: string): CanvasErrorCode {
  if (looksLikeTokenPolicy(body)) {
    return CANVAS_ERROR.tokensBlocked;
  }
  if (status === 403) {
    return CANVAS_ERROR.tokensBlocked;
  }
  return CANVAS_ERROR.tokenRejected;
}
