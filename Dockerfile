# ---- Build stage: install everything, build client + server, drop dev deps ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage: only what's needed to run ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "server/dist/server/src/index.js"]
