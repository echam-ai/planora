/**
 * True unless the build is `VITE_API_MODE=http`. Pages gate demo-only UI (the
 * Settings "Demo data" section, the login demo credential) on this constant.
 *
 * It compares `import.meta.env.VITE_API_MODE` against a string literal at
 * module level so Vite substitutes the literal, Rollup folds the constant to
 * `false` in an HTTP build, and the gated JSX (including the mock credential)
 * is removed from the bundle rather than merely hidden. It lives apart from
 * `apiMode.ts` because `vite.config.ts` imports that module in Node, where
 * `import.meta.env` is undefined. Do not route it through a function or `isValidApiMode`: an opaque call defeats the folding.
 */
export const DEMO_UI_ENABLED = import.meta.env.VITE_API_MODE !== "http";
