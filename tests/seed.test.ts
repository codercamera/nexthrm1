import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDb, store } from "../src/server/db";
import { createApp } from "../src/server/app";
import { seedDatabase, type SeedSummary } from "../scripts/seed-data";
const db = openDb(":memory:"),
  s = store(db),
  options = { password: "Strong-seed-test-password-123", key: "c".repeat(64) };
let summary: SeedSummary;
beforeAll(async () => {
  summary = await seedDatabase(db, options);
}, 30000);
afterAll(() => db.close());
test("seed provides linked company workflows and reconciled payroll/slips", () => {
  expect(summary.companies).toHaveLength(2);
  expect(summary.employees).toBe(14);
  expect(summary.accounts).toHaveLength(16);
  expect(summary.leaveRequests).toBe(6);
  expect(summary.payrollCycles).toBe(4);
  expect(summary.payslips).toBe(12);
  expect(summary.announcements).toBe(7);
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    s.one(
      "SELECT COUNT(*) n FROM payroll_calculation_runs WHERE blocking_error_count<>0",
    )!.n,
  ).toBe(0);
  expect(
    s.one(
      "SELECT COUNT(*) n FROM payroll_results WHERE gross_income_satang-tax_satang-social_security_satang-pre_tax_deduction_satang-other_deduction_satang<>net_pay_satang",
    )!.n,
  ).toBe(0);
  expect(s.one("SELECT COUNT(DISTINCT status) n FROM leave_requests")!.n).toBe(
    3,
  );
  expect(
    s.one(
      "SELECT COUNT(*) n FROM employee_bank_accounts WHERE account_number_encrypted LIKE ?",
      "%90000000%",
    )!.n,
  ).toBe(0);
  expect(
    s.one("SELECT COUNT(*) n FROM user_sessions WHERE revoked_at IS NULL")!.n,
  ).toBe(0);
});
test("seed rerun does not duplicate or reset existing fixture data", async () => {
  const before = s.one("SELECT COUNT(*) n FROM audit_logs")!.n;
  const again = await seedDatabase(db, options);
  expect(again.reused).toBe(true);
  expect(again.companies).toEqual(summary.companies);
  expect(s.one("SELECT COUNT(*) n FROM employees")!.n).toBe(14);
  expect(s.one("SELECT COUNT(*) n FROM audit_logs")!.n).toBe(before);
  await expect(
    seedDatabase(db, { ...options, password: "Another-seed-password-123" }),
  ).rejects.toThrow("different password");
  await expect(
    seedDatabase(db, { ...options, key: "d".repeat(64) }),
  ).rejects.toThrow();
});
test("seed employee can log in, only see self and cannot switch company", async () => {
  const runtime = createApp(db, { key: options.key });
  try {
    const r = await runtime.app.request(
      "http://localhost:3000/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: "seed",
          email: "employee2@example.test",
          password: options.password,
        }),
      },
    );
    expect(r.status).toBe(200);
    const headers = { Cookie: r.headers.get("set-cookie")!.split(";")[0] };
    const people = await runtime.app.request(
      "http://localhost:3000/api/c/" + summary.companies[0] + "/employees",
      { headers },
    );
    expect(((await people.json()) as any).items).toHaveLength(1);
    const denied = await runtime.app.request(
      "http://localhost:3000/api/c/" + summary.companies[1] + "/employees",
      { headers },
    );
    expect(denied.status).toBe(403);
  } finally {
    runtime.closeSockets();
  }
});
test("seed CLI leaves an existing database untouched and removes failed staging files", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "hrm-seed-")),
    target = resolve(directory, "existing.sqlite");
  try {
    const original = openDb(target);
    original.close();
    const before = readFileSync(target);
    const env = {
      ...process.env,
      NODE_ENV: "test",
      SEED_PASSWORD: options.password,
      ENCRYPTION_KEY: options.key,
      SEED_DB_PATH: target,
    };
    const refused = Bun.spawnSync([process.execPath, "scripts/seed.ts"], {
      env,
    });
    expect(refused.exitCode).not.toBe(0);
    expect(readFileSync(target).equals(before)).toBe(true);
    const fresh = resolve(directory, "failed.sqlite");
    const failed = Bun.spawnSync([process.execPath, "scripts/seed.ts"], {
      env: { ...env, SEED_DB_PATH: fresh, SEED_DATE: "invalid" },
    });
    expect(failed.exitCode).not.toBe(0);
    expect(existsSync(fresh)).toBe(false);
    const prod = Bun.spawnSync([process.execPath, "scripts/seed.ts"], {
      env: {
        ...env,
        NODE_ENV: "production",
        SEED_DB_PATH: resolve(directory, "prod.sqlite"),
      },
    });
    expect(prod.exitCode).not.toBe(0);
    expect(existsSync(resolve(directory, "prod.sqlite"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
