import { dataPaths } from "../src/server/config";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const source = process.argv[2],
  target = dataPaths().database;
if (!source) throw new Error("Usage: bun scripts/restore.ts <backup.sqlite>");
if (
  existsSync(target) ||
  existsSync(target + "-wal") ||
  existsSync(target + "-shm")
)
  throw new Error("Restore only into a new path with the server stopped");
const db = new Database(source, { readonly: true });
if (
  (db.query("PRAGMA integrity_check").get() as any).integrity_check !== "ok" ||
  db.query("PRAGMA foreign_key_check").all().length
)
  throw new Error("Backup failed integrity checks");
db.close();
mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve(source), resolve(target));
console.log("Restored " + target);
