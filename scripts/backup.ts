import { dataPaths } from "../src/server/config";
import { openDb } from "../src/server/db";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const db = openDb(),
  directory = dataPaths().backups;
mkdirSync(directory, { recursive: true });
const path = resolve(
  directory,
  "hrm-" + new Date().toISOString().replaceAll(":", "-") + ".sqlite",
);
db.query("VACUUM INTO ?").run(path);
console.log(path);
db.close();
