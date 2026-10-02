import { ApiError } from "@/types";

export const AI_TEXT_LIMIT = 4000;

function isApiWhitespace(character: string): boolean {
  // Python str.strip also treats these four information separators as whitespace.
  const code = character.charCodeAt(0);
  return /\p{White_Space}/u.test(character) || (code >= 0x1c && code <= 0x1f);
}

/** Match Python str.strip, including U+0085, while retaining U+FEFF. */
export function trimApiText(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isApiWhitespace(text[start]!)) start++;
  while (end > start && isApiWhitespace(text[end - 1]!)) end--;
  return text.slice(start, end);
}

/** Match Python len after stripping, rather than counting UTF-16 code units. */
export function countTrimmedCodePoints(text: string): number {
  return [...trimApiText(text)].length;
}

/** True when the API rejected the request because its `text` field failed validation. */
export function isTextValidationError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === "VALIDATION_ERROR" &&
    !!error.details?.some((detail) => detail.field === "text")
  );
}
