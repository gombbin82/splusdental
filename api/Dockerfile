# Build from the repo root (pnpm workspace):  docker build -f api/Dockerfile -t splus-api .
FROM node:22-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY api/package.json api/
COPY site/package.json site/
RUN pnpm install --frozen-lockfile --filter api...
COPY api/ api/
RUN pnpm --filter api build \
  && pnpm --filter api deploy --prod --legacy /out

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# SQL migrations, applied on startup when DATABASE_URL is set.
COPY --from=build /repo/api/drizzle ./drizzle
USER nonroot
EXPOSE 8080
CMD ["dist/server.js"]
