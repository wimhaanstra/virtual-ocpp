# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps ./apps
RUN npm run build
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-bookworm-slim AS runtime

ARG APP_VERSION=unknown
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Virtual OCPP" \
      org.opencontainers.image.description="Self-hosted OCPP 1.6j gateway and proxy for Smart EVSE chargers." \
      org.opencontainers.image.url="https://hub.docker.com/r/wimhaanstra/virtual-ocpp" \
      org.opencontainers.image.source="https://github.com/wimhaanstra/virtual-ocpp" \
      org.opencontainers.image.documentation="https://github.com/wimhaanstra/virtual-ocpp#deployment" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8797 \
    SQLITE_PATH=/data/virtual-ocpp.sqlite \
    WEB_DIST_PATH=/app/apps/web/dist

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist

VOLUME ["/data"]
EXPOSE 8797

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8797) + '/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
