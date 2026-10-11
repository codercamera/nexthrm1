import { test, expect } from "bun:test";
import { openDb, bootstrap, store, uuid } from "../src/server/db";
import { accrueLeave } from "../src/server/leave-jobs";
async function fixture(method: string, entitlement: number, minimum = 0) {
  const db = openDb(":memory:"),
    s = store(db),
    { tenant, org } = await bootstrap(
      db,
      "accrual@example.test",
      "Strong-accrual-password-123",
      "Accrual",
      "Company",
    );
  const person = uuid(),
    employee = uuid();
  s.insert("people", {
    id: person,
    tenant_id: tenant,
  });
  s.insert("employees", {
    id: employee,
    organization_id: org,
    person_id: person,
    employee_no: "EMP1",
    first_name_th: "ทดสอบ",
    last_name_th: "วันลา",
    hire_date: "2026-01-01",
  });
  const policy = s.one(
    "SELECT * FROM leave_policies WHERE organization_id=?",
    org,
  )!;
  s.update("leave_policies", policy.id, {
    accrual_method: method,
    annual_entitlement_minutes: entitlement,
    minimum_service_days: minimum,
    carry_forward_limit_minutes: 100,
  });
  return { db, s, employee, policy };
}
test("monthly accrual catches up once, reruns safely and caps year carry-forward", async () => {
  const { db, s, employee } = await fixture("MONTHLY", 1200);
  accrueLeave(db, "2026-03-15");
  expect(
    s.one(
      "SELECT accrued_minutes FROM employee_leave_balances WHERE employee_id=? AND balance_year=2026",
      employee,
    )!.accrued_minutes,
  ).toBe(300);
  expect(accrueLeave(db, "2026-03-15").credits).toBe(0);
  accrueLeave(db, "2027-01-01");
  const old = s.one(
    "SELECT * FROM employee_leave_balances WHERE employee_id=? AND balance_year=2026",
    employee,
  )!;
  const next = s.one(
    "SELECT * FROM employee_leave_balances WHERE employee_id=? AND balance_year=2027",
    employee,
  )!;
  expect(old.adjusted_minutes).toBe(-300);
  expect(next.carried_forward_minutes).toBe(100);
  expect(next.accrued_minutes).toBe(100);
  expect(accrueLeave(db, "2027-01-01").credits).toBe(0);
  db.close();
});
test("daily accrual honors minimum service and annual credit is idempotent", async () => {
  const { db, s, employee, policy } = await fixture("DAILY", 365, 10);
  accrueLeave(db, "2026-01-15");
  expect(
    s.one(
      "SELECT accrued_minutes FROM employee_leave_balances WHERE employee_id=?",
      employee,
    )!.accrued_minutes,
  ).toBe(5);
  expect(accrueLeave(db, "2026-01-15").credits).toBe(0);
  s.update("leave_policies", policy.id, { accrual_method: "ANNUAL" });
  accrueLeave(db, "2027-02-01");
  expect(
    s.one(
      "SELECT accrued_minutes FROM employee_leave_balances WHERE employee_id=? AND balance_year=2027",
      employee,
    )!.accrued_minutes,
  ).toBe(365);
  expect(accrueLeave(db, "2027-02-01").credits).toBe(0);
  db.close();
});
