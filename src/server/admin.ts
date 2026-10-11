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
  requirePermission,
  can,
  employee,
  companyObject,
  audit,
  fail,
  encryption,
  scopeSql,
} from "./core";
const lookups = [
  "branches",
  "departments",
  "positions",
  "job_levels",
  "work_schedules",
  "leave_types",
  "holidays",
] as const;
export function adminRoutes(db: Database, key: string) {
  const app = new Hono<Env>(),
    s = store(db),
    crypt = encryption(key);
  const tenantAdmin = (c: C) => {
    if (
      !c.get("grants").some((g) => g.code === "*" && g.scope_type === "TENANT")
    )
      fail(403, "Tenant administrator required");
  };
  app.get("/lookups", (c) => {
    const data: Row = {};
    for (const table of lookups)
      data[table] = s.all(
        `SELECT * FROM ${table} WHERE organization_id=?`,
        c.get("company").id,
      );
    const scope = scopeSql(c, "employees.read");
    data.employees = s.all(
      `SELECT e.id,e.employee_no,e.first_name_th,e.last_name_th FROM employees e WHERE e.organization_id=? AND e.deleted_at IS NULL AND ${scope.sql}`,
      c.get("company").id,
      ...scope.args,
    );
    data.roles = can(c, "settings.write")
      ? s.all("SELECT * FROM roles WHERE tenant_id=?", c.get("user").tenant_id)
      : [];
    return c.json(data);
  });
  app.post(
    "/settings/:table{branches|departments|positions|job_levels|work_schedules|leave_types|holidays}",
    async (c) => {
      requirePermission(c, "settings.write");
      const table = c.req.param("table");
      if (!lookups.includes(table as any)) fail(404, "Unknown setting");
      const base = {
        code: text(50),
        name_th: text(),
        name_en: z.string().max(200).default(""),
      };
      const schemas: Record<string, z.ZodType> = {
        branches: z.object(base).strict(),
        departments: z
          .object({ ...base, cost_center_code: z.string().max(50).default("") })
          .strict(),
        positions: z.object(base).strict(),
        job_levels: z
          .object({
            code: text(50),
            name: text(),
            rank_order: z.number().int().default(0),
          })
          .strict(),
        work_schedules: z
          .object({
            code: text(50),
            name: text(),
            break_minutes: z.number().int().min(0).max(240).default(60),
            grace_late_minutes: z.number().int().min(0).max(60).default(0),
            days: z
              .array(
                z.object({
                  weekday: z.number().int().min(1).max(7),
                  is_workday: z.boolean(),
                  start_time: z.string().regex(/^\d{2}:\d{2}$/),
                  end_time: z.string().regex(/^\d{2}:\d{2}$/),
                }),
              )
              .length(7),
          })
          .strict(),
        leave_types: z
          .object({
            ...base,
            is_paid: z.boolean().default(true),
            requires_attachment: z.boolean().default(false),
            annual_entitlement_minutes: z.number().int().min(0).default(4800),
          })
          .strict(),
        holidays: z.object({ holiday_date: date, name_th: text() }).strict(),
      };
      const b = schemas[table].parse(await c.req.json()) as Row;
      const id = uuid();
      db.transaction(() => {
        const { days, annual_entitlement_minutes, ...fields } = b;
        for (const k of ["is_paid", "requires_attachment"])
          if (k in fields) fields[k] = fields[k] ? 1 : 0;
        s.insert(table, {
          id,
          organization_id: c.get("company").id,
          ...fields,
        });
        if (days) {
          if (new Set(days.map((d: Row) => d.weekday)).size !== 7)
            fail(422, "Each weekday must occur once");
          for (const d of days) {
            if (d.is_workday && d.end_time <= d.start_time)
              fail(422, "Only same-day schedules are supported");
            s.insert("work_schedule_days", {
              work_schedule_id: id,
              ...d,
              is_workday: d.is_workday ? 1 : 0,
              break_minutes: b.break_minutes,
            });
          }
        }
        if (table === "leave_types")
          s.insert("leave_policies", {
            id: uuid(),
            organization_id: c.get("company").id,
            leave_type_id: id,
            name: b.name_th,
            annual_entitlement_minutes,
            effective_from: today(),
          });
        audit(db, c, "CREATE", table, id, null, b, "Company settings");
      })();
      return c.json({ id }, 201);
    },
  );
  app.post("/settings/schedule-assignment", async (c) => {
    requirePermission(c, "settings.write");
    const b = z
      .object({
        employee_id: z.uuid(),
        work_schedule_id: z.uuid(),
        effective_from: date,
        effective_to: date.nullable().default(null),
      })
      .strict()
      .parse(await c.req.json());
    employee(db, c, b.employee_id);
    companyObject(db, c, "work_schedules", b.work_schedule_id);
    if (b.effective_to && b.effective_to < b.effective_from)
      fail(422, "Invalid dates");
    if (
      s.one(
        "SELECT 1 FROM employee_schedule_assignments WHERE employee_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
        b.employee_id,
        b.effective_to || "9999-12-31",
        b.effective_from,
      )
    )
      fail(409, "Schedule assignment overlaps");
    const id = uuid();
    s.insert("employee_schedule_assignments", {
      id,
      ...b,
      created_by_user_id: c.get("user").id,
    });
    audit(
      db,
      c,
      "ASSIGN",
      "employee_schedule_assignments",
      id,
      null,
      b,
      "Schedule assigned",
    );
    return c.json({ id }, 201);
  });
  app.get("/settings/company", (c) => {
    requirePermission(c, "settings.write");
    const r = s.one(
      "SELECT * FROM organization_settings WHERE organization_id=?",
      c.get("company").id,
    )!;
    return c.json({
      ...c.get("company"),
      settings: JSON.parse(r.settings_json),
    });
  });
  app.put("/settings/company", async (c) => {
    requirePermission(c, "settings.write");
    const b = z
      .object({
        display_name: text(),
        legal_name: text(),
        status: z.enum(["ACTIVE", "INACTIVE"]),
        reason: text(1000),
        payroll: z
          .object({
            social_security_rate_basis_points: z
              .number()
              .int()
              .min(0)
              .max(10000),
            social_security_cap_satang: money,
            effective_from: date,
            source_reference: text(1000),
            verified_by: text(),
          })
          .optional(),
      })
      .strict()
      .parse(await c.req.json());
    db.transaction(() => {
      const { reason, payroll, ...fields } = b;
      s.update("organizations", c.get("company").id, {
        ...fields,
        updated_at: now(),
      });
      if (payroll) {
        const old = JSON.parse(
          s.one(
            "SELECT settings_json FROM organization_settings WHERE organization_id=?",
            c.get("company").id,
          )!.settings_json,
        );
        s.run(
          "UPDATE organization_settings SET settings_json=?,updated_at=? WHERE organization_id=?",
          JSON.stringify({ ...old, payroll }),
          now(),
          c.get("company").id,
        );
      }
      audit(
        db,
        c,
        "UPDATE",
        "organizations",
        c.get("company").id,
        c.get("company"),
        b,
        reason,
      );
    })();
    return c.json({ ok: true });
  });
  app.post("/companies", async (c) => {
    tenantAdmin(c);
    const b = z
      .object({ code: text(50), display_name: text(), legal_name: text() })
      .strict()
      .parse(await c.req.json());
    const id = uuid();
    db.transaction(() => {
      s.insert("organizations", {
        id,
        tenant_id: c.get("user").tenant_id,
        ...b,
      });
      s.insert("organization_settings", { organization_id: id });
      s.insert("user_company_access", {
        id: uuid(),
        user_id: c.get("user").id,
        organization_id: id,
        granted_by_user_id: c.get("user").id,
      });
      audit(db, c, "CREATE", "organizations", id, null, b, "Company created");
    })();
    return c.json({ id }, 201);
  });
  app.post("/employees/:id/tax-social", async (c) => {
    requirePermission(c, "employees.write");
    const e = employee(db, c, c.req.param("id"));
    const b = z
      .object({
        tax_method: z.enum(["PROGRESSIVE", "FIXED", "EXEMPT"]),
        fixed_tax_rate_basis_points: z
          .number()
          .int()
          .min(0)
          .max(10000)
          .nullable()
          .default(null),
        withholding_satang: money.default(0),
        period_start: date,
        period_end: date,
        contribution_enabled: z.boolean(),
        tax_id: z.string().max(30).optional(),
        insured_no: z.string().max(30).optional(),
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    db.transaction(() => {
      s.run(
        "INSERT INTO employee_tax_profiles(employee_id,tax_method,fixed_tax_rate_basis_points,deductions_json,tax_id_encrypted,effective_from) VALUES(?,?,?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET tax_method=excluded.tax_method,fixed_tax_rate_basis_points=excluded.fixed_tax_rate_basis_points,deductions_json=excluded.deductions_json,tax_id_encrypted=COALESCE(excluded.tax_id_encrypted,employee_tax_profiles.tax_id_encrypted),updated_at=?",
        e.id,
        b.tax_method,
        b.fixed_tax_rate_basis_points,
        JSON.stringify({
          withholding_satang: b.withholding_satang,
          period_start: b.period_start,
          period_end: b.period_end,
          verified_by: c.get("user").id,
        }),
        b.tax_id ? crypt.encrypt(b.tax_id) : null,
        b.period_start,
        now(),
      );
      s.run(
        "INSERT INTO employee_social_security_profiles(employee_id,insured_no_encrypted,contribution_enabled,effective_from) VALUES(?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET contribution_enabled=excluded.contribution_enabled,insured_no_encrypted=COALESCE(excluded.insured_no_encrypted,employee_social_security_profiles.insured_no_encrypted),updated_at=?",
        e.id,
        b.insured_no ? crypt.encrypt(b.insured_no) : null,
        b.contribution_enabled ? 1 : 0,
        b.period_start,
        now(),
      );
      audit(db, c, "UPDATE", "tax_social", e.id, null, b, b.reason, e.id);
    })();
    return c.json({ ok: true });
  });
  app.get("/users", (c) => {
    tenantAdmin(c);
    return c.json({
      items: s.all(
        "SELECT id,email,display_name,status,locked_until FROM users WHERE tenant_id=? ORDER BY display_name",
        c.get("user").tenant_id,
      ),
      access: s.all(
        "SELECT a.*,r.code role_code,ur.scope_type,ur.scope_id FROM user_company_access a JOIN users u ON u.id=a.user_id LEFT JOIN user_roles ur ON ur.user_id=u.id AND (ur.organization_id=a.organization_id OR ur.scope_type='TENANT') LEFT JOIN roles r ON r.id=ur.role_id WHERE u.tenant_id=?",
        c.get("user").tenant_id,
      ),
    });
  });
  app.post("/users/invitations", async (c) => {
    tenantAdmin(c);
    const b = z
      .object({
        email: z.email(),
        companies: z
          .array(z.object({ organization_id: z.uuid(), role_id: z.uuid() }))
          .min(1),
      })
      .strict()
      .parse(await c.req.json());
    const token = uuid() + uuid(),
      id = uuid();
    db.transaction(() => {
      s.insert("user_invitations", {
        id,
        tenant_id: c.get("user").tenant_id,
        email: b.email.toLowerCase(),
        default_organization_id: b.companies[0].organization_id,
        token_hash: hash(token),
        invited_by_user_id: c.get("user").id,
        expires_at: new Date(Date.now() + 72 * 3600000).toISOString(),
      });
      for (const co of b.companies) {
        if (
          !s.one(
            "SELECT 1 FROM organizations WHERE id=? AND tenant_id=?",
            co.organization_id,
            c.get("user").tenant_id,
          )
        )
          fail(403, "Company belongs to another tenant");
        const role = s.one(
          "SELECT * FROM roles WHERE id=? AND tenant_id=?",
          co.role_id,
          c.get("user").tenant_id,
        );
        if (!role || role.code === "TENANT_ADMIN")
          fail(
            403,
            "Tenant role cannot be assigned through company invitation",
          );
        s.insert("invitation_company_access", { invitation_id: id, ...co });
      }
      audit(
        db,
        c,
        "INVITE",
        "users",
        id,
        null,
        { email: b.email, companies: b.companies },
        "User invitation",
      );
    })();
    return c.json(
      {
        id,
        token,
        accept_url: "/accept-invitation?token=" + encodeURIComponent(token),
      },
      201,
    );
  });
  app.put("/users/:id", async (c) => {
    tenantAdmin(c);
    const user = s.one(
      "SELECT * FROM users WHERE id=? AND tenant_id=?",
      c.req.param("id"),
      c.get("user").tenant_id,
    );
    if (!user) fail(403, "User outside tenant");
    const b = z
      .object({
        status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]),
        unlock: z.boolean().default(false),
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    if (user.id === c.get("user").id && b.status !== "ACTIVE")
      fail(409, "Cannot disable yourself");
    const admin = s.one(
      "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.code='TENANT_ADMIN'",
      user.id,
    );
    if (
      admin &&
      b.status !== "ACTIVE" &&
      s.one(
        "SELECT COUNT(DISTINCT u.id) n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.tenant_id=? AND u.status='ACTIVE' AND r.code='TENANT_ADMIN'",
        user.tenant_id,
      )!.n <= 1
    )
      fail(409, "Cannot disable last administrator");
    db.transaction(() => {
      s.update("users", user.id, {
        status: b.status,
        ...(b.unlock ? { locked_until: null, failed_login_count: 0 } : {}),
        updated_at: now(),
      });
      if (b.status !== "ACTIVE")
        s.run(
          "UPDATE user_sessions SET revoked_at=?,revoked_reason='Account disabled' WHERE user_id=? AND revoked_at IS NULL",
          now(),
          user.id,
        );
      audit(
        db,
        c,
        "UPDATE",
        "users",
        user.id,
        { status: user.status },
        b,
        b.reason,
      );
    })();
    return c.json({ ok: true });
  });
  app.post("/users/:id/reset", async (c) => {
    tenantAdmin(c);
    const user = s.one(
      "SELECT id FROM users WHERE id=? AND tenant_id=?",
      c.req.param("id"),
      c.get("user").tenant_id,
    );
    if (!user) fail(403, "User unavailable");
    const token = uuid() + uuid();
    s.insert("account_action_tokens", {
      id: uuid(),
      user_id: user.id,
      token_type: "PASSWORD_RESET",
      token_hash: hash(token),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    audit(
      db,
      c,
      "RESET_REQUEST",
      "users",
      user.id,
      null,
      null,
      "Admin password reset",
    );
    return c.json({
      reset_url: "/reset-password?token=" + encodeURIComponent(token),
    });
  });
  app.post("/users/:id/access", async (c) => {
    tenantAdmin(c);
    const user = s.one(
      "SELECT * FROM users WHERE id=? AND tenant_id=?",
      c.req.param("id"),
      c.get("user").tenant_id,
    );
    if (!user) fail(403, "User unavailable");
    const b = z
      .object({
        organization_id: z.uuid(),
        role_id: z.uuid(),
        scope_type: z.enum(["COMPANY", "BRANCH", "DEPARTMENT", "SELF"]),
        scope_id: z.uuid().nullable().default(null),
        status: z.enum(["ACTIVE", "REVOKED"]),
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    if (
      !s.one(
        "SELECT 1 FROM organizations WHERE id=? AND tenant_id=?",
        b.organization_id,
        user.tenant_id,
      )
    )
      fail(403, "Company unavailable");
    const role = s.one(
      "SELECT * FROM roles WHERE id=? AND tenant_id=?",
      b.role_id,
      user.tenant_id,
    );
    if (!role || role.code === "TENANT_ADMIN")
      fail(403, "Cannot elevate to tenant administrator");
    if (["BRANCH", "DEPARTMENT"].includes(b.scope_type)) {
      if (!b.scope_id) fail(422, "Scope ID required");
      if (
        !s.one(
          `SELECT 1 FROM ${b.scope_type === "BRANCH" ? "branches" : "departments"} WHERE id=? AND organization_id=?`,
          b.scope_id,
          b.organization_id,
        )
      )
        fail(403, "Scope belongs to another company");
    }
    db.transaction(() => {
      s.run(
        "INSERT INTO user_company_access(id,user_id,organization_id,access_status,granted_by_user_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET access_status=excluded.access_status,is_default=0",
        uuid(),
        user.id,
        b.organization_id,
        b.status,
        c.get("user").id,
      );
      s.run(
        "DELETE FROM user_roles WHERE user_id=? AND organization_id=?",
        user.id,
        b.organization_id,
      );
      if (b.status === "ACTIVE")
        s.insert("user_roles", {
          id: uuid(),
          user_id: user.id,
          role_id: b.role_id,
          organization_id: b.organization_id,
          scope_type: b.scope_type,
          scope_id: b.scope_id,
          assigned_by_user_id: c.get("user").id,
        });
      audit(db, c, "ACCESS_CHANGE", "users", user.id, null, b, b.reason);
    })();
    return c.json({ ok: true });
  });
  app.get("/audit", (c) => {
    requirePermission(c, "audit.read");
    const q = "%" + (c.req.query("q") || "") + "%",
      items = s.all(
        "SELECT a.*,u.display_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.tenant_id=? AND a.organization_id=? AND (a.action LIKE ? OR a.object_type LIKE ? OR a.request_id LIKE ? OR u.display_name LIKE ?) ORDER BY a.created_at DESC LIMIT 100",
        c.get("user").tenant_id,
        c.get("company").id,
        q,
        q,
        q,
        q,
      );
    audit(
      db,
      c,
      "READ",
      "audit_logs",
      null,
      null,
      { count: items.length },
      "Audit accessed",
    );
    return c.json({ items });
  });
  return app;
}
