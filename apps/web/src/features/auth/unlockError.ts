import { ApiError } from "@/types";

/**
 * What the password page tells the visitor. Always one of these fixed sentences, never a raw
 * status code, response body or stack text (#124): the API's own messages for these codes are
 * the same words, but the page does not depend on that.
 */
export const UNLOCK_MESSAGES = {
  empty: "Enter the password.",
  invalid: "Incorrect password.",
  rateLimited: "Too many incorrect attempts. Try again later.",
  offline: "Can't reach Planora. Check your connection and try again.",
  other: "Couldn't unlock. Try again.",
} as const;

export function unlockErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INVALID_PASSWORD") return UNLOCK_MESSAGES.invalid;
    if (error.code === "RATE_LIMITED") return UNLOCK_MESSAGES.rateLimited;
    if (error.code === "NETWORK_ERROR") return UNLOCK_MESSAGES.offline;
  }
  return UNLOCK_MESSAGES.other;
}
