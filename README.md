# Planora

Planora is a private, single-user AI task manager: a three-column Kanban
board, a searchable archive, and one AI chat conversation whose every write
you confirm before it happens.

This is a monorepo: the web tier lives in `apps/web`, the API tier in
`apps/api`. Stack, layout and binding rules are documented once, in
[`AGENTS.md`](AGENTS.md) — this file does not repeat them.

## Web tier

From `apps/web`:

```sh
bun install
bun run dev
```

To exercise a production build locally:

```sh
bun run build
node .output/server/index.mjs
```

Ignore Nitro's own `npx vite preview` hint printed after `bun run build` —
it previews the client build only, not the server entry above.

## API tier

See [`apps/api/README.md`](apps/api/README.md) for setup with `uv`,
environment configuration and running the API.

## Project documents

- [Product spec](docs/specs/planora-v1-product-spec.md)
- [Development process](docs/PROCESS.md)
- [Backlog](docs/tasks.md)
- [Architecture decisions](docs/adr/)
