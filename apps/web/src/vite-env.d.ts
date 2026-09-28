/// <reference types="vite/client" />

// Declaring this as a named property (rather than relying on vite/client's
// index-signature fallback) keeps `import.meta.env.VITE_API_MODE` as plain
// dot-notation property access in `services/api/index.ts` — which is what
// lets Vite statically replace it at build time and dead-code-eliminate the
// unused ApiClient branch (issue #35, spec criterion 16's "no mock code in
// an http build").
interface ImportMetaEnv {
  readonly VITE_API_MODE?: string;
}
