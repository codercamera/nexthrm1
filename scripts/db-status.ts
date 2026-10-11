import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve(process.env.DB_PATH || "data/hrm.sqlite"),
  seed = resolve(process.env.SEED_DB_PATH || "data/seed.sqlite");
console.log("DB_PATH: " + path);
console.log("SEED_DB_PATH: " + seed + " (exists: " + existsSync(seed) + ")");
if (!existsSync(path)) {
  console.log(
    "Application database does not exist. For seeded test accounts run bun run start:seed.",
  );
} else {
  const db = new Database(path, { readonly: true });
  try {
    const initialized = db
      .query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenants'",
      )
      .get();
    if (!initialized) console.log("Database has not been initialized.");
    else {
      console.log(
        "Workspaces:",
        JSON.stringify(
          db.query("SELECT code,name,status FROM tenants").all(),
          null,
          2,
        ),
      );
      console.log(
        "Accounts:",
        JSON.stringify(
          db
            .query(
              "SELECT t.code workspace,u.email,u.status,u.failed_login_count,u.locked_until FROM users u JOIN tenants t ON t.id=u.tenant_id ORDER BY t.code,u.email",
            )
            .all(),
          null,
          2,
        ),
      );
    }
  } finally {
    db.close();
  }
}
