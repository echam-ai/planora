/**
 * Shared TanStack Query key factory. Feature `hooks.ts` modules own their
 * query/mutation logic; this module exists only so the key values stay
 * identical across features without duplicating them.
 */
export const qk = {
  session: ["session"] as const,
  settings: ["settings"] as const,
  tasks: ["tasks"] as const,
  archive: (search: string, page: number) => ["archive", search, page] as const,
  archivedTask: (id: string) => ["archive", "task", id] as const,
  conversation: ["conversation"] as const,
};
