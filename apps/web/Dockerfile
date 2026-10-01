# Build from the application directory: docker build -t planora-web apps/web
FROM oven/bun:1.4.2 AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
# Production always selects the HTTP adapter at compile time. This is deliberately
# not a build argument; container runtime variables cannot change the bundle.
ENV VITE_API_MODE=http
COPY . .
RUN bun run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
