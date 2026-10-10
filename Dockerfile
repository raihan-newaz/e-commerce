FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl webp && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json server/
COPY server/prisma server/prisma/
RUN cd server && npm ci && npx prisma generate
COPY client/package*.json client/
COPY storefront/package*.json storefront/
RUN cd client && npm ci
RUN cd storefront && npm ci
COPY server/src/modules/builder/core/ server/src/modules/builder/core/
COPY client/ client/
RUN cd client && npm run build
COPY storefront/ storefront/
COPY scripts/optimize-images.cjs scripts/optimize-images.cjs
RUN node scripts/optimize-images.cjs storefront/public && cd storefront && npm run build
COPY server/ server/
RUN cd server && npm run build
FROM build AS production-deps
RUN cd server && npm prune --omit=dev
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl webp && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production API_HOST=127.0.0.1 PORT=3010 WEBP_QUALITY=82 WEBP_MAX_DIMENSION=2560
COPY --from=build --chown=node:node /app/server/package*.json server/
COPY --from=production-deps --chown=node:node /app/server/node_modules server/node_modules
COPY --from=build --chown=node:node /app/server/dist server/dist
COPY --from=build --chown=node:node /app/server/prisma server/prisma
COPY --from=build --chown=node:node /app/client/dist client/dist
COPY --from=build --chown=node:node /app/storefront/dist storefront/dist
COPY --from=build --chown=node:node /app/scripts/optimize-images.cjs scripts/optimize-images.cjs
RUN mkdir -p server/uploads/media && chown -R node:node server/uploads
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/server.js"]
