# Build context is the repo root (see docker-compose.yml) so db/migrations can be copied in.
FROM node:22-alpine AS build
WORKDIR /app
COPY services/api/package*.json ./
RUN npm ci
COPY services/api/tsconfig.json ./
COPY services/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/db/migrations
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY services/api/package.json ./
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
