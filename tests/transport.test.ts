import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDb, bootstrap, store, uuid, hash, now } from "../src/server/db";
import { createApp } from "../src/server/app";
test("backup restores migrations, rows and foreign keys", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "hrm-"));
  const source = resolve(directory, "source.sqlite"),
    backup = resolve(directory, "backup.sqlite");
  const db = openDb(source);
  await bootstrap(db, "test@example.test", "Backup-test-password-123");
  db.query("VACUUM INTO ?").run(backup);
  db.close();
  const restored = openDb(backup);
  expect(restored.query("SELECT COUNT(*) n FROM users").get()).toEqual({
    n: 1,
  });
  expect(restored.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(restored.query("PRAGMA integrity_check").get()).toEqual({
    integrity_check: "ok",
  });
  restored.close();
  rmSync(directory, { recursive: true });
});
test("WebSocket and file transport enforce company and session boundaries", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "hrm-files-")),
    db = openDb(":memory:"),
    setup = await bootstrap(
      db,
      "admin@test.example",
      "Transport-test-password-123",
    ),
    s = store(db);
  const runtime = createApp(db, {
    key: "b".repeat(64),
    storageRoot: directory,
  });
  const server = Bun.serve({
      port: 0,
      fetch: runtime.app.fetch,
      websocket: runtime.websocket,
    }),
    origin = String(server.url).replace(/\/$/, "");
  const request = async (
    path: string,
    body?: any,
    cookie = "",
    method = body ? "POST" : "GET",
  ) => {
    return fetch(origin + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
  };
  const workspace = s.one(
    "SELECT code FROM tenants WHERE id=?",
    setup.tenant,
  )!.code;
  const login = await request("/auth/login", {
    workspace,
    email: "admin@test.example",
    password: "Transport-test-password-123",
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const user = uuid(),
    otherOrg = uuid();
  s.insert("organizations", {
    id: otherOrg,
    tenant_id: setup.tenant,
    code: "B",
    legal_name: "B",
    display_name: "B",
  });
  s.insert("users", {
    id: user,
    tenant_id: setup.tenant,
    email: "b@test.example",
    display_name: "B",
  });
  s.insert("user_company_access", {
    id: uuid(),
    user_id: user,
    organization_id: otherOrg,
  });
  const token = uuid();
  s.insert("user_sessions", {
    id: uuid(),
    user_id: user,
    session_token_hash: hash(token),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  const otherCookie = "hrm_session=" + token;
  const person = uuid(),
    employee = uuid();
  s.insert("people", { id: person, tenant_id: setup.tenant });
  s.insert("employees", {
    id: employee,
    person_id: person,
    organization_id: setup.org,
    employee_no: "E1",
    first_name_th: "Test",
    last_name_th: "File",
    hire_date: "2026-01-01",
  });
  const form = new FormData();
  form.set("employee_id", employee);
  form.set(
    "file",
    new File(["%PDF-1.4\nTest content"], "test.pdf", {
      type: "application/pdf",
    }),
  );
  const upload = await fetch(origin + "/api/c/" + setup.org + "/files", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  expect(upload.status).toBe(201);
  const file = (await upload.json()) as any;
  expect(
    (
      await request(
        "/c/" + setup.org + "/files/" + file.id,
        undefined,
        otherCookie,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/c/" + otherOrg + "/files/" + file.id,
        undefined,
        otherCookie,
      )
    ).status,
  ).toBe(403);
  expect(
    (await request("/c/" + setup.org + "/files/" + file.id, undefined, cookie))
      .status,
  ).toBe(200);
  const BunSocket = WebSocket as unknown as {
    new (url: string, options: { headers: Record<string, string> }): WebSocket;
  };
  const ws = new BunSocket(
    origin.replace("http", "ws") + "/api/c/" + setup.org + "/ws",
    { headers: { Cookie: cookie } },
  );
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = rej;
  });
  const messages: string[] = [];
  ws.onmessage = (e) => messages.push(String(e.data));
  runtime.push(setup.tenant, otherOrg, setup.user);
  await new Promise((res) => setTimeout(res, 40));
  expect(messages).toHaveLength(0);
  runtime.push(setup.tenant, setup.org, setup.user);
  await new Promise((res) => setTimeout(res, 40));
  expect(messages).toHaveLength(1);
  s.run(
    "UPDATE user_sessions SET revoked_at=? WHERE user_id=?",
    now(),
    setup.user,
  );
  runtime.push(setup.tenant, setup.org, setup.user);
  await new Promise((res) => setTimeout(res, 40));
  expect(ws.readyState).toBe(WebSocket.CLOSED);
  expect(messages).toHaveLength(1);
  runtime.closeSockets();
  server.stop(true);
  db.close();
  rmSync(directory, { recursive: true });
}, 10000);
