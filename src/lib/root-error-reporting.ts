const ROOT_ERROR_EVENT = "planora.root_boundary_error";
const ROOT_ERROR_BOUNDARY = "tanstack_root_error_component";

const SAFE_ROUTE_PATHS = new Set(["/", "/login", "/tasks", "/archive", "/settings"]);

type UnknownValueType =
  | "bigint"
  | "boolean"
  | "function"
  | "null"
  | "number"
  | "object"
  | "string"
  | "symbol"
  | "undefined";

type RootBoundaryErrorSummary =
  | { kind: "error" }
  | { kind: "response"; status: number }
  | { kind: "unknown"; valueType: UnknownValueType };

export type RootBoundaryErrorRecord = {
  event: typeof ROOT_ERROR_EVENT;
  boundary: typeof ROOT_ERROR_BOUNDARY;
  routePath: string | null;
  error: RootBoundaryErrorSummary;
};

function readSafeRoutePath(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const { pathname } = window.location;
    // Null means route data was unavailable or the path was outside the allowlist.
    return SAFE_ROUTE_PATHS.has(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

function unknownValueType(value: unknown): UnknownValueType {
  return value === null ? "null" : typeof value;
}

function summarizeError(error: unknown): RootBoundaryErrorSummary {
  try {
    if (typeof Response !== "undefined" && error instanceof Response) {
      return { kind: "response", status: error.status };
    }

    if (error instanceof Error) {
      return { kind: "error" };
    }

    return { kind: "unknown", valueType: unknownValueType(error) };
  } catch {
    return { kind: "unknown", valueType: "object" };
  }
}

export function createRootBoundaryErrorRecord(error: unknown): RootBoundaryErrorRecord {
  return {
    event: ROOT_ERROR_EVENT,
    boundary: ROOT_ERROR_BOUNDARY,
    routePath: readSafeRoutePath(),
    error: summarizeError(error),
  };
}

export function reportRootBoundaryError(error: unknown): void {
  const record = createRootBoundaryErrorRecord(error);

  try {
    console.error(record);
  } catch {
    // A diagnostic sink must never prevent the error fallback from rendering.
  }
}
