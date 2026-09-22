import type { ApiClient } from "./ApiClient";
import { mockApiClient } from "./mockApiClient";

// Swap this for a real FastAPI-backed client later; components never care.
export const api: ApiClient = mockApiClient;

export type { ApiClient, ArchivePage } from "./ApiClient";
export { mockDevTools } from "./mockApiClient";
