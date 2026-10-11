import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
if (process.env.NODE_ENV === "production")
  throw new Error("Test seed startup is disabled in production");
const path = resolve(process.env.SEED_DB_PATH || "data/seed.sqlite");
if (!existsSync(path))
  throw new Error("Seed database not found. Run bun run db:seed first.");
const db = new Database(path, { readonly: true });
try {
  if (
    !db
      .query(
        "SELECT 1 FROM audit_logs WHERE action='SEED_COMPLETE' AND object_id='nexthrm-test-seed-v1'",
      )
      .get()
  )
    throw new Error("Database is not a completed test seed");
} finally {
  db.close();
}
process.env.DB_PATH = path;
console.log("Using test seed database: " + path + "; workspace=seed");
await import("../src/server/index");
