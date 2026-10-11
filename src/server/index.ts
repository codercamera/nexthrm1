import { openDb } from "./db";
import { createApp } from "./app";
import { accrueLeave } from "./leave-jobs";
if (!process.env.ENCRYPTION_KEY)
  throw new Error("Set ENCRYPTION_KEY before starting the server");
if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN)
  throw new Error("APP_ORIGIN is required in production");
const db = openDb(),
  runtime = createApp(db, {
    key: process.env.ENCRYPTION_KEY,
    origin: process.env.APP_ORIGIN,
    production: process.env.NODE_ENV === "production",
    staticRoot: "dist",
  });
const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  fetch: runtime.app.fetch,
  websocket: runtime.websocket,
});
runtime.tick();
accrueLeave(db);
const accrualTimer = setInterval(() => accrueLeave(db), 3600000);
const timer = setInterval(runtime.tick, 1000);
console.log("HRM running at " + server.url);
process.on("SIGTERM", () => {
  clearInterval(timer);
  clearInterval(accrualTimer);
  runtime.closeSockets();
  server.stop();
  db.close();
});
