/**
 * The fetch wrapper for HTTP-mode `ApiClient` calls (issue #35, ADR 0002,
 * spec §3.2, §13.1).
 *
 * - Every request goes to a relative `/api/v1/...` URL with
 *   `credentials: "same-origin"` (the `planora_access` cookie is first-party; the wrapper never
 *   reads it, the API sets and clears it) and
 *   `Accept: application/json`. A request with a body also sends
 *   `Content-Type: application/json`.
 * - The wrapper never sets `Origin` itself — the browser supplies it, and
 *   the API's middleware compares it with `APP_ORIGIN`.
 * - Nothing here runs at import time; `fetch` is only ever called from
 *   inside `request()`, when an endpoint function actually invokes it. The
 *   spec keeps data fetching out of the server render (§16).
 * - A `204` resolves to `undefined`. A `2xx` with a JSON body resolves to
 *   the parsed body. Anything else — a network failure, a non-2xx response,
 *   or a body that was supposed to be JSON and is not — rejects with the
 *   shared `ApiError`.
 */
import { ApiError, type ValidationErrorDetail } from "@/types";

const API_BASE = "/api/v1";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type QueryValue = string | number | undefined;

export type RequestOptions = {
  method: HttpMethod;
  /** Path relative to `/api/v1`, e.g. `/tasks/${encodeURIComponent(id)}`. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  profile?: import("../profiles").ProfileId | null;
  /** Aborting it aborts the fetch; the rejection is the abort error itself, not an `ApiError`. */
  signal?: AbortSignal | undefined;
};

type WireValidationDetail = {
  code: string;
  field: string | null;
  message: string;
};

type WireErrorBody = {
  code: string;
  message: string;
  details?: WireValidationDetail[] | null;
};

function isWireErrorBody(value: unknown): value is WireErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["code"] === "string" && typeof record["message"] === "string";
}

/**
 * `ValidationErrorDetail`'s field names (`code`, `field`, `message`) are
 * identical on the wire and in the domain model, so this is a shape check,
 * not a snake↔camel conversion — binding rule 2 is unaffected by keeping it
 * here instead of `mappers.ts`.
 */
function mapDetails(
  details: WireValidationDetail[] | null | undefined,
): ValidationErrorDetail[] | undefined {
  return details && details.length > 0 ? details.map((d) => ({ ...d })) : undefined;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

function unexpectedResponse(status: number): ApiError {
  return new ApiError(
    "UNEXPECTED_RESPONSE",
    "Planora received an unexpected response. Please try again.",
    { status },
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function request<TResponse>(options: RequestOptions): Promise<TResponse> {
  const { method, path, query, body, signal } = options;
  const hasBody = body !== undefined;

  const init: RequestInit = {
    method,
    ...(signal ? { signal } : {}),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.profile ? { "X-Planora-Profile": options.profile } : {}),
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), init);
  } catch (error) {
    // A cancellation is not a network failure: let callers tell the two apart.
    if (signal?.aborted) throw error;
    throw new ApiError(
      "NETWORK_ERROR",
      "Can't reach Planora. Check your connection and try again.",
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  if (!response.ok) {
    const parsed = await readJson(response);
    if (isWireErrorBody(parsed)) {
      const details = mapDetails(parsed.details);
      throw new ApiError(parsed.code, parsed.message, {
        status: response.status,
        ...(details !== undefined ? { details } : {}),
      });
    }
    throw unexpectedResponse(response.status);
  }

  const text = await response.text();
  if (!text) throw unexpectedResponse(response.status);
  try {
    return JSON.parse(text) as TResponse;
  } catch {
    throw unexpectedResponse(response.status);
  }
}
