import { describe, expect, it } from "vitest";
import { ApiError } from "@/types";
import { UNLOCK_MESSAGES, unlockErrorMessage } from "./unlockError";

describe("unlockErrorMessage", () => {
  it("names a wrong password", () => {
    const error = new ApiError("INVALID_PASSWORD", "anything", { status: 401 });
    expect(unlockErrorMessage(error)).toBe("Incorrect password.");
  });

  it("explains the rate limit without a status code", () => {
    const error = new ApiError("RATE_LIMITED", "429 Too Many Requests", { status: 429 });
    expect(unlockErrorMessage(error)).toBe("Too many incorrect attempts. Try again later.");
  });

  it("says the server cannot be reached", () => {
    const error = new ApiError("NETWORK_ERROR", "raw fetch failure");
    expect(unlockErrorMessage(error)).toBe(UNLOCK_MESSAGES.offline);
  });

  it("gives every other failure the same recoverable sentence, never its own text", () => {
    for (const error of [
      new ApiError("INTERNAL_ERROR", "Traceback (most recent call last)", { status: 500 }),
      new ApiError("UNEXPECTED_RESPONSE", "<html>502</html>", { status: 502 }),
      new Error("TypeError: x is undefined"),
      "boom",
      undefined,
    ]) {
      expect(unlockErrorMessage(error)).toBe("Couldn't unlock. Try again.");
    }
  });
});
