import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { store, uuid, now, today, hash, type Row } from "./db";
import {
  type Env,
  type C,
  text,
  date,
  money,
  nullableId,
  requirePermission,
  can,
  employee,
  scopeSql,
  companyObject,
  audit,
  fail,
  encryption,
  page,
} from "./core";
const employeeSchema = z
  .object({
    first_name_th: text(80),
    last_name_th: text(80),
    first_name_en: z.string().max(80).default(""),
    last_name_en: z.string().max(80).default(""),
    nickname: z.string().max(80).default(""),
    title_th: z.string().max(20).default(""),
    company_email: z.email().nullable().default(null),
    personal_email: z.email().nullable().default(null),
    mobile_phone: z.string().max(30).default(""),
    birth_date: date.nullable().default(null),
    gender: z
      .enum(["MALE", "FEMALE", "NON_BINARY", "UNSPECIFIED"])
      .default("UNSPECIFIED"),
    branch_id: nullableId,
    department_id: nullableId,
    position_id: nullableId,
    job_level_id: nullableId,
    manager_employee_id: nullableId,
    person_id: nullableId,
    employment_type: z
      .enum([
        "FULL_TIME",
        "PART_TIME",
        "CONTRACT",
        "PROBATION",
        "INTERN",
        "DAILY",
      ])
      .default("FULL_TIME"),
    employment_status: z
      .enum(["DRAFT", "ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"])
      .default("ACTIVE"),
    hire_date: date,
    probation_end_date: date.nullable().default(null),
    termination_date: date.nullable().default(null),
    termination_reason: z.string().max(1000).nullable().default(null),
    salary_satang: money.default(0),
    pay_type: z.enum(["MONTHLY", "DAILY", "HOURLY"]).default("MONTHLY"),
    regular_allowances: z
      .array(z.object({ name: text(), amount_satang: money }))
      .default([]),
    national_id: z
      .string()
      .regex(/^\d{13}$/)
      .nullable()
      .default(null),
    bank_code: z.string().max(20).nullable().default(null),
    account_number: z
      .string()
      .regex(/^\d{6,20}$/)
      .nullable()
      .default(null),
    account_name: z.string().max(150).nullable().default(null),
    address: z.string().max(2000).default(""),
    emergency_name: z.string().max(150).default(""),
    emergency_relationship: z.string().max(100).default(""),
    emergency_phone: z.string().max(30).default(""),
    create_user: z.boolean().default(false),
    password: z.string().min(12).max(128).optional(),
    reason: z.string().max(1000).default(""),
    effective_date: date.optional(),
    reauth_password: z.string().max(128).optional(),
  })
  .strict();
const employeeFields = [
  "first_name_th",
  "last_name_th",
  "first_name_en",
  "last_name_en",
  "nickname",
  "title_th",
  "company_email",
  "personal_email",
  "mobile_phone",
  "birth_date",
  "gender",
  "branch_id",
  "department_id",
  "position_id",
  "job_level_id",
  "manager_employee_id",
  "employment_type",
  "employment_status",
  "hire_date",
  "probation_end_date",
  "termination_date",
  "termination_reason",
];
const previousDay = (v: string) =>
  new Date(Date.parse(v) - 86400000).toISOString().slice(0, 10);
export function employeeRoutes(db: Database, key: string) {
  const app = new Hono<Env>(),
    s = store(db),
    crypt = encryption(key);
  function check(c: C, b: Row, id?: string) {
    for (const [field, table] of [
      ["branch_id", "branches"],
      ["department_id", "departments"],
      ["position_id", "positions"],
      ["job_level_id", "job_levels"],
    ])
      if (b[field]) companyObject(db, c, table, b[field]);
    if (b.probation_end_date && b.probation_end_date < b.hire_date)
      fail(422, "Probation end must follow hire date");
    if (
      b.employment_status === "TERMINATED" &&
      (!b.termination_date || !b.termination_reason)
    )
      fail(422, "Termination date and reason are required");
    if (b.employment_status !== "DRAFT" && b.salary_satang <= 0)
      fail(422, "Active employment requires positive compensation");
    if (b.employment_type === "CONTRACT" && !b.probation_end_date)
      fail(422, "Contract employment requires an end date");
    if (b.manager_employee_id) {
      let manager = employee(db, c, b.manager_employee_id);
      const seen = new Set([id]);
      while (manager) {
        if (seen.has(manager.id)) fail(422, "Manager hierarchy cycle");
        seen.add(manager.id);
        manager = manager.manager_employee_id
          ? employee(db, c, manager.manager_employee_id)
          : (null as any);
      }
    }
  }
  function comp(id: string, b: Row, c: C, effective: string) {
    const prior = s.one(
      "SELECT * FROM compensation_history WHERE employee_id=? ORDER BY effective_from DESC LIMIT 1",
      id,
    );
    if (prior && effective <= prior.effective_from)
      fail(422, "New compensation must start after the latest version");
    if (prior)
      s.update("compensation_history", prior.id, {
        effective_to: previousDay(effective),
      });
    s.insert("compensation_history", {
      id: uuid(),
      employee_id: id,
      effective_from: effective,
      pay_type: b.pay_type,
      base_salary_satang: b.pay_type === "MONTHLY" ? b.salary_satang : 0,
      daily_rate_satang: b.pay_type === "DAILY" ? b.salary_satang : null,
      hourly_rate_satang: b.pay_type === "HOURLY" ? b.salary_satang : null,
      regular_allowances_json: JSON.stringify(b.regular_allowances),
      reason: b.reason || "Initial compensation",
      created_by_user_id: c.get("user").id,
    });
  }
  function employment(
    id: string,
    b: Row,
    c: C,
    event: string,
    effective: string,
  ) {
    s.insert("employment_history", {
      id: uuid(),
      employee_id: id,
      event_type: event,
      effective_from: effective,
      branch_id: b.branch_id,
      department_id: b.department_id,
      position_id: b.position_id,
      job_level_id: b.job_level_id,
      manager_employee_id: b.manager_employee_id,
      employment_type: b.employment_type,
      employment_status: b.employment_status,
      reason: b.reason || "Initial employment",
      created_by_user_id: c.get("user").id,
    });
  }
  function extras(id: string, b: Row, c: C, effective: string) {
    if (b.address) {
      s.run("DELETE FROM employee_addresses WHERE employee_id=?", id);
      s.insert("employee_addresses", {
        id: uuid(),
        employee_id: id,
        address_type: "CURRENT",
        address_line1: b.address,
        is_primary: 1,
      });
    }
    if (b.emergency_name) {
      s.run("DELETE FROM employee_emergency_contacts WHERE employee_id=?", id);
      s.insert("employee_emergency_contacts", {
        id: uuid(),
        employee_id: id,
        full_name: b.emergency_name,
        relationship: b.emergency_relationship || "Contact",
        phone: b.emergency_phone,
      });
    }
    if (b.account_number) {
      if (!b.bank_code || !b.account_name)
        fail(422, "Bank and account name are required");
      const prev = s.one(
        "SELECT * FROM employee_bank_accounts WHERE employee_id=? AND effective_to IS NULL",
        id,
      );
      if (prev) {
        if (effective <= prev.effective_from)
          fail(422, "Bank effective date must follow previous version");
        s.update("employee_bank_accounts", prev.id, {
          effective_to: previousDay(effective),
          is_primary: 0,
        });
      }
      s.insert("employee_bank_accounts", {
        id: uuid(),
        employee_id: id,
        bank_code: b.bank_code,
        account_name: b.account_name,
        account_number_encrypted: crypt.encrypt(b.account_number),
        account_number_last4: b.account_number.slice(-4),
        is_primary: 1,
        effective_from: effective,
        created_by_user_id: c.get("user").id,
      });
    }
  }
  function safe(c: C, r: Row) {
    const copy = { ...r };
    delete copy.national_id_encrypted;
    delete copy.passport_no_encrypted;
    copy.national_id_masked = r.national_id_encrypted
      ? "•••••••••" + crypt.decrypt(r.national_id_encrypted).slice(-4)
      : null;
    if (!can(c, "compensation.read") && r.id !== c.get("access").employee_id)
      delete copy.salary_satang;
    return copy;
  }
  app.get("/", (c) => {
    const { limit, offset } = page(c),
      scope = scopeSql(c, "employees.read"),
      q = "%" + (c.req.query("q") || "") + "%",
      department = c.req.query("department") || "",
      status = c.req.query("status") || "";
    const where = `e.organization_id=? AND o.tenant_id=? AND e.deleted_at IS NULL AND ${scope.sql} AND (e.first_name_th||' '||e.last_name_th LIKE ? OR e.company_email LIKE ? OR p.name_th LIKE ?) AND (?='' OR e.department_id=?) AND (?='' OR e.employment_status=?)`;
    const args = [
      c.get("company").id,
      c.get("user").tenant_id,
      ...scope.args,
      q,
      q,
      q,
      department,
      department,
      status,
      status,
    ];
    const from =
      "FROM employees e JOIN organizations o ON o.id=e.organization_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id";
    const rows = s.all(
      `SELECT e.*,d.name_th department_name,p.name_th position_name,(SELECT CASE pay_type WHEN 'MONTHLY' THEN base_salary_satang WHEN 'DAILY' THEN daily_rate_satang ELSE hourly_rate_satang END FROM compensation_history ch WHERE ch.employee_id=e.id AND ch.effective_from<=? AND (ch.effective_to IS NULL OR ch.effective_to>=?) ORDER BY ch.effective_from DESC LIMIT 1) salary_satang ${from} WHERE ${where} ORDER BY e.employee_no LIMIT ? OFFSET ?`,
      today(),
      today(),
      ...args,
      limit,
      offset,
    );
    return c.json({
      items: rows.map((r) => safe(c, r)),
      total: s.one(`SELECT COUNT(*) n ${from} WHERE ${where}`, ...args)!.n,
    });
  });
  app.get("/:id", (c) => {
    const e = employee(db, c, c.req.param("id"));
    const compensation =
      can(c, "compensation.read") || e.id === c.get("access").employee_id;
    const banks = compensation
      ? s.all(
          "SELECT id,bank_code,account_name,account_number_last4,verified_at,effective_from,effective_to FROM employee_bank_accounts WHERE employee_id=? ORDER BY effective_from DESC",
          e.id,
        )
      : [];
    return c.json({
      ...safe(c, e),
      documents: s.all(
        "SELECT id,file_name,file_url,mime_type,created_at FROM file_attachments WHERE tenant_id=? AND organization_id=? AND object_type='employees' AND object_id=?",
        c.get("user").tenant_id,
        c.get("company").id,
        e.id,
      ),
      compensation: compensation
        ? s.all(
            "SELECT * FROM compensation_history WHERE employee_id=? ORDER BY effective_from DESC",
            e.id,
          )
        : [],
      banks,
      addresses: s.all(
        "SELECT * FROM employee_addresses WHERE employee_id=?",
        e.id,
      ),
      emergency_contacts: s.all(
        "SELECT * FROM employee_emergency_contacts WHERE employee_id=?",
        e.id,
      ),
      history: s.all(
        "SELECT * FROM employment_history WHERE employee_id=? ORDER BY effective_from DESC",
        e.id,
      ),
      experiences: s.all(
        "SELECT * FROM employee_work_experiences WHERE employee_id=? ORDER BY started_on DESC",
        e.id,
      ),
      balances: s.all(
        "SELECT b.*,t.name_th FROM employee_leave_balances b JOIN leave_types t ON t.id=b.leave_type_id WHERE b.employee_id=?",
        e.id,
      ),
      change_requests: s.all(
        "SELECT * FROM employee_profile_change_requests WHERE employee_id=? ORDER BY created_at DESC",
        e.id,
      ),
    });
  });
  app.post("/", async (c) => {
    requirePermission(c, "employees.write");
    const b = employeeSchema.parse(await c.req.json());
    check(c, b);
    if (b.create_user && (!b.company_email || !b.password))
      fail(422, "Email and initial password are required");
    const password_hash = b.create_user
      ? await Bun.password.hash(b.password!, { algorithm: "argon2id" })
      : null;
    const id = db.transaction(() => {
      let person: Row | null = null;
      if (b.person_id) {
        person = s.one(
          "SELECT * FROM people WHERE id=? AND tenant_id=?",
          b.person_id,
          c.get("user").tenant_id,
        );
        if (!person) fail(403, "Person belongs to another workspace");
      } else if (b.national_id)
        person = s.one(
          "SELECT * FROM people WHERE tenant_id=? AND national_id_hash=?",
          c.get("user").tenant_id,
          hash(b.national_id),
        );
      if (!person)
        person = s.insert("people", {
          id: uuid(),
          tenant_id: c.get("user").tenant_id,
          national_id_hash: b.national_id ? hash(b.national_id) : null,
          primary_email: b.personal_email,
          primary_phone: b.mobile_phone,
        });
      let user = person.user_id;
      if (b.create_user) {
        const existing = s.one(
          "SELECT * FROM users WHERE tenant_id=? AND lower(email)=?",
          c.get("user").tenant_id,
          b.company_email!.toLowerCase(),
        );
        if (existing && existing.id !== person.user_id)
          fail(409, "Email belongs to another person");
        if (!existing) {
          user = uuid();
          s.insert("users", {
            id: user,
            tenant_id: c.get("user").tenant_id,
            default_organization_id: c.get("company").id,
            email: b.company_email!.toLowerCase(),
            display_name: b.first_name_th + " " + b.last_name_th,
            password_hash,
          });
          s.update("people", person.id, { user_id: user });
        }
      }
      const id = uuid(),
        code =
          "EMP-" +
          String(
            s.one(
              "SELECT COUNT(*) n FROM employees WHERE organization_id=?",
              c.get("company").id,
            )!.n + 1,
          ).padStart(5, "0");
      s.insert("employees", {
        id,
        organization_id: c.get("company").id,
        person_id: person.id,
        employee_no: code,
        user_id: user || null,
        ...Object.fromEntries(employeeFields.map((k) => [k, (b as Row)[k]])),
        national_id_encrypted: b.national_id
          ? crypt.encrypt(b.national_id)
          : null,
        created_by_user_id: c.get("user").id,
      });
      if (user) {
        s.run(
          "INSERT INTO user_company_access(id,user_id,organization_id,employee_id,granted_by_user_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET employee_id=excluded.employee_id",
          uuid(),
          user,
          c.get("company").id,
          id,
          c.get("user").id,
        );
        if (
          !s.one(
            "SELECT 1 FROM user_roles WHERE user_id=? AND organization_id=?",
            user,
            c.get("company").id,
          )
        ) {
          const role = s.one(
            "SELECT id FROM roles WHERE tenant_id=? AND code='EMPLOYEE'",
            c.get("user").tenant_id,
          )!;
          s.insert("user_roles", {
            id: uuid(),
            user_id: user,
            role_id: role.id,
            organization_id: c.get("company").id,
            scope_type: "SELF",
          });
        }
      }
      comp(id, b, c, b.hire_date);
      employment(id, b, c, "HIRED", b.hire_date);
      extras(id, b, c, b.hire_date);
      const policies = s.all(
        "SELECT * FROM leave_policies WHERE organization_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
        c.get("company").id,
        b.hire_date,
        b.hire_date,
      );
      for (const p of policies) {
        const balance = uuid();
        s.insert("employee_leave_balances", {
          id: balance,
          employee_id: id,
          leave_type_id: p.leave_type_id,
          balance_year: Number(today().slice(0, 4)),
          opening_minutes:
            p.accrual_method === "ANNUAL" &&
            Math.floor(
              (Date.parse(today()) - Date.parse(b.hire_date)) / 86400000,
            ) >= p.minimum_service_days
              ? p.annual_entitlement_minutes
              : 0,
        });
        s.insert("leave_balance_transactions", {
          id: uuid(),
          employee_leave_balance_id: balance,
          transaction_type: "OPENING",
          minutes:
            p.accrual_method === "ANNUAL" &&
            Math.floor(
              (Date.parse(today()) - Date.parse(b.hire_date)) / 86400000,
            ) >= p.minimum_service_days
              ? p.annual_entitlement_minutes
              : 0,
          reason: "Initial entitlement",
          created_by_user_id: c.get("user").id,
        });
      }
      audit(
        db,
        c,
        "CREATE",
        "employees",
        id,
        null,
        { ...b, password: undefined },
        "Employee created",
        id,
      );
      return id;
    })();
    return c.json({ id }, 201);
  });
  app.put("/:id", async (c) => {
    requirePermission(c, "employees.write");
    const old = employee(db, c, c.req.param("id"));
    const b = employeeSchema.parse(await c.req.json());
    if (!b.reason || !b.effective_date)
      fail(422, "Change reason and effective date are required");
    if (b.effective_date > today())
      fail(422, "Future profile changes require an approval request");
    check(c, b, old.id);
    const sensitive =
      b.company_email !== old.company_email ||
      !!b.national_id ||
      !!b.account_number;
    if (
      sensitive &&
      (!b.reauth_password ||
        !(await Bun.password.verify(
          b.reauth_password,
          c.get("user").password_hash,
        )))
    )
      fail(403, "Re-authentication required for sensitive changes");
    db.transaction(() => {
      const prior = s.one(
        "SELECT * FROM compensation_history WHERE employee_id=? ORDER BY effective_from DESC LIMIT 1",
        old.id,
      )!;
      const salary =
        prior.pay_type === "MONTHLY"
          ? prior.base_salary_satang
          : prior.pay_type === "DAILY"
            ? prior.daily_rate_satang
            : prior.hourly_rate_satang;
      if (b.national_id)
        s.update("people", old.person_id, {
          national_id_hash: hash(b.national_id),
          updated_at: now(),
        });
      if (
        b.company_email !== old.company_email &&
        old.user_id &&
        b.company_email
      )
        s.update("users", old.user_id, {
          email: b.company_email.toLowerCase(),
          updated_at: now(),
        });
      if (b.employment_status === "TERMINATED")
        s.run(
          "UPDATE user_company_access SET access_status='REVOKED',is_default=0,revoked_at=? WHERE employee_id=?",
          now(),
          old.id,
        );
      if (
        salary !== b.salary_satang ||
        prior.pay_type !== b.pay_type ||
        prior.regular_allowances_json !== JSON.stringify(b.regular_allowances)
      )
        comp(old.id, b, c, b.effective_date!);
      s.update("employees", old.id, {
        ...Object.fromEntries(employeeFields.map((k) => [k, (b as Row)[k]])),
        ...(b.national_id
          ? { national_id_encrypted: crypt.encrypt(b.national_id) }
          : {}),
        updated_by_user_id: c.get("user").id,
        updated_at: now(),
      });
      if (employeeFields.some((k) => (b as Row)[k] !== old[k]))
        employment(
          old.id,
          b,
          c,
          b.employment_status === "TERMINATED"
            ? "TERMINATED"
            : "STATUS_CHANGED",
          b.effective_date!,
        );
      extras(old.id, b, c, b.effective_date!);
      audit(db, c, "UPDATE", "employees", old.id, old, b, b.reason, old.id);
    })();
    return c.json({ id: old.id });
  });
  app.delete("/:id", async (c) => {
    requirePermission(c, "employees.write");
    const e = employee(db, c, c.req.param("id"));
    if (e.id === c.get("access").employee_id)
      fail(409, "Cannot delete your own employee record");
    const b = z.object({ reason: text(1000) }).parse(await c.req.json());
    db.transaction(() => {
      s.update("employees", e.id, {
        deleted_at: now(),
        employment_status: "TERMINATED",
        termination_date: today(),
        termination_reason: b.reason,
        updated_at: now(),
      });
      s.run(
        "UPDATE user_company_access SET access_status='REVOKED',revoked_at=? WHERE employee_id=?",
        now(),
        e.id,
      );
      audit(db, c, "DELETE", "employees", e.id, e, null, b.reason, e.id);
    })();
    return c.json({ ok: true });
  });
  app.post("/:id/experiences", async (c) => {
    const e = employee(db, c, c.req.param("id"));
    if (e.id !== c.get("access").employee_id && !can(c, "employees.write"))
      fail(403, "Permission denied");
    const b = z
      .object({
        company_name: text(),
        position_name: text(),
        started_on: date,
        ended_on: date.nullable().default(null),
        description: z.string().max(2000).default(""),
      })
      .strict()
      .parse(await c.req.json());
    if (b.ended_on && b.ended_on < b.started_on)
      fail(422, "Invalid experience dates");
    const id = uuid();
    db.transaction(() => {
      s.insert("employee_work_experiences", {
        id,
        employee_id: e.id,
        ...b,
        submission_status: "SUBMITTED",
        submitted_by_user_id: c.get("user").id,
        submitted_at: now(),
      });
      audit(
        db,
        c,
        "SUBMIT",
        "employee_work_experiences",
        id,
        null,
        b,
        "Work experience",
        e.id,
      );
    })();
    return c.json({ id }, 201);
  });
  app.post("/:id/change-requests", async (c) => {
    const e = employee(db, c, c.req.param("id"));
    if (e.id !== c.get("access").employee_id) fail(403, "Self-service only");
    const b = z
      .object({
        reason: text(1000),
        changes: z.record(z.string(), z.string().max(2000)),
      })
      .parse(await c.req.json());
    const allowed = [
      "mobile_phone",
      "personal_email",
      "nickname",
      "first_name_th",
      "last_name_th",
    ];
    if (
      !Object.keys(b.changes).length ||
      Object.keys(b.changes).some((k) => !allowed.includes(k))
    )
      fail(422, "Unsupported profile change field");
    const id = uuid();
    db.transaction(() => {
      s.insert("employee_profile_change_requests", {
        id,
        employee_id: e.id,
        request_type: "PERSONAL_INFO",
        status: "PENDING",
        reason: b.reason,
        submitted_by_user_id: c.get("user").id,
        submitted_at: now(),
      });
      for (const [k, v] of Object.entries(b.changes))
        s.insert("employee_profile_change_items", {
          id: uuid(),
          change_request_id: id,
          field_path: k,
          old_value_encrypted: crypt.encrypt(e[k] || ""),
          new_value_encrypted: crypt.encrypt(v),
          display_old_value_masked: k.includes("name") ? "•••" : e[k],
          display_new_value_masked: k.includes("name") ? "•••" : v,
        });
      audit(
        db,
        c,
        "SUBMIT",
        "employee_profile_change_requests",
        id,
        null,
        { fields: Object.keys(b.changes) },
        b.reason,
        e.id,
      );
    })();
    return c.json({ id }, 201);
  });
  app.post("/:id/change-requests/:request/decision", async (c) => {
    requirePermission(c, "employees.write");
    const e = employee(db, c, c.req.param("id"));
    const request = s.one(
      "SELECT * FROM employee_profile_change_requests WHERE id=? AND employee_id=?",
      c.req.param("request"),
      e.id,
    );
    if (!request) fail(403, "Request unavailable");
    const b = z
      .object({
        decision: z.enum(["APPROVED", "REJECTED"]),
        comment: text(1000),
      })
      .parse(await c.req.json());
    if (request.status !== "PENDING") fail(409, "Request already decided");
    if (request.submitted_by_user_id === c.get("user").id)
      fail(403, "Cannot approve your own request");
    db.transaction(() => {
      if (b.decision === "APPROVED") {
        const changes: Row = {};
        for (const item of s.all(
          "SELECT * FROM employee_profile_change_items WHERE change_request_id=?",
          request.id,
        ))
          changes[item.field_path] = crypt.decrypt(item.new_value_encrypted);
        if (changes.personal_email) z.email().parse(changes.personal_email);
        s.update("employees", e.id, { ...changes, updated_at: now() });
      }
      s.update("employee_profile_change_requests", request.id, {
        status: b.decision,
        reviewed_by_user_id: c.get("user").id,
        reviewed_at: now(),
        review_comment: b.comment,
      });
      audit(
        db,
        c,
        b.decision,
        "employee_profile_change_requests",
        request.id,
        null,
        { status: b.decision },
        b.comment,
        e.id,
      );
    })();
    return c.json({ ok: true });
  });
  app.post("/:id/banks/:bank/verify", async (c) => {
    requirePermission(c, "employees.write");
    const e = employee(db, c, c.req.param("id"));
    const bank = s.one(
      "SELECT * FROM employee_bank_accounts WHERE id=? AND employee_id=?",
      c.req.param("bank"),
      e.id,
    );
    if (!bank) fail(403, "Bank unavailable");
    s.update("employee_bank_accounts", bank.id, { verified_at: now() });
    audit(
      db,
      c,
      "VERIFY",
      "employee_bank_accounts",
      bank.id,
      null,
      { last4: bank.account_number_last4 },
      "Bank verified",
      e.id,
    );
    return c.json({ ok: true });
  });
  return app;
}
