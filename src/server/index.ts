import { openDb } from "./db";
import { createApp } from "./app";
import { accrueLeave } from "./leave-jobs";
import { runtimeConfig } from "./config";
import { initializeWorkspace } from "./initialize";
const config = runtimeConfig(),
  db = openDb(config.database);
const initial = await initializeWorkspace(db);
if (initial)
  console.log(
    "Initial workspace ready: code=" +
      initial.workspace +
      ", admin=" +
      initial.email +
      ". Remove INITIAL_SETUP and SETUP_PASSWORD after first setup.",
  );
const runtime = createApp(db, {
  key: config.key,
  origin: config.origin,
  production: config.production,
  staticRoot: "dist",
  storageRoot: config.files,
});
// Volumes are available now; migrations and jobs complete before healthchecks can pass.
runtime.tick();
accrueLeave(db);
const server = Bun.serve({
  hostname: config.hostname,
  port: config.port,
  fetch: runtime.app.fetch,
  websocket: runtime.websocket,
});
const accrualTimer = setInterval(() => accrueLeave(db), 3600000),
  timer = setInterval(runtime.tick, 1000);
console.log(
  "HRM running at " + server.url + "; public origin=" + config.origin,
);
console.log("SQLite database: " + config.database + "; files: " + config.files);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearInterval(accrualTimer);
  runtime.closeSockets();
  await server.stop(false);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
