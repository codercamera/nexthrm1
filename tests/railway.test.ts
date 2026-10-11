import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { runtimeConfig, dataPaths } from "../src/server/config";
import { initializeWorkspace } from "../src/server/initialize";
import { openDb, store } from "../src/server/db";
const key = "e".repeat(64);
test("Railway config selects mounted persistent paths, public HTTPS origin and assigned port", () => {
  const volume = mkdtempSync(resolve(tmpdir(), "hrm-volume-"));
  try {
    const config = runtimeConfig({
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_ID: "test",
      RAILWAY_VOLUME_MOUNT_PATH: volume,
      RAILWAY_PUBLIC_DOMAIN: "hrm.example.test",
      ENCRYPTION_KEY: key,
      PORT: "8080",
    });
    expect(config.database).toBe(resolve(volume, "hrm.sqlite"));
    expect(config.files).toBe(resolve(volume, "files"));
    expect(config.backups).toBe(resolve(volume, "backups"));
    expect(config.origin).toBe("https://hrm.example.test");
    expect(config.port).toBe(8080);
    expect(config.hostname).toBe("0.0.0.0");
    expect(() =>
      runtimeConfig({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_ID: "test",
        ENCRYPTION_KEY: key,
        APP_ORIGIN: "https://hrm.example.test",
      }),
    ).toThrow("persistent Railway volume");
    expect(() =>
      runtimeConfig({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_ID: "test",
        RAILWAY_VOLUME_MOUNT_PATH: volume,
        DB_PATH: resolve(volume, "..", "ephemeral.sqlite"),
        ENCRYPTION_KEY: key,
        APP_ORIGIN: "https://hrm.example.test",
      }),
    ).toThrow("inside the Railway volume");
    expect(() =>
      runtimeConfig({
        NODE_ENV: "production",
        ENCRYPTION_KEY: key,
        APP_ORIGIN: "http://example.test",
      }),
    ).toThrow("HTTPS");
  } finally {
    rmSync(volume, { recursive: true });
  }
});
test("explicit startup setup creates once and preserves credentials across redeploy", async () => {
  const db = openDb(":memory:"),
    s = store(db);
  try {
    expect(await initializeWorkspace(db, {})).toBeNull();
    await expect(
      initializeWorkspace(db, { INITIAL_SETUP: "true" }),
    ).rejects.toThrow("SETUP_EMAIL");
    const result = await initializeWorkspace(db, {
      INITIAL_SETUP: "true",
      SETUP_EMAIL: "admin@example.test",
      SETUP_PASSWORD: "Strong-first-run-password-123",
    });
    expect(result?.workspace).toBeTruthy();
    const hash = s.one("SELECT password_hash FROM users")!.password_hash;
    expect(
      await initializeWorkspace(db, {
        INITIAL_SETUP: "true",
        SETUP_EMAIL: "different@example.test",
        SETUP_PASSWORD: "Different-first-run-password-123",
      }),
    ).toBeNull();
    expect(s.one("SELECT COUNT(*) n FROM users")!.n).toBe(1);
    expect(s.one("SELECT password_hash FROM users")!.password_hash).toBe(hash);
  } finally {
    db.close();
  }
});
test("production Railway startup survives restart with persistent SQLite and protected files", async () => {
  const volume = mkdtempSync(resolve(tmpdir(), "hrm-runtime-")),
    password = "Strong-railway-test-password-123";
  const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") }),
    port = probe.port;
  await probe.stop(true);
  const origin = "https://hrm.example.test",
    address = "http://127.0.0.1:" + port;
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_ID: "test",
    RAILWAY_VOLUME_MOUNT_PATH: volume,
    RAILWAY_PUBLIC_DOMAIN: "hrm.example.test",
    ENCRYPTION_KEY: key,
    PORT: String(port),
    INITIAL_SETUP: "true",
    SETUP_EMAIL: "admin@example.test",
    SETUP_PASSWORD: password,
  };
  delete env.DB_PATH;
  delete env.APP_ORIGIN;
  delete env.FILE_STORAGE_PATH;
  delete env.BACKUP_DIR;
  let child: ReturnType<typeof Bun.spawn> | null = null;
  async function start() {
    child = Bun.spawn([process.execPath, "src/server/index.ts"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null)
        throw Error(
          "Server exited: " +
            (await new Response(child.stderr as ReadableStream).text()),
        );
      try {
        if ((await fetch(address + "/api/health")).ok) return;
      } catch {}
      await Bun.sleep(50);
    }
    throw Error("Server startup timeout");
  }
  async function stop() {
    if (child) {
      child.kill("SIGTERM");
      await child.exited;
      child = null;
    }
  }
  async function login(workspace: string) {
    const r = await fetch(address + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        workspace,
        email: "admin@example.test",
        password,
      }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("Secure");
    return r.headers.get("set-cookie")!.split(";")[0];
  }
  try {
    await start();
    const read = new Database(resolve(volume, "hrm.sqlite"), {
      readonly: true,
    });
    const workspace = (read.query("SELECT code FROM tenants").get() as any)
        .code,
      company = (read.query("SELECT id FROM organizations").get() as any).id;
    read.close();
    const cookie = await login(workspace);
    const e = await fetch(address + "/api/c/" + company + "/employees", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Cookie: cookie,
      },
      body: JSON.stringify({
        first_name_th: "ทดสอบ",
        last_name_th: "Railway",
        hire_date: "2026-01-01",
        salary_satang: 3000000,
      }),
    });
    expect(e.status).toBe(201);
    const employee = ((await e.json()) as any).id;
    const form = new FormData();
    form.set("employee_id", employee);
    form.set(
      "file",
      new File(["%PDF-1.4\nPersistent test"], "railway-test.pdf", {
        type: "application/pdf",
      }),
    );
    const uploaded = await fetch(address + "/api/c/" + company + "/files", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const file = ((await uploaded.json()) as any).id;
    expect(existsSync(resolve(volume, "files"))).toBe(true);
    await stop();
    env.SETUP_PASSWORD = "Changed-env-password-123";
    await start();
    const secondCookie = await login(workspace);
    const people = await fetch(address + "/api/c/" + company + "/employees", {
      headers: { Cookie: secondCookie },
    });
    expect(((await people.json()) as any).items).toHaveLength(1);
    const download = await fetch(
      address + "/api/c/" + company + "/files/" + file,
      { headers: { Cookie: secondCookie } },
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("Persistent test");
    const csrf = await fetch(address + "/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://foreign.example", Cookie: secondCookie },
    });
    expect(csrf.status).toBe(403);
  } finally {
    await stop();
    rmSync(volume, { recursive: true });
  }
}, 20000);
