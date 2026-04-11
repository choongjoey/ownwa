FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/server apps/server
RUN npm run build --workspace @ownwa/server

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY apps/server/package.json ./apps/server/package.json
EXPOSE 4000
CMD ["node", "apps/server/dist/index.js"]
