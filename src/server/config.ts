import { dirname, resolve, join, relative, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
type Environment = Record<string, string | undefined>;
export function dataPaths(env: Environment = process.env) {
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH
    ? resolve(env.RAILWAY_VOLUME_MOUNT_PATH)
    : null;
  const database = resolve(env.DB_PATH || join(volume || "data", "hrm.sqlite"));
  return {
    volume,
    database,
    files: resolve(
      env.FILE_STORAGE_PATH || join(volume || dirname(database), "files"),
    ),
    backups: resolve(
      env.BACKUP_DIR || (volume ? join(volume, "backups") : "backups"),
    ),
  };
}
export function runtimeConfig(env: Environment = process.env) {
  const production = env.NODE_ENV === "production",
    paths = dataPaths(env);
  if (!env.ENCRYPTION_KEY || !/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY))
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex key");
  const rawOrigin =
    env.APP_ORIGIN ||
    (env.RAILWAY_PUBLIC_DOMAIN
      ? "https://" + env.RAILWAY_PUBLIC_DOMAIN
      : production
        ? ""
        : "http://localhost:3000");
  if (!rawOrigin)
    throw new Error("Set APP_ORIGIN or configure a Railway public domain");
  const url = new URL(rawOrigin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "APP_ORIGIN must be a single HTTP(S) origin without a path",
    );
  if (production && url.protocol !== "https:")
    throw new Error("Production APP_ORIGIN must use HTTPS");
  const port = Number(env.PORT || 3000);
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    (production && port === 0)
  )
    throw new Error("PORT must be a valid TCP port");
  if (production && env.RAILWAY_ENVIRONMENT_ID) {
    if (!paths.volume || !existsSync(paths.volume))
      throw new Error(
        "Attach a persistent Railway volume before starting this SQLite service",
      );
    for (const path of [paths.database, paths.files, paths.backups]) {
      const rel = relative(paths.volume, path);
      if (
        rel === ".." ||
        rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) ||
        isAbsolute(rel)
      )
        throw new Error(
          "Database, files and backups must be inside the Railway volume",
        );
    }
  }
  return {
    ...paths,
    production,
    port,
    hostname: env.HOST || "0.0.0.0",
    origin: url.origin,
    key: env.ENCRYPTION_KEY,
  };
}
