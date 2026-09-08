FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app

# Only the built app and the server. The server has no dependencies — it is
# Node built-ins — so nothing from node_modules reaches the runtime image.
COPY --from=build /app/dist ./dist
COPY server ./server

# The lockout ledger's directory, made here so it belongs to the user that has
# to write it.
#
# Docker initialises an empty named volume from the image path it is mounted at,
# ownership included. Without this the path does not exist in the image, so the
# volume is created root-owned, the container runs as node, and the ledger falls
# back to memory — which means a restart forgives every lockout, silently apart
# from one line at boot. Exactly the same mistake as the config bind mount, one
# layer along.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3002

HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
