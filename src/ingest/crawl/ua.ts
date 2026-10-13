import { VERSION } from "../../version.js";

export const REPO_URL = "https://github.com/Verdent06/coursecopilot";

export function crawlUserAgent(): string {
  return `CourseCopilot/${VERSION} (+${REPO_URL})`;
}
