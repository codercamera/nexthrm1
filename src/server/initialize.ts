import type { Database } from "bun:sqlite";
import { bootstrap, store } from "./db";
/** Explicit first-run setup after the volume is mounted. Never resets existing accounts. */
export async function initializeWorkspace(
  db: Database,
  env: Record<string, string | undefined> = process.env,
) {
  const s = store(db);
  if (env.INITIAL_SETUP !== "true" || s.one("SELECT 1 FROM tenants"))
    return null;
  if (!env.SETUP_EMAIL || !env.SETUP_PASSWORD)
    throw new Error(
      "INITIAL_SETUP requires SETUP_EMAIL and SETUP_PASSWORD for an empty database",
    );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SETUP_EMAIL))
    throw new Error("SETUP_EMAIL must be a valid email");
  const setup = await bootstrap(
    db,
    env.SETUP_EMAIL,
    env.SETUP_PASSWORD,
    env.SETUP_WORKSPACE,
    env.SETUP_COMPANY,
  );
  return {
    workspace: s.one("SELECT code FROM tenants WHERE id=?", setup.tenant)!.code,
    email: env.SETUP_EMAIL,
  };
}
