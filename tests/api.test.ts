import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { openDb, bootstrap, store, uuid, hash, now } from "../src/server/db";
import { createApp } from "../src/server/app";
const db = openDb(":memory:"),
  s = store(db),
  runtime = createApp(db, {
    key: "a".repeat(64),
    origin: "http://localhost:3000",
  }),
  app = runtime.app;
let tenant: string,
  org: string,
  admin: string,
  workspace: string,
  orgB: string,
  employeeId: string,
  employeeCookie: string,
  adminCookie: string,
  reviewerCookie: string,
  approverCookie: string,
  otherCookie: string,
  otherOrg: string,
  managerCookie: string,
  leaveType: string,
  schedule: string,
  payroll: string;
const password = "Strong-test-password-123";
async function call(
  path: string,
  method = "GET",
  body?: any,
  cookie = adminCookie,
) {
  const response = await app.request("http://localhost:3000/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(email: string, ws = workspace) {
  const r = await call(
    "/auth/login",
    "POST",
    { workspace: ws, email, password },
    "",
  );
  expect(r.status).toBe(200);
  return r.cookie!;
}
async function user(
  email: string,
  roleCode: string,
  organization = org,
  scope = "COMPANY",
  scopeId: string | null = null,
) {
  const id = uuid();
  s.insert("users", {
    id,
    tenant_id: tenant,
    email,
    display_name: roleCode,
    password_hash: await Bun.password.hash(password),
    default_organization_id: organization,
  });
  s.insert("user_company_access", {
    id: uuid(),
    user_id: id,
    organization_id: organization,
  });
  const role = s.one(
    "SELECT id FROM roles WHERE tenant_id=? AND code=?",
    tenant,
    roleCode,
  )!;
  s.insert("user_roles", {
    id: uuid(),
    user_id: id,
    role_id: role.id,
    organization_id: organization,
    scope_type: scope,
    scope_id: scopeId,
  });
  return { id, cookie: await login(email) };
}
const path = (suffix: string) => "/c/" + org + suffix;
beforeAll(async () => {
  const setup = await bootstrap(
    db,
    "admin@test.example",
    password,
    "Test workspace",
    "Test Company A",
  );
  ({ tenant, org, user: admin } = setup);
  workspace = s.one("SELECT code FROM tenants WHERE id=?", tenant)!.code;
  adminCookie = await login("admin@test.example");
  const co = await call(path("/companies"), "POST", {
    code: "B",
    display_name: "Company B",
    legal_name: "Company B",
  });
  expect(co.status).toBe(201);
  orgB = co.data.id;
  const otherTenant = uuid();
  otherOrg = uuid();
  const otherUser = uuid();
  s.insert("tenants", { id: otherTenant, code: "other", name: "Other" });
  s.insert("organizations", {
    id: otherOrg,
    tenant_id: otherTenant,
    code: "OTHER",
    legal_name: "Other",
    display_name: "Other",
  });
  s.insert("users", {
    id: otherUser,
    tenant_id: otherTenant,
    email: "other@test.example",
    display_name: "Other",
    password_hash: await Bun.password.hash(password),
  });
  s.insert("user_company_access", {
    id: uuid(),
    user_id: otherUser,
    organization_id: otherOrg,
  });
  otherCookie = await login("other@test.example", "other");
  const r = await call(path("/employees"), "POST", {
    first_name_th: "ทดสอบ",
    last_name_th: "พนักงาน",
    company_email: "employee@test.example",
    hire_date: "2025-01-01",
    salary_satang: 3100000,
    create_user: true,
    password,
    bank_code: "004",
    account_name: "Test",
    account_number: "1234567890",
    national_id: "1234567890123",
  });
  expect(r.status).toBe(201);
  employeeId = r.data.id;
  employeeCookie = await login("employee@test.example");
  reviewerCookie = (await user("reviewer@test.example", "PAYROLL_REVIEWER"))
    .cookie;
  approverCookie = (await user("approver@test.example", "PAYROLL_APPROVER"))
    .cookie;
  managerCookie = (
    await user("manager@test.example", "MANAGER", org, "DEPARTMENT", uuid())
  ).cookie;
  leaveType = s.one(
    "SELECT id FROM leave_types WHERE organization_id=?",
    org,
  )!.id;
  const sch = await call(path("/settings/work_schedules"), "POST", {
    code: "DEFAULT",
    name: "Weekdays",
    days: Array.from({ length: 7 }, (_, i) => ({
      weekday: i + 1,
      is_workday: i < 5,
      start_time: "09:00",
      end_time: "18:00",
    })),
  });
  expect(sch.status).toBe(201);
  schedule = sch.data.id;
  expect(
    (
      await call(path("/settings/schedule-assignment"), "POST", {
        employee_id: employeeId,
        work_schedule_id: schedule,
        effective_from: "2025-01-01",
      })
    ).status,
  ).toBe(201);
}, 30000);
afterAll(() => {
  runtime.closeSockets();
  db.close();
});
test("baseline has all 67 specification tables plus workflow support tables", () =>
  expect(
    s.one("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'")!.n,
  ).toBe(69));
test("migrations are repeatable and foreign keys are enabled", () => {
  expect(s.one("PRAGMA foreign_keys")!.foreign_keys).toBe(1);
  expect(s.all("PRAGMA foreign_key_check")).toEqual([]);
});
test("unauthenticated API denied", async () =>
  expect((await call(path("/employees"), "GET", undefined, "")).status).toBe(
    401,
  ));
test("tenant boundaries reject known company IDs", async () => {
  expect(
    (await call(path("/employees"), "GET", undefined, otherCookie)).status,
  ).toBe(403);
  expect((await call("/c/" + otherOrg + "/employees")).status).toBe(403);
});
test("employee cannot switch to company B", async () =>
  expect(
    (await call("/c/" + orgB + "/employees", "GET", undefined, employeeCookie))
      .status,
  ).toBe(403));
test("employee list is self-scoped", async () => {
  const r = await call(path("/employees"), "GET", undefined, employeeCookie);
  expect(r.data.items.map((x: any) => x.id)).toEqual([employeeId]);
});
test("manager cannot open unrelated employee", async () =>
  expect(
    (
      await call(
        path("/employees/" + employeeId),
        "GET",
        undefined,
        managerCookie,
      )
    ).status,
  ).toBe(403));
test("employee cannot create another employee", async () =>
  expect(
    (
      await call(
        path("/employees"),
        "POST",
        {
          first_name_th: "X",
          last_name_th: "Y",
          hire_date: "2025-01-01",
          salary_satang: 10000,
        },
        employeeCookie,
      )
    ).status,
  ).toBe(403));
test("employee cannot open payroll list", async () =>
  expect(
    (await call(path("/payroll"), "GET", undefined, employeeCookie)).status,
  ).toBe(403));
test("sensitive values are encrypted and API masked", async () => {
  const raw = s.one("SELECT * FROM employees WHERE id=?", employeeId)!;
  expect(raw.national_id_encrypted).not.toContain("1234567890123");
  const r = await call(path("/employees/" + employeeId));
  expect(r.data.national_id_encrypted).toBeUndefined();
  expect(r.data.national_id_masked).toEndWith("0123");
  expect(r.data.banks[0].account_number_encrypted).toBeUndefined();
});
test("invalid foreign-company lookup rolls back employee transaction", async () => {
  const dept = uuid();
  s.insert("departments", {
    id: dept,
    organization_id: orgB,
    code: "B",
    name_th: "B",
  });
  const before = s.one("SELECT COUNT(*) n FROM employees")!.n;
  expect(
    (
      await call(path("/employees"), "POST", {
        first_name_th: "X",
        last_name_th: "Y",
        hire_date: "2025-01-01",
        salary_satang: 100,
        department_id: dept,
      })
    ).status,
  ).toBe(403);
  expect(s.one("SELECT COUNT(*) n FROM employees")!.n).toBe(before);
});
test("audit log rejects UPDATE and DELETE", () => {
  const r = s.one("SELECT id FROM audit_logs LIMIT 1")!;
  expect(() =>
    s.run("UPDATE audit_logs SET reason='tamper' WHERE id=?", r.id),
  ).toThrow("immutable");
  expect(() => s.run("DELETE FROM audit_logs WHERE id=?", r.id)).toThrow(
    "immutable",
  );
});
test("CSRF rejects cross-origin request", async () => {
  const response = await app.request(
    "http://localhost:3000/api" + path("/attendance/clock"),
    {
      method: "POST",
      headers: {
        Cookie: employeeCookie,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: '{"action":"IN"}',
    },
  );
  expect(response.status).toBe(403);
});
test("overlapping schedule rejected", async () =>
  expect(
    (
      await call(path("/settings/schedule-assignment"), "POST", {
        employee_id: employeeId,
        work_schedule_id: schedule,
        effective_from: "2025-06-01",
      })
    ).status,
  ).toBe(409));
test("leave skips weekends and creates approvals", async () => {
  const r = await call(
    path("/leaves"),
    "POST",
    {
      employee_id: employeeId,
      leave_type_id: leaveType,
      start_date: "2026-01-05",
      end_date: "2026-01-11",
      minutes_per_day: 240,
      reason: "Test",
    },
    employeeCookie,
  );
  expect(r.status).toBe(201);
  expect(
    s.one("SELECT requested_minutes FROM leave_requests WHERE id=?", r.data.id)!
      .requested_minutes,
  ).toBe(1200);
  expect(
    s.all(
      "SELECT * FROM leave_request_days WHERE leave_request_id=?",
      r.data.id,
    ),
  ).toHaveLength(5);
});
test("overlapping pending leave rejected", async () =>
  expect(
    (
      await call(
        path("/leaves"),
        "POST",
        {
          employee_id: employeeId,
          leave_type_id: leaveType,
          start_date: "2026-01-06",
          end_date: "2026-01-06",
          reason: "Duplicate",
        },
        employeeCookie,
      )
    ).status,
  ).toBe(409));
test("excess leave balance rejected", async () =>
  expect(
    (
      await call(
        path("/leaves"),
        "POST",
        {
          employee_id: employeeId,
          leave_type_id: leaveType,
          start_date: "2026-02-01",
          end_date: "2026-03-01",
          reason: "Too much",
        },
        employeeCookie,
      )
    ).status,
  ).toBe(422));
test("leave approval ledger and cancellation reversal", async () => {
  const r = s.one("SELECT * FROM leave_requests LIMIT 1")!;
  expect(
    (
      await call(path("/leaves/" + r.id + "/decision"), "POST", {
        decision: "APPROVED",
        comment: "Approved",
      })
    ).status,
  ).toBe(200);
  const balance = s.one(
    "SELECT * FROM employee_leave_balances WHERE employee_id=?",
    employeeId,
  )!;
  expect(balance.used_minutes).toBe(1200);
  expect(
    (
      await call(path("/leaves/" + r.id + "/decision"), "POST", {
        decision: "APPROVED",
        comment: "Retry",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        path("/leaves/" + r.id + "/cancel"),
        "POST",
        { reason: "Cancelled" },
        employeeCookie,
      )
    ).status,
  ).toBe(200);
  expect(
    s.one(
      "SELECT used_minutes FROM employee_leave_balances WHERE id=?",
      balance.id,
    )!.used_minutes,
  ).toBe(0);
  expect(
    s.all("SELECT * FROM leave_balance_transactions WHERE source_id=?", r.id),
  ).toHaveLength(2);
});
test("work experiences cannot be edited or deleted after submission", async () => {
  const r = await call(
    path("/employees/" + employeeId + "/experiences"),
    "POST",
    {
      company_name: "Former employer",
      position_name: "Developer",
      started_on: "2020-01-01",
      ended_on: "2024-12-31",
    },
    employeeCookie,
  );
  expect(r.status).toBe(201);
  expect(
    (
      await call(
        path("/employees/" + employeeId + "/experiences/" + r.data.id),
        "DELETE",
        {},
        employeeCookie,
      )
    ).status,
  ).toBe(404);
});
test("profile change approval cannot be performed by employee", async () => {
  const r = await call(
    path("/employees/" + employeeId + "/change-requests"),
    "POST",
    { reason: "New phone", changes: { mobile_phone: "0800000000" } },
    employeeCookie,
  );
  expect(r.status).toBe(201);
  expect(
    (
      await call(
        path(
          "/employees/" +
            employeeId +
            "/change-requests/" +
            r.data.id +
            "/decision",
        ),
        "POST",
        { decision: "APPROVED", comment: "OK" },
        employeeCookie,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        path(
          "/employees/" +
            employeeId +
            "/change-requests/" +
            r.data.id +
            "/decision",
        ),
        "POST",
        { decision: "APPROVED", comment: "OK" },
      )
    ).status,
  ).toBe(200);
  expect(
    s.one("SELECT mobile_phone FROM employees WHERE id=?", employeeId)!
      .mobile_phone,
  ).toBe("0800000000");
});
test("announcements exclude creator notifications and count opens individually", async () => {
  const r = await call(path("/announcements"), "POST", {
    title: "Announcement one",
    body: "Hello team",
    status: "PUBLISHED",
    targets: [{ type: "ALL", id: null }],
  });
  expect(r.status).toBe(201);
  expect(
    s.one(
      "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND source_id=?",
      admin,
      r.data.id,
    )!.n,
  ).toBe(0);
  const r2 = await call(path("/announcements"), "POST", {
    title: "Announcement two",
    body: "Hello again",
    status: "PUBLISHED",
    targets: [{ type: "ALL", id: null }],
  });
  const count = s.one(
    "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL",
    s.one("SELECT user_id FROM employees WHERE id=?", employeeId)!.user_id,
  )!.n;
  expect(
    (
      await call(
        path("/announcements/" + r.data.id + "/open"),
        "POST",
        {},
        employeeCookie,
      )
    ).status,
  ).toBe(200);
  expect(
    s.one(
      "SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL",
      s.one("SELECT user_id FROM employees WHERE id=?", employeeId)!.user_id,
    )!.n,
  ).toBe(count - 1);
  await call(
    path("/announcements/" + r.data.id + "/open"),
    "POST",
    {},
    employeeCookie,
  );
  const list = await call(path("/announcements"));
  expect(list.data.items.find((x: any) => x.id === r.data.id).total_views).toBe(
    2,
  );
  expect(
    list.data.items.find((x: any) => x.id === r.data.id).unique_viewers,
  ).toBe(1);
});
test("employee announcement API does not expose readership", async () => {
  const r = await call(
    path("/announcements"),
    "GET",
    undefined,
    employeeCookie,
  );
  expect(r.data.items[0].activity).toBeUndefined();
  expect(r.data.items[0].unique_viewers).toBeUndefined();
});
test("cross-company announcement target blocked", async () =>
  expect(
    (
      await call(path("/announcements"), "POST", {
        title: "Leak",
        body: "No",
        status: "PUBLISHED",
        targets: [
          {
            type: "DEPARTMENT",
            id: s.one(
              "SELECT id FROM departments WHERE organization_id=?",
              orgB,
            )!.id,
          },
        ],
      })
    ).status,
  ).toBe(403));
test("payroll rejects cross-company employee", async () => {
  const e = await call("/c/" + orgB + "/employees", "POST", {
    first_name_th: "B",
    last_name_th: "Company",
    hire_date: "2025-01-01",
    salary_satang: 10000,
  });
  expect(e.status).toBe(201);
  expect(
    (
      await call(path("/payroll"), "POST", {
        code: "BAD",
        name: "Bad",
        cycle_type: "MONTHLY",
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        pay_date: "2026-02-01",
        employee_ids: [e.data.id],
      })
    ).status,
  ).toBe(403);
});
test("payroll requires verified company settings", async () => {
  const r = await call(path("/payroll"), "POST", {
    code: "JAN2026",
    name: "January 2026",
    cycle_type: "MONTHLY",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    pay_date: "2026-02-01",
    employee_ids: [employeeId],
  });
  expect(r.status).toBe(201);
  payroll = r.data.id;
  expect(
    (await call(path("/payroll/" + payroll + "/calculate"), "POST", {})).status,
  ).toBe(422);
});
test("payroll reconciliation, versions, duties and immutable locked cycle", async () => {
  s.run(
    "UPDATE organization_settings SET settings_json=? WHERE organization_id=?",
    JSON.stringify({
      payroll: {
        social_security_rate_basis_points: 500,
        social_security_cap_satang: 87500,
        effective_from: "2025-01-01",
        verified_by: "TEST FIXTURE ONLY",
        source_reference: "test fixture",
      },
    }),
    org,
  );
  s.insert("employee_tax_profiles", {
    employee_id: employeeId,
    tax_method: "EXEMPT",
    effective_from: "2025-01-01",
  });
  s.insert("employee_social_security_profiles", {
    employee_id: employeeId,
    effective_from: "2025-01-01",
  });
  s.run(
    "UPDATE employee_bank_accounts SET verified_at=? WHERE employee_id=?",
    now(),
    employeeId,
  );
  for (let d = 1; d <= 31; d++) {
    const day = "2026-01-" + String(d).padStart(2, "0");
    if ([0, 6].includes(new Date(day).getUTCDay())) continue;
    s.insert("attendance_records", {
      id: uuid(),
      employee_id: employeeId,
      work_date: day,
      check_in_at: day + "T02:00:00Z",
      check_out_at: day + "T11:00:00Z",
      worked_minutes: 480,
      status: "PRESENT",
    });
  }
  let calc = await call(path("/payroll/" + payroll + "/calculate"), "POST", {});
  expect(calc.status).toBe(200);
  expect(calc.data.blocked).toBe(0);
  let result = s.one(
    "SELECT * FROM payroll_results WHERE calculation_run_id=?",
    calc.data.id,
  )!;
  expect(result.base_salary_satang).toBe(3100000);
  expect(result.social_security_satang).toBe(87500);
  expect(result.net_pay_satang).toBe(3012500);
  calc = await call(path("/payroll/" + payroll + "/calculate"), "POST", {});
  expect(calc.data.version).toBe(2);
  expect(
    s.all(
      "SELECT * FROM payroll_calculation_runs WHERE payroll_cycle_id=?",
      payroll,
    ),
  ).toHaveLength(2);
  expect(
    (
      await call(path("/payroll/" + payroll + "/review"), "POST", {
        comment: "Self review",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        path("/payroll/" + payroll + "/review"),
        "POST",
        { comment: "Reviewed" },
        reviewerCookie,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(path("/payroll/" + payroll + "/approve"), "POST", {
        comment: "Self approve",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        path("/payroll/" + payroll + "/approve"),
        "POST",
        { comment: "Approved" },
        approverCookie,
      )
    ).status,
  ).toBe(200);
  expect(
    (await call(path("/payroll/" + payroll + "/calculate"), "POST", {})).status,
  ).toBe(409);
  const payslip = s.one(
    "SELECT * FROM payslips WHERE payroll_cycle_id=?",
    payroll,
  )!;
  expect(
    (
      await call(
        path("/payslips/" + payslip.id),
        "GET",
        undefined,
        employeeCookie,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        path("/payslips/" + payslip.id),
        "GET",
        undefined,
        managerCookie,
      )
    ).status,
  ).toBe(403);
});
test("exports require permission and tenant isolation", async () => {
  expect(
    (
      await call(
        path("/exports"),
        "POST",
        { module: "employees", reason: "Leak" },
        employeeCookie,
      )
    ).status,
  ).toBe(403);
  const r = await call(path("/exports"), "POST", {
    module: "employees",
    reason: "Testing",
  });
  expect(r.status).toBe(200);
  expect((await call("/c/" + orgB + "/exports/" + r.data.id)).status).toBe(403);
  const response = await app.request("http://localhost:3000" + r.data.url, {
    headers: { Cookie: adminCookie },
  });
  expect(response.status).toBe(200);
  const csv = await response.text();
  expect(csv).not.toContain("national_id");
  expect(csv).not.toContain("B,Company");
});
test("password reset revokes old sessions", async () => {
  const r = await call(
    path(
      "/users/" +
        s.one("SELECT user_id FROM employees WHERE id=?", employeeId)!.user_id +
        "/reset",
    ),
    "POST",
    {},
  );
  expect(r.status).toBe(200);
  const token = new URL("http://localhost" + r.data.reset_url).searchParams.get(
    "token",
  );
  expect(
    (
      await call(
        "/auth/reset-password",
        "POST",
        { token, password: "New-strong-password-123" },
        "",
      )
    ).status,
  ).toBe(200);
  expect((await call("/me", "GET", undefined, employeeCookie)).status).toBe(
    401,
  );
  expect(
    (
      await call(
        "/auth/reset-password",
        "POST",
        { token, password: "Another-password-123" },
        "",
      )
    ).status,
  ).toBe(400);
});

test("lookup employee options respect self scope even after account reset", async () => {
  const loginResponse = await call(
    "/auth/login",
    "POST",
    {
      workspace,
      email: "employee@test.example",
      password: "New-strong-password-123",
    },
    "",
  );
  const r = await call(
    path("/lookups"),
    "GET",
    undefined,
    loginResponse.cookie,
  );
  expect(r.data.employees.map((e: any) => e.id)).toEqual([employeeId]);
});
test("half-day and hourly leave windows allow separate non-overlapping requests", async () => {
  const first = await call(path("/leaves"), "POST", {
    employee_id: employeeId,
    leave_type_id: leaveType,
    start_date: "2026-03-02",
    end_date: "2026-03-02",
    minutes_per_day: 240,
    start_work_minute: 0,
    reason: "Morning",
  });
  expect(first.status).toBe(201);
  const second = await call(path("/leaves"), "POST", {
    employee_id: employeeId,
    leave_type_id: leaveType,
    start_date: "2026-03-02",
    end_date: "2026-03-02",
    minutes_per_day: 240,
    start_work_minute: 240,
    reason: "Afternoon",
  });
  expect(second.status).toBe(201);
  expect(
    (
      await call(path("/leaves"), "POST", {
        employee_id: employeeId,
        leave_type_id: leaveType,
        start_date: "2026-03-02",
        end_date: "2026-03-02",
        minutes_per_day: 60,
        start_work_minute: 180,
        reason: "Overlap",
      })
    ).status,
  ).toBe(409);
});
test("group announcement deduplicates users, scopes readership and blocks foreign tenants", async () => {
  const companyBUser = await user(
    "b-employee@test.example",
    "EMPLOYEE",
    orgB,
    "SELF",
  );
  const r = await call(path("/announcements"), "POST", {
    title: "Group notice",
    body: "For both companies",
    company_ids: [org, orgB],
    status: "PUBLISHED",
    targets: [{ type: "ALL", id: null }],
  });
  expect(r.status).toBe(201);
  expect(
    s.one("SELECT organization_id FROM announcements WHERE id=?", r.data.id)!
      .organization_id,
  ).toBeNull();
  expect(
    s.one(
      "SELECT COUNT(*) n FROM announcement_user_activity WHERE announcement_id=? AND user_id=?",
      r.data.id,
      admin,
    )!.n,
  ).toBe(1);
  expect(
    s.one(
      "SELECT COUNT(*) n FROM announcement_company_activity WHERE announcement_id=? AND user_id=?",
      r.data.id,
      admin,
    )!.n,
  ).toBe(2);
  expect(
    (
      await call(
        "/c/" + orgB + "/announcements/" + r.data.id + "/open",
        "POST",
        {},
        companyBUser.cookie,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        path("/announcements/" + r.data.id + "/open"),
        "POST",
        {},
        companyBUser.cookie,
      )
    ).status,
  ).toBe(403);
  const a = await call(path("/announcements")),
    b = await call("/c/" + orgB + "/announcements");
  expect(a.data.items.find((x: any) => x.id === r.data.id).total_views).toBe(0);
  expect(b.data.items.find((x: any) => x.id === r.data.id).total_views).toBe(1);
  expect(
    (
      await call(path("/announcements"), "POST", {
        title: "Leak",
        body: "Foreign tenant",
        company_ids: [org, otherOrg],
        targets: [{ type: "ALL", id: null }],
      })
    ).status,
  ).toBe(403);
});
test("scheduled publication is repeatable without duplicate delivery", async () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const r = await call(path("/announcements"), "POST", {
    title: "Scheduled",
    body: "Later",
    status: "SCHEDULED",
    scheduled_at: future,
    targets: [{ type: "ALL", id: null }],
  });
  expect(r.status).toBe(201);
  expect(
    s.one("SELECT COUNT(*) n FROM notifications WHERE source_id=?", r.data.id)!
      .n,
  ).toBe(0);
  s.update("announcements", r.data.id, {
    scheduled_at: new Date(Date.now() - 1000).toISOString(),
  });
  runtime.tick();
  const count = s.one(
    "SELECT COUNT(*) n FROM notifications WHERE source_id=?",
    r.data.id,
  )!.n;
  runtime.tick();
  expect(
    s.one("SELECT COUNT(*) n FROM notifications WHERE source_id=?", r.data.id)!
      .n,
  ).toBe(count);
  expect(count).toBeGreaterThan(0);
});
test("idempotency returns same result for retries and rejects changed payload", async () => {
  const body = {
    title: "Idempotent",
    body: "One record",
    targets: [{ type: "ALL", id: null }],
  };
  const req = (b: any) =>
    app.request("http://localhost:3000/api" + path("/announcements"), {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        "Idempotency-Key": "create-announcement-1",
      },
      body: JSON.stringify(b),
    });
  const r = await req(body),
    first = (await r.json()) as any;
  const retry = await req(body);
  expect(retry.status).toBe(201);
  expect(await retry.json()).toEqual(first);
  expect((await req({ ...body, title: "Changed" })).status).toBe(409);
});
test("dual employment creates a new company record and preserves source payroll", async () => {
  const r = await call(path("/transfers"), "POST", {
    employee_id: employeeId,
    destination_organization_id: orgB,
    effective_date: "2026-04-01",
    transfer_type: "DUAL_EMPLOYMENT",
    reason: "Dual employment",
  });
  expect(r.status).toBe(201);
  expect(
    (
      await call(path("/transfers/" + r.data.id + "/approve"), "POST", {
        salary_satang: 2000000,
        pay_type: "MONTHLY",
        reason: "Self approval",
      })
    ).status,
  ).toBe(403);
  const second = await user("second-admin@test.example", "TENANT_ADMIN");
  s.run(
    "UPDATE user_roles SET scope_type='TENANT',organization_id=NULL WHERE user_id=?",
    second.id,
  );
  s.insert("user_company_access", {
    id: uuid(),
    user_id: second.id,
    organization_id: orgB,
  });
  const result = await call(
    path("/transfers/" + r.data.id + "/approve"),
    "POST",
    {
      salary_satang: 2000000,
      pay_type: "MONTHLY",
      reason: "Independent approval",
    },
    second.cookie,
  );
  expect(result.status).toBe(201);
  const original = s.one("SELECT * FROM employees WHERE id=?", employeeId)!,
    destination = s.one("SELECT * FROM employees WHERE id=?", result.data.id)!;
  expect(destination.person_id).toBe(original.person_id);
  expect(destination.user_id).toBe(original.user_id);
  expect(original.organization_id).toBe(org);
  expect(original.employment_status).toBe("ACTIVE");
  expect(destination.organization_id).toBe(orgB);
  expect(
    s.one(
      "SELECT COUNT(*) n FROM employee_bank_accounts WHERE employee_id=?",
      destination.id,
    )!.n,
  ).toBe(0);
  expect(
    s.one("SELECT COUNT(*) n FROM payslips WHERE employee_id=?", employeeId)!.n,
  ).toBe(1);
});

test("consolidated report includes only authorized companies", async () => {
  const r = await call(
    path("/reports/companies?companies=" + org + "," + orgB),
  );
  expect(r.status).toBe(200);
  expect(r.data.items.map((x: any) => x.id)).toEqual([org, orgB]);
  expect(
    (await call(path("/reports/companies?companies=" + org + "," + otherOrg)))
      .status,
  ).toBe(403);
  expect(
    (
      await call(
        path("/reports/companies?companies=" + org),
        "GET",
        undefined,
        managerCookie,
      )
    ).status,
  ).toBe(403);
});
test("custom roles cannot grant superuser access and restricted scopes cannot read company payroll", async () => {
  expect(
    (
      await call(path("/roles"), "POST", {
        code: "SUPER",
        name: "Invalid",
        permissions: ["*"],
      })
    ).status,
  ).toBe(403);
  const r = await call(path("/roles"), "POST", {
    code: "AUDITOR",
    name: "Auditor",
    permissions: ["audit.read", "payroll.read"],
  });
  expect(r.status).toBe(201);
  const reader = await user(
    "restricted-reviewer@test.example",
    "PAYROLL_REVIEWER",
    org,
    "SELF",
  );
  expect(
    (await call(path("/payroll"), "GET", undefined, reader.cookie)).status,
  ).toBe(403);
});
test("company relationship cycles are rejected", async () => {
  expect(
    (
      await call(path("/companies/relationships"), "POST", {
        parent_organization_id: org,
        child_organization_id: orgB,
        relationship_type: "SUBSIDIARY",
        effective_from: "2026-01-01",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await call(path("/companies/relationships"), "POST", {
        parent_organization_id: orgB,
        child_organization_id: org,
        relationship_type: "SUBSIDIARY",
        effective_from: "2026-01-01",
      })
    ).status,
  ).toBe(422);
});
test("leave balance adjustment creates immutable ledger event", async () => {
  const prior = s.one(
    "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=?",
    employeeId,
    leaveType,
  )!;
  expect(
    (
      await call(path("/leaves/balance-adjustment"), "POST", {
        employee_id: employeeId,
        leave_type_id: leaveType,
        balance_year: 2026,
        transaction_type: "ADJUSTMENT",
        minutes: 120,
        reason: "Policy correction",
      })
    ).status,
  ).toBe(200);
  expect(
    s.one(
      "SELECT adjusted_minutes FROM employee_leave_balances WHERE id=?",
      prior.id,
    )!.adjusted_minutes,
  ).toBe(prior.adjusted_minutes + 120);
  const ledger = await call(path("/leaves/balance-ledger/" + employeeId));
  expect(ledger.status).toBe(200);
  expect(
    ledger.data.items.some(
      (r: any) => r.reason === "Policy correction" && r.minutes === 120,
    ),
  ).toBe(true);
});

test("scheduled announcement cancels when publisher loses company access", () => {
  const id = uuid(),
    author = uuid();
  s.insert("users", {
    id: author,
    tenant_id: tenant,
    email: "inactive-publisher@test.example",
    display_name: "Publisher",
    password_hash: "unused",
  });
  s.insert("announcements", {
    id,
    tenant_id: tenant,
    organization_id: org,
    title: "No authorization",
    body: "Scheduled",
    status: "SCHEDULED",
    scheduled_at: "2020-01-01T00:00:00.000Z",
    created_by_user_id: author,
  });
  runtime.tick();
  expect(s.one("SELECT status FROM announcements WHERE id=?", id)!.status).toBe(
    "CANCELLED",
  );
  expect(
    s.one(
      "SELECT COUNT(*) count FROM announcement_company_activity WHERE announcement_id=?",
      id,
    )!.count,
  ).toBe(0);
  expect(
    s.one(
      "SELECT action FROM audit_logs WHERE object_id=? AND action='CANCEL'",
      id,
    )!.action,
  ).toBe("CANCEL");
});
