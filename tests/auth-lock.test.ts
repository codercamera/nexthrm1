import { test, expect } from "bun:test";
import { openDb, bootstrap, store } from "../src/server/db";
import { createApp } from "../src/server/app";
test("active lock is stable, expires after its original window, and failures reset", async () => {
  const db = openDb(":memory:"),
    password = "Strong-lock-test-password-123",
    setup = await bootstrap(db, "lock@example.test", password),
    s = store(db),
    runtime = createApp(db, { key: "a".repeat(64) });
  const workspace = s.one(
    "SELECT code FROM tenants WHERE id=?",
    setup.tenant,
  )!.code;
  const login = (value: string) =>
    runtime.app.request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace,
        email: "lock@example.test",
        password: value,
      }),
    });
  try {
    for (let i = 0; i < 5; i++)
      expect((await login("incorrect")).status).toBe(401);
    const locked = s.one(
      "SELECT failed_login_count,locked_until FROM users WHERE id=?",
      setup.user,
    )!;
    expect(locked.failed_login_count).toBe(5);
    expect(Date.parse(locked.locked_until)).toBeGreaterThan(Date.now());
    expect((await login(password)).status).toBe(401);
    expect(
      s.one(
        "SELECT failed_login_count,locked_until FROM users WHERE id=?",
        setup.user,
      ),
    ).toEqual(locked);
    s.update("users", setup.user, {
      locked_until: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await login("incorrect")).status).toBe(401);
    expect(
      s.one(
        "SELECT failed_login_count,locked_until FROM users WHERE id=?",
        setup.user,
      ),
    ).toEqual({ failed_login_count: 1, locked_until: null });
    expect((await login(password)).status).toBe(200);
    expect(
      s.one(
        "SELECT failed_login_count,locked_until FROM users WHERE id=?",
        setup.user,
      ),
    ).toEqual({ failed_login_count: 0, locked_until: null });
  } finally {
    runtime.closeSockets();
    db.close();
  }
});
