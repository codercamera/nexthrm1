import type { Database } from "bun:sqlite";
import { bootstrap, store, uuid, now, today, type Row } from "../src/server/db";
import { createApp } from "../src/server/app";
import { encryption } from "../src/server/core";

export type SeedOptions = { password: string; key: string; date?: string };
export type SeedSummary = {
  workspace: string;
  date: string;
  companies: string[];
  accounts: { email: string; role: string }[];
  employees: number;
  attendance: number;
  leaveRequests: number;
  payrollCycles: number;
  payslips: number;
  announcements: number;
  reused: boolean;
};
const marker = "nexthrm-test-seed-v1";
const shift = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const weekday = (date: string) =>
  ![0, 6].includes(new Date(date + "T00:00:00Z").getUTCDay());
const workDate = (date: string) => {
  while (!weekday(date)) date = shift(date, 1);
  return date;
};

/** Synthetic fixtures only. Uses application workflows for financial/approval records. */
export async function seedDatabase(
  db: Database,
  options: SeedOptions,
): Promise<SeedSummary> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Test seed is disabled in production");
  if (options.password.length < 12)
    throw new Error("SEED_PASSWORD must have at least 12 characters");
  const crypt = encryption(options.key),
    s = store(db);
  const complete = s.one(
    "SELECT after_json FROM audit_logs WHERE action='SEED_COMPLETE' AND object_id=?",
    marker,
  );
  if (complete) {
    const summary = JSON.parse(complete.after_json) as SeedSummary;
    const admin = s.one(
      "SELECT password_hash FROM users WHERE email='admin@example.test'",
    )!;
    if (!(await Bun.password.verify(options.password, admin.password_hash)))
      throw new Error(
        "Existing seed uses a different password; choose a new SEED_DB_PATH",
      );
    crypt.decrypt(
      s.one(
        "SELECT account_number_encrypted FROM employee_bank_accounts LIMIT 1",
      )!.account_number_encrypted,
    );
    return { ...summary, reused: true };
  }
  if (s.one("SELECT 1 FROM tenants"))
    throw new Error(
      "Seed requires an empty database or a completed seed database; existing data is never replaced",
    );
  const date = options.date || today();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
  )
    throw new Error("Invalid SEED_DATE");
  const currentStart = date.slice(0, 7) + "-01",
    periodEnd = shift(currentStart, -1),
    periodStart = periodEnd.slice(0, 7) + "-01",
    hireDate = Number(date.slice(0, 4)) - 1 + "-01-01";
  const setup = await bootstrap(
    db,
    "admin@example.test",
    options.password,
    "HRM Test Workspace",
    "บริษัท เน็กซ์ เทคโนโลยี (ทดสอบ) จำกัด",
  );
  s.run("UPDATE tenants SET code='seed' WHERE id=?", setup.tenant);
  const runtime = createApp(db, {
      key: options.key,
      origin: "http://localhost:3000",
    }),
    cookies = new Map<string, string>();
  const accounts: SeedSummary["accounts"] = [
    { email: "admin@example.test", role: "TENANT_ADMIN" },
  ];
  async function login(email: string) {
    const response = await runtime.app.request(
      "http://localhost:3000/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: "seed",
          email,
          password: options.password,
        }),
      },
    );
    if (!response.ok) throw new Error("Seed login failed for " + email);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    cookies.set(email, cookie);
    return cookie;
  }
  async function api(
    path: string,
    body?: Row,
    actor = "admin@example.test",
    method = "POST",
  ): Promise<Row> {
    const cookie = cookies.get(actor) || (await login(actor));
    const response = await runtime.app.request(
      "http://localhost:3000/api" + path,
      {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const value = (await response.json()) as Row;
    if (!response.ok)
      throw new Error("Seed " + path + ": " + JSON.stringify(value));
    return value;
  }
  async function roleAccount(email: string, role: string, company: string) {
    let user = s.one(
      "SELECT id FROM users WHERE tenant_id=? AND email=?",
      setup.tenant,
      email,
    );
    if (!user) {
      user = s.insert("users", {
        id: uuid(),
        tenant_id: setup.tenant,
        email,
        display_name: role + " (ทดสอบ)",
        password_hash: await Bun.password.hash(options.password, {
          algorithm: "argon2id",
        }),
        default_organization_id: company,
      });
      accounts.push({ email, role });
    }
    s.insert("user_company_access", {
      id: uuid(),
      user_id: user.id,
      organization_id: company,
      granted_by_user_id: setup.user,
    });
    s.insert("user_roles", {
      id: uuid(),
      user_id: user.id,
      role_id: s.one(
        "SELECT id FROM roles WHERE tenant_id=? AND code=?",
        setup.tenant,
        role,
      )!.id,
      organization_id: company,
      scope_type: "COMPANY",
      assigned_by_user_id: setup.user,
    });
    return user.id;
  }
  try {
    const second = await api("/c/" + setup.org + "/companies", {
        code: "SERVICES",
        display_name: "บริษัท เน็กซ์ เซอร์วิส (ทดสอบ) จำกัด",
        legal_name: "บริษัท เน็กซ์ เซอร์วิส (ทดสอบ) จำกัด",
      }),
      companies = [setup.org, second.id as string];
    s.insert("organization_relationships", {
      id: uuid(),
      tenant_id: setup.tenant,
      parent_organization_id: setup.org,
      child_organization_id: second.id,
      relationship_type: "SUBSIDIARY",
      effective_from: hireDate,
    });
    const names = [
      ["กมลวรรณ", "ศรีประเสริฐ"],
      ["ณัฐพงศ์", "ไทยเจริญ"],
      ["ศิรินทร์", "กลมชาติ"],
      ["อัญชิสา", "พัฒนกุล"],
      ["วรพล", "เมฆวิริยะ"],
      ["พิมพ์ชนก", "แสงทอง"],
    ];
    for (const [companyIndex, company] of companies.entries()) {
      const base = "/c/" + company;
      await roleAccount("hr@example.test", "HR", company);
      await roleAccount("reviewer@example.test", "PAYROLL_REVIEWER", company);
      await roleAccount("approver@example.test", "PAYROLL_APPROVER", company);
      const branch = await api(base + "/settings/branches", {
        code: "BKK",
        name_th: "สำนักงานใหญ่ (ทดสอบ)",
        name_en: "Bangkok Test Office",
      });
      const tech = await api(base + "/settings/departments", {
          code: "TECH",
          name_th: "เทคโนโลยี",
          name_en: "Technology",
        }),
        sales = await api(base + "/settings/departments", {
          code: "SALES",
          name_th: "ฝ่ายขาย",
          name_en: "Sales",
        });
      const position = await api(base + "/settings/positions", {
        code: "STAFF",
        name_th: "เจ้าหน้าที่",
        name_en: "Staff",
      });
      const level = await api(base + "/settings/job_levels", {
        code: "L1",
        name: "เจ้าหน้าที่ระดับ 1",
        rank_order: 1,
      });
      const schedule = await api(base + "/settings/work_schedules", {
        code: "WEEKDAYS",
        name: "จันทร์–ศุกร์ 09:00–18:00",
        days: Array.from({ length: 7 }, (_, i) => ({
          weekday: i + 1,
          is_workday: i < 5,
          start_time: "09:00",
          end_time: "18:00",
        })),
      });
      s.insert("holidays", {
        id: uuid(),
        organization_id: company,
        holiday_date: workDate(shift(date, 30)),
        name_th: "วันหยุดบริษัท (สมมติ)",
        name_en: "Synthetic company holiday",
      });
      if (companyIndex === 1)
        await api(base + "/settings/leave_types", {
          code: "ANNUAL",
          name_th: "ลาพักร้อน",
          name_en: "Annual leave",
          annual_entitlement_minutes: 4800,
        });
      await api(base + "/settings/leave_types", {
        code: "PERSONAL",
        name_th: "ลากิจ",
        name_en: "Personal leave",
        annual_entitlement_minutes: 1440,
      });
      await api(base + "/settings/leave_types", {
        code: "UNPAID",
        name_th: "ลาไม่รับค่าจ้าง",
        name_en: "Unpaid leave",
        is_paid: false,
        annual_entitlement_minutes: 2400,
      });
      s.run(
        "UPDATE leave_policies SET effective_from=? WHERE organization_id=?",
        hireDate,
        company,
      );
      // Test fixtures, deliberately not represented as current statutory rates.
      await api(
        base + "/settings/company",
        {
          display_name: s.one(
            "SELECT display_name FROM organizations WHERE id=?",
            company,
          )!.display_name,
          legal_name: s.one(
            "SELECT legal_name FROM organizations WHERE id=?",
            company,
          )!.legal_name,
          status: "ACTIVE",
          reason: "Synthetic test payroll settings",
          payroll: {
            social_security_rate_basis_points: 500,
            social_security_cap_satang: 75000,
            effective_from: hireDate,
            source_reference: "TEST FIXTURE ONLY — not statutory guidance",
            verified_by: "seed fixture",
          },
        },
        "admin@example.test",
        "PUT",
      );
      const employees: Row[] = [];
      for (const [i, [first, last]] of names.entries()) {
        const email = `employee${companyIndex * 6 + i + 1}@example.test`,
          payType = i === 4 ? "DAILY" : i === 5 ? "HOURLY" : "MONTHLY",
          wage = i === 4 ? 700 : i === 5 ? 120 : 30000 + i * 5000;
        const e = await api(base + "/employees", {
          first_name_th: first,
          last_name_th: last,
          first_name_en: [
            "Kamolwan",
            "Nattapong",
            "Sirin",
            "Anchisa",
            "Worapon",
            "Pimchanok",
          ][i],
          last_name_en: "Test",
          nickname: first.slice(0, 3),
          company_email: email,
          personal_email: `personal${companyIndex * 6 + i + 1}@example.test`,
          mobile_phone: `08000000${companyIndex}${i}`,
          hire_date: hireDate,
          salary_satang: wage * 100,
          pay_type: payType,
          employment_type:
            i === 4 ? "DAILY" : i === 5 ? "PART_TIME" : "FULL_TIME",
          branch_id: branch.id,
          department_id: i < 3 ? tech.id : sales.id,
          position_id: position.id,
          job_level_id: level.id,
          manager_employee_id: i > 0 && i < 3 ? employees[0].id : null,
          create_user: true,
          password: options.password,
          bank_code: "004",
          account_name: first + " " + last,
          account_number: `90000000${companyIndex}${i}`,
          national_id: `90000000000${companyIndex}${i}`,
          address: `${i + 1}/99 ถนนข้อมูลทดสอบ กรุงเทพมหานคร`,
          emergency_name: "ผู้ติดต่อทดสอบ",
          emergency_relationship: "ญาติ",
          emergency_phone: "0890000000",
          regular_allowances:
            payType === "MONTHLY"
              ? [{ name: "ค่าเดินทาง (ทดสอบ)", amount_satang: 100000 }]
              : [],
        });
        employees.push(e);
        accounts.push({
          email,
          role: i === 0 ? "MANAGER + EMPLOYEE" : "EMPLOYEE",
        });
        await api(base + "/settings/schedule-assignment", {
          employee_id: e.id,
          work_schedule_id: schedule.id,
          effective_from: hireDate,
        });
        if (i === 0)
          s.insert("user_roles", {
            id: uuid(),
            user_id: s.one("SELECT user_id FROM employees WHERE id=?", e.id)!
              .user_id,
            role_id: s.one(
              "SELECT id FROM roles WHERE tenant_id=? AND code='MANAGER'",
              setup.tenant,
            )!.id,
            organization_id: company,
            scope_type: "DEPARTMENT",
            scope_id: tech.id,
            assigned_by_user_id: setup.user,
          });
        const bank = s.one(
          "SELECT id FROM employee_bank_accounts WHERE employee_id=?",
          e.id,
        )!;
        await api(base + `/employees/${e.id}/banks/${bank.id}/verify`, {});
        await api(base + `/employees/${e.id}/tax-social`, {
          tax_method: "FIXED",
          fixed_tax_rate_basis_points: 200,
          period_start: periodStart,
          period_end: periodEnd,
          contribution_enabled: true,
          tax_id: `TEST-${companyIndex}-${i}`,
          insured_no: `TEST-${companyIndex}-${i}`,
          reason: "Synthetic test tax and social profile",
        });
        await api(
          base + `/employees/${e.id}/experiences`,
          {
            company_name: "บริษัทประสบการณ์เดิม (ข้อมูลสมมติ)",
            position_name: "เจ้าหน้าที่",
            started_on: Number(hireDate.slice(0, 4)) - 2 + "-01-01",
            ended_on: shift(hireDate, -1),
            description: "ประสบการณ์สำหรับทดสอบเท่านั้น",
          },
          email,
        );
        for (let day = periodStart; day <= date; day = shift(day, 1)) {
          if (!weekday(day)) continue;
          const recent = day >= currentStart,
            late = recent && i === 1 ? 15 : 0;
          s.insert("attendance_records", {
            id: uuid(),
            employee_id: e.id,
            work_date: day,
            scheduled_start_at: day + "T02:00:00Z",
            scheduled_end_at: day + "T11:00:00Z",
            check_in_at: day + (late ? "T02:15:00Z" : "T02:00:00Z"),
            check_out_at: recent && i === 5 ? null : day + "T11:00:00Z",
            worked_minutes: recent && i === 5 ? 0 : 480 - late,
            late_minutes: late,
            status: recent && i === 5 ? "INCOMPLETE" : "PRESENT",
            source: "MANUAL",
            note: "Synthetic seed attendance",
            approved_by_user_id: recent && i === 5 ? null : setup.user,
          });
        }
      }
      await api(base + "/employees", {
        first_name_th: "ร่าง",
        last_name_th: "พนักงานใหม่",
        hire_date: date,
        employment_status: "DRAFT",
        salary_satang: 0,
        branch_id: branch.id,
        department_id: sales.id,
        position_id: position.id,
      });
      const annual = s.one(
        "SELECT id FROM leave_types WHERE organization_id=? AND code='ANNUAL'",
        company,
      )!.id;
      const approvedDate = workDate(periodStart),
        futureDate = workDate(shift(date, 2));
      // Include both years when the previous payroll month or future leave crosses New Year.
      for (const year of new Set([
        Number(approvedDate.slice(0, 4)),
        Number(futureDate.slice(0, 4)),
        Number(workDate(shift(futureDate, 1)).slice(0, 4)),
      ]))
        for (const e of employees) {
          if (
            !s.one(
              "SELECT 1 FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
              e.id,
              annual,
              year,
            )
          ) {
            const id = uuid();
            s.insert("employee_leave_balances", {
              id,
              employee_id: e.id,
              leave_type_id: annual,
              balance_year: year,
              opening_minutes: 4800,
            });
            s.insert("leave_balance_transactions", {
              id: uuid(),
              employee_leave_balance_id: id,
              transaction_type: "OPENING",
              minutes: 4800,
              source_type: "TEST_SEED",
              source_id: String(year),
              reason: "Synthetic year balance",
              created_by_user_id: setup.user,
            });
          }
        }
      for (const [i, status] of ["APPROVED", "PENDING", "REJECTED"].entries()) {
        const d = i === 0 ? approvedDate : shift(futureDate, i - 1),
          chosen = workDate(d),
          email = `employee${companyIndex * 6 + i + 2}@example.test`,
          e = employees[i + 1];
        const leave = await api(
          base + "/leaves",
          {
            employee_id: e.id,
            leave_type_id: annual,
            start_date: chosen,
            end_date: chosen,
            minutes_per_day: i === 1 ? 240 : 480,
            reason: "คำขอลาทดสอบ " + status,
          },
          email,
        );
        if (status !== "PENDING") {
          while (true) {
            const step = s.one(
              "SELECT a.*,u.email FROM leave_approvals a JOIN users u ON u.id=a.approver_user_id WHERE leave_request_id=? AND decision='PENDING' ORDER BY step_no LIMIT 1",
              leave.id,
            );
            if (!step) break;
            await api(
              base + `/leaves/${leave.id}/decision`,
              { decision: status, comment: "ทดสอบขั้นตอนอนุมัติ" },
              step.email,
            );
            if (status === "REJECTED") break;
          }
          if (status === "APPROVED")
            s.run(
              "UPDATE attendance_records SET status='LEAVE',worked_minutes=0,check_in_at=NULL,check_out_at=NULL WHERE employee_id=? AND work_date=?",
              e.id,
              chosen,
            );
        }
      }
      const overtime = await api(
        base + "/overtime",
        {
          employee_id: employees[2].id,
          work_date: workDate(shift(periodStart, 7)),
          start_at: workDate(shift(periodStart, 7)) + "T11:00:00Z",
          end_at: workDate(shift(periodStart, 7)) + "T13:00:00Z",
          reason: "OT ข้อมูลทดสอบ",
        },
        `employee${companyIndex * 6 + 3}@example.test`,
      );
      await api(
        base + `/overtime/${overtime.id}/decision`,
        { decision: "APPROVED", comment: "อนุมัติ OT ทดสอบ" },
        "hr@example.test",
      );
      await api(
        base + "/overtime",
        {
          employee_id: employees[3].id,
          work_date: workDate(date),
          start_at: workDate(date) + "T11:00:00Z",
          end_at: workDate(date) + "T12:00:00Z",
          reason: "OT รอพิจารณา",
        },
        `employee${companyIndex * 6 + 4}@example.test`,
      );
      const cycle = await api(
        base + "/payroll",
        {
          code: "SEED-" + periodStart.slice(0, 7),
          name: "เงินเดือนงวดก่อน (ข้อมูลทดสอบ)",
          cycle_type: "MONTHLY",
          period_start: periodStart,
          period_end: periodEnd,
          pay_date: periodEnd,
          employee_ids: employees.map((e) => e.id),
        },
        "hr@example.test",
      );
      await api(
        base + `/payroll/${cycle.id}/adjustments`,
        {
          employee_id: employees[0].id,
          item_type: "EARNING",
          item_code: "BONUS_TEST",
          description: "โบนัสทดสอบ",
          amount_satang: 200000,
          reason: "Synthetic bonus",
        },
        "hr@example.test",
      );
      await api(base + `/payroll/${cycle.id}/calculate`, {}, "hr@example.test");
      await api(
        base + `/payroll/${cycle.id}/review`,
        { comment: "ผู้ตรวจสอบตรวจข้อมูลทดสอบ" },
        "reviewer@example.test",
      );
      await api(
        base + `/payroll/${cycle.id}/approve`,
        { comment: "ผู้อนุมัติอนุมัติงวดทดสอบ" },
        "approver@example.test",
      );
      const nextEnd = new Date(
        Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
      await api(
        base + "/payroll",
        {
          code: "SEED-" + date.slice(0, 7),
          name: "เงินเดือนงวดปัจจุบัน (ร่าง)",
          cycle_type: "MONTHLY",
          period_start: currentStart,
          period_end: nextEnd,
          pay_date: nextEnd,
          employee_ids: employees.map((e) => e.id),
        },
        "hr@example.test",
      );
      const announcement = await api(base + "/announcements", {
        title: "ยินดีต้อนรับ — ข้อมูลทดสอบ",
        body: "ใช้ทดสอบการอ่านประกาศและการยืนยันรับทราบ ไม่มีข้อมูลพนักงานจริง",
        status: "PUBLISHED",
        priority: "HIGH",
        requires_acknowledgement: true,
        targets: [{ type: "ALL", id: null }],
      });
      await api(
        base + `/announcements/${announcement.id}/open`,
        {},
        `employee${companyIndex * 6 + 1}@example.test`,
      );
      await api(
        base + `/announcements/${announcement.id}/acknowledge`,
        {},
        `employee${companyIndex * 6 + 1}@example.test`,
      );
      await api(base + "/announcements", {
        title: "ประกาศร่างสำหรับทดสอบ",
        body: "ยังไม่เผยแพร่",
        status: "DRAFT",
        targets: [{ type: "ALL", id: null }],
      });
      await api(base + "/announcements", {
        title: "ประกาศตั้งเวลาสำหรับทดสอบ",
        body: "เผยแพร่ในวันถัดไป",
        status: "SCHEDULED",
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: "ALL", id: null }],
      });
    }
    await api("/c/" + companies[0] + "/announcements", {
      title: "ประกาศกลุ่มบริษัท (ทดสอบ)",
      body: "ทดสอบการแจ้งเตือนและสิทธิ์ของสองบริษัท",
      status: "PUBLISHED",
      company_ids: companies,
      targets: [{ type: "ALL", id: null }],
    });
    const count = (table: string) =>
      s.one(`SELECT COUNT(*) n FROM ${table}`)!.n as number;
    const summary: SeedSummary = {
      workspace: "seed",
      date,
      companies,
      accounts,
      employees: count("employees"),
      attendance: count("attendance_records"),
      leaveRequests: count("leave_requests"),
      payrollCycles: count("payroll_cycles"),
      payslips: count("payslips"),
      announcements: count("announcements"),
      reused: false,
    };
    // Do not leave authenticated setup sessions behind.
    s.run(
      "UPDATE user_sessions SET revoked_at=? WHERE revoked_at IS NULL",
      now(),
    );
    s.insert("audit_logs", {
      id: uuid(),
      tenant_id: setup.tenant,
      actor_user_id: setup.user,
      action: "SEED_COMPLETE",
      object_type: "test_seed",
      object_id: marker,
      after_json: JSON.stringify(summary),
      reason: "Synthetic fixtures created by explicit seed command",
      request_id: uuid(),
    });
    if (db.query("PRAGMA foreign_key_check").all().length)
      throw new Error("Seed foreign key check failed");
    return summary;
  } finally {
    runtime.closeSockets();
  }
}
