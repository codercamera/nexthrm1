import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, linkSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDb, uuid } from "../src/server/db";
import { seedDatabase } from "./seed-data";
if (process.env.NODE_ENV === "production")
  throw new Error("Test seed is disabled in production");
if (!process.env.SEED_PASSWORD || !process.env.ENCRYPTION_KEY)
  throw new Error("SEED_PASSWORD and ENCRYPTION_KEY are required");
// Separate from DB_PATH so invoking seed never populates the application database by accident.
const target = resolve(process.env.SEED_DB_PATH || "data/seed.sqlite");
mkdirSync(dirname(target), { recursive: true });
const existing = existsSync(target),
  temporary = target + ".seed-" + uuid() + ".sqlite",
  path = existing ? target : temporary;
if (existing) {
  const check = new Database(target, { readonly: true });
  try {
    if (
      !check
        .query(
          "SELECT 1 FROM audit_logs WHERE action='SEED_COMPLETE' AND object_id='nexthrm-test-seed-v1'",
        )
        .get()
    )
      throw new Error(
        "Existing database is not a completed test seed; choose a new SEED_DB_PATH",
      );
  } finally {
    check.close();
  }
}
const db = openDb(path);
try {
  const summary = await seedDatabase(db, {
    password: process.env.SEED_PASSWORD,
    key: process.env.ENCRYPTION_KEY,
    date: process.env.SEED_DATE,
  });
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  if (!existing) {
    linkSync(temporary, target);
    unlinkSync(temporary);
  }
  console.log(JSON.stringify({ ...summary, database: target }, null, 2));
  console.log(
    "Start with DB_PATH=" +
      target +
      " bun start. All accounts use your SEED_PASSWORD.",
  );
} finally {
  try {
    db.close();
  } catch {}
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(temporary + suffix)) unlinkSync(temporary + suffix);
}
