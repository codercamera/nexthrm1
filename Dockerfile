FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock package-lock.json ./
RUN bun install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN bun run build

FROM oven/bun:1.4.3 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM oven/bun:1.4.3
# Railway volumes are owned by root.
USER root
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY migrations ./migrations
COPY scripts ./scripts
COPY package.json ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["bun", "src/server/index.ts"]
