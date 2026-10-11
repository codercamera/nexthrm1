FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock package-lock.json ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
FROM oven/bun:1.4.3
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY package.json ./
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/hrm.sqlite
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "src/server/index.ts"]
