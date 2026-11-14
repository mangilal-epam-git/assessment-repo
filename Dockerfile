# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the best-offers service.
# The runtime image carries no package manager state, no build tooling and no
# shell-accessible secrets, and runs as an unprivileged user.

FROM node:22.12.0-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- dependencies -----------------------------------------------------------
# The service is deliberately dependency-free (see ADR-0003), so this stage
# exists to keep the layer cache stable if that ever changes.
FROM base AS deps
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- test -------------------------------------------------------------------
FROM base AS test
ENV NODE_ENV=development
COPY package.json ./
COPY src ./src
COPY test ./test
COPY config ./config
COPY fixtures ./fixtures
COPY scripts ./scripts
RUN npm test

# ---- runtime ----------------------------------------------------------------
FROM node:22.12.0-alpine AS runtime
WORKDIR /app

# Built-in 'node' user (uid 1000); never run as root.
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    PRICING_CONFIG_PATH=/app/config/pricing-config.json

RUN apk add --no-cache tini=~0.19 && \
    mkdir -p /app && chown -R node:node /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node config ./config
COPY --chown=node:node fixtures ./fixtures

USER node
EXPOSE 8080

# tini reaps zombies and forwards SIGTERM, so graceful shutdown actually works.
ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/best-offers/server.js"]
