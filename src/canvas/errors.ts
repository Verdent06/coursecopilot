export const CANVAS_ERROR = {
  notConfigured: "canvas_not_configured",
  tokenRejected: "token_rejected",
  tokensBlocked: "tokens_blocked",
} as const;

export type CanvasErrorCode = (typeof CANVAS_ERROR)[keyof typeof CANVAS_ERROR];

export const CANVAS_FALLBACK =
  "If your school disabled personal access tokens (no “+ New Access Token” button under Account → Settings → Approved Integrations), CourseCopilot cannot talk to Canvas. Use a public course website (`add_source` kind=website), a course pack (`add-pack`), or download files in the browser and add the folder (`add_source` kind=folder).";

export const TOKEN_REJECTED_HINT =
  "Canvas returned 401. Your token may be expired or revoked. Create a new one at Account → Settings → Approved Integrations → “+ New Access Token.”";

export const TOKENS_BLOCKED_HINT =
  "This Canvas instance rejected personal access tokens (403 or a school policy error). The “+ New Access Token” button is often missing when the school blocks them.";

export const NOT_CONFIGURED_HINT =
  "Canvas is not configured. Run `coursecopilot canvas connect` (or set CANVAS_BASE_URL and CANVAS_TOKEN on this machine). The token stays in ~/.coursecopilot/secrets.json (0600) or the process env — never the database, packs, or client configs.";

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
