import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { store, uuid, now, today, type Row } from "./db";
import {
  type Env,
  type C,
  text,
  date,
  requirePermission,
  employee,
  companyObject,
  audit,
  fail,
  scopeSql,
} from "./core";
export function managementRoutes(db: Database) {
  const app = new Hono<Env>(),
    s = store(db);
  const tenantAdmin = (c: C) => {
    if (
      !c.get("grants").some((g) => g.code === "*" && g.scope_type === "TENANT")
    )
      fail(403, "Tenant administrator required");
  };
  const access = (c: C, id: string, permission: string) => {
    const co = s.one(
      "SELECT o.* FROM organizations o JOIN user_company_access a ON a.organization_id=o.id WHERE o.id=? AND o.tenant_id=? AND o.status='ACTIVE' AND a.user_id=? AND a.access_status='ACTIVE'",
      id,
      c.get("user").tenant_id,
      c.get("user").id,
    );
    if (!co) fail(403, "Company access denied");
    if (
      !s.one(
        "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND r.tenant_id=? AND (ur.organization_id=? OR(ur.scope_type='TENANT' AND ur.organization_id IS NULL)) AND ur.scope_type IN ('TENANT','COMPANY') AND p.code IN ('*',?)",
        c.get("user").id,
        c.get("user").tenant_id,
        id,
        permission,
      )
    )
      fail(403, "Company permission denied");
    return co;
  };
  app.get("/roles", (c) => {
    tenantAdmin(c);
    return c.json({
      roles: s.all(
        "SELECT * FROM roles WHERE tenant_id=?",
        c.get("user").tenant_id,
      ),
      permissions: s.all(
        "SELECT * FROM permissions WHERE code<>'*' ORDER BY module,code",
      ),
      role_permissions: s.all(
        "SELECT rp.* FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.tenant_id=?",
        c.get("user").tenant_id,
      ),
    });
  });
  app.post("/roles", async (c) => {
    tenantAdmin(c);
    const b = z
      .object({
        code: text(50),
        name: text(),
        permissions: z.array(text()).min(1),
      })
      .strict()
      .parse(await c.req.json());
    if (b.permissions.includes("*"))
      fail(403, "Custom roles cannot grant tenant superuser access");
    const id = uuid();
    db.transaction(() => {
      s.insert("roles", {
        id,
        tenant_id: c.get("user").tenant_id,
        code: b.code.toUpperCase(),
        name: b.name,
      });
      for (const code of new Set(b.permissions)) {
        const p = s.one("SELECT id FROM permissions WHERE code=?", code);
        if (!p) fail(422, "Unknown permission");
        s.insert("role_permissions", { role_id: id, permission_id: p.id });
      }
      audit(db, c, "CREATE", "roles", id, null, b, "Custom company role");
    })();
    return c.json({ id }, 201);
  });
  app.post("/companies/relationships", async (c) => {
    tenantAdmin(c);
    const b = z
      .object({
        parent_organization_id: z.uuid(),
        child_organization_id: z.uuid(),
        relationship_type: z.enum(["SUBSIDIARY", "AFFILIATE", "MANAGED_BY"]),
        effective_from: date,
      })
      .strict()
      .parse(await c.req.json());
    access(c, b.parent_organization_id, "settings.write");
    access(c, b.child_organization_id, "settings.write");
    if (b.parent_organization_id === b.child_organization_id)
      fail(422, "Companies must differ");
    if (
      s.one(
        "WITH RECURSIVE descendants(id) AS (SELECT child_organization_id FROM organization_relationships WHERE tenant_id=? AND parent_organization_id=? UNION SELECT r.child_organization_id FROM organization_relationships r JOIN descendants d ON r.parent_organization_id=d.id WHERE r.tenant_id=?) SELECT 1 FROM descendants WHERE id=?",
        c.get("user").tenant_id,
        b.child_organization_id,
        c.get("user").tenant_id,
        b.parent_organization_id,
      )
    )
      fail(422, "Company relationship cycle");
    const id = uuid();
    s.insert("organization_relationships", {
      id,
      tenant_id: c.get("user").tenant_id,
      ...b,
    });
    audit(
      db,
      c,
      "CREATE",
      "organization_relationships",
      id,
      null,
      b,
      "Company relationship",
    );
    return c.json({ id }, 201);
  });
  app.get("/companies/relationships", (c) => {
    tenantAdmin(c);
    return c.json({
      items: s.all(
        "SELECT r.*,p.display_name parent_name,ch.display_name child_name FROM organization_relationships r JOIN organizations p ON p.id=r.parent_organization_id JOIN organizations ch ON ch.id=r.child_organization_id WHERE r.tenant_id=?",
        c.get("user").tenant_id,
      ),
    });
  });
  app.get("/reports/companies", (c) => {
    requirePermission(c, "exports.write");
    const ids: string[] = (
      c.req.query("companies") || c.get("company").id
    ).split(",");
    if (
      !s.one(
        "SELECT allow_cross_company_reporting FROM tenant_settings WHERE tenant_id=?",
        c.get("user").tenant_id,
      )?.allow_cross_company_reporting
    )
      fail(403, "Group reports are disabled");
    const items = ids.map((id) => {
      z.uuid().parse(id);
      const co = access(c, id, "exports.write");
      return {
        id,
        company_code: co.code,
        company_name: co.display_name,
        currency: co.currency_code,
        employee_count: s.one(
          "SELECT COUNT(*) n FROM employees WHERE organization_id=? AND deleted_at IS NULL",
          id,
        )!.n,
        pending_leave_count: s.one(
          "SELECT COUNT(*) n FROM leave_requests r JOIN employees e ON e.id=r.employee_id WHERE e.organization_id=? AND r.status='PENDING'",
          id,
        )!.n,
      };
    });
    audit(
      db,
      c,
      "READ",
      "company_report",
      null,
      null,
      { companies: ids },
      "Consolidated report",
    );
    return c.json({ items });
  });
  app.put(
    "/settings/:table{branches|departments|positions|work_schedules|leave_types}/:id",
    async (c) => {
      requirePermission(c, "settings.write");
      const table = c.req.param("table"),
        old = companyObject(db, c, table, c.req.param("id"));
      const b = z
        .object({ status: z.enum(["ACTIVE", "INACTIVE"]), reason: text(1000) })
        .strict()
        .parse(await c.req.json());
      s.update(table, old.id, { status: b.status, updated_at: now() });
      audit(
        db,
        c,
        "STATUS_CHANGE",
        table,
        old.id,
        { status: old.status },
        b,
        b.reason,
      );
      return c.json({ ok: true });
    },
  );
  app.post("/settings/leave-policy", async (c) => {
    requirePermission(c, "settings.write");
    const b = z
      .object({
        leave_type_id: z.uuid(),
        name: text(),
        annual_entitlement_minutes: z.number().int().min(0),
        accrual_method: z.enum(["NONE", "ANNUAL", "MONTHLY", "DAILY"]),
        carry_forward_limit_minutes: z.number().int().min(0).default(0),
        minimum_service_days: z.number().int().min(0).default(0),
        effective_from: date,
        effective_to: date.nullable().default(null),
      })
      .strict()
      .parse(await c.req.json());
    companyObject(db, c, "leave_types", b.leave_type_id);
    if (b.effective_to && b.effective_to < b.effective_from)
      fail(422, "Invalid policy dates");
    if (
      s.one(
        "SELECT 1 FROM leave_policies WHERE leave_type_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
        b.leave_type_id,
        b.effective_to || "9999-12-31",
        b.effective_from,
      )
    )
      fail(409, "Leave policy dates overlap");
    const id = uuid();
    s.insert("leave_policies", {
      id,
      organization_id: c.get("company").id,
      ...b,
    });
    audit(db, c, "CREATE", "leave_policies", id, null, b, "Leave policy");
    return c.json({ id }, 201);
  });
  app.post("/leaves/balance-adjustment", async (c) => {
    requirePermission(c, "settings.write");
    const b = z
      .object({
        employee_id: z.uuid(),
        leave_type_id: z.uuid(),
        balance_year: z.number().int().min(2020).max(2100),
        minutes: z.number().int().min(-525600).max(525600),
        transaction_type: z.enum([
          "ACCRUAL",
          "ADJUSTMENT",
          "CARRY_FORWARD",
          "EXPIRY",
        ]),
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    employee(db, c, b.employee_id);
    companyObject(db, c, "leave_types", b.leave_type_id);
    if (
      (["ACCRUAL", "CARRY_FORWARD"].includes(b.transaction_type) &&
        b.minutes < 0) ||
      (b.transaction_type === "EXPIRY" && b.minutes > 0)
    )
      fail(422, "Invalid ledger sign");
    db.transaction(() => {
      let balance = s.one(
        "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
        b.employee_id,
        b.leave_type_id,
        b.balance_year,
      );
      if (!balance)
        balance = s.insert("employee_leave_balances", {
          id: uuid(),
          employee_id: b.employee_id,
          leave_type_id: b.leave_type_id,
          balance_year: b.balance_year,
        });
      const field =
        b.transaction_type === "ACCRUAL"
          ? "accrued_minutes"
          : b.transaction_type === "CARRY_FORWARD"
            ? "carried_forward_minutes"
            : "adjusted_minutes";
      s.run(
        `UPDATE employee_leave_balances SET ${field}=${field}+?,updated_at=? WHERE id=?`,
        b.minutes,
        now(),
        balance.id,
      );
      s.insert("leave_balance_transactions", {
        id: uuid(),
        employee_leave_balance_id: balance.id,
        transaction_type: b.transaction_type,
        minutes: b.minutes,
        reason: b.reason,
        created_by_user_id: c.get("user").id,
      });
      audit(
        db,
        c,
        "ADJUST",
        "employee_leave_balances",
        balance.id,
        null,
        b,
        b.reason,
        b.employee_id,
      );
    })();
    return c.json({ ok: true });
  });
  app.get("/leaves/balance-ledger/:employee", (c) => {
    employee(db, c, c.req.param("employee"), "leave.read");
    return c.json({
      items: s.all(
        "SELECT l.*,b.balance_year,t.name_th FROM leave_balance_transactions l JOIN employee_leave_balances b ON b.id=l.employee_leave_balance_id JOIN leave_types t ON t.id=b.leave_type_id WHERE b.employee_id=? ORDER BY l.created_at DESC",
        c.req.param("employee"),
      ),
    });
  });
  app.post("/settings/staffing", async (c) => {
    requirePermission(c, "settings.write");
    const b = z
      .object({
        department_id: z.uuid(),
        minimum_staff_count: z.number().int().min(0),
        maximum_leave_count: z.number().int().min(0).nullable().default(null),
        effective_from: date,
      })
      .strict()
      .parse(await c.req.json());
    companyObject(db, c, "departments", b.department_id);
    const id = uuid();
    s.insert("department_staffing_rules", {
      id,
      organization_id: c.get("company").id,
      ...b,
    });
    audit(
      db,
      c,
      "CREATE",
      "department_staffing_rules",
      id,
      null,
      b,
      "Staffing rule",
    );
    return c.json({ id }, 201);
  });
  app.post("/payroll/:id/return", async (c) => {
    requirePermission(c, "payroll.approve");
    const cycle = companyObject(db, c, "payroll_cycles", c.req.param("id"));
    if (cycle.status !== "PENDING_APPROVAL")
      fail(409, "Payroll is not awaiting approval");
    if (cycle.created_by_user_id === c.get("user").id)
      fail(403, "Independent approver required");
    const b = z
      .object({ reason: text(1000) })
      .strict()
      .parse(await c.req.json());
    db.transaction(() => {
      s.update("payroll_cycles", cycle.id, {
        status: "DRAFT",
        submitted_by_user_id: null,
        submitted_at: null,
        updated_at: now(),
      });
      s.insert("payroll_cycle_status_history", {
        id: uuid(),
        payroll_cycle_id: cycle.id,
        from_status: "PENDING_APPROVAL",
        to_status: "DRAFT",
        comment: b.reason,
        changed_by_user_id: c.get("user").id,
      });
      audit(
        db,
        c,
        "RETURN",
        "payroll_cycles",
        cycle.id,
        { status: cycle.status },
        { status: "DRAFT" },
        b.reason,
      );
    })();
    return c.json({ ok: true });
  });
  app.post("/payslips/:id/revoke", async (c) => {
    requirePermission(c, "payroll.approve");
    const slip = s.one("SELECT * FROM payslips WHERE id=?", c.req.param("id"));
    if (!slip) fail(404, "Payslip unavailable");
    employee(db, c, slip.employee_id, "payroll.read");
    const b = z
      .object({ reason: text(1000) })
      .strict()
      .parse(await c.req.json());
    s.update("payslips", slip.id, {
      revoked_at: now(),
      revoked_by_user_id: c.get("user").id,
      revoked_reason: b.reason,
      delivery_status: "REVOKED",
    });
    audit(
      db,
      c,
      "REVOKE",
      "payslips",
      slip.id,
      null,
      { revoked: true },
      b.reason,
      slip.employee_id,
    );
    return c.json({ ok: true });
  });
  app.post("/notifications/:id/read", (c) => {
    const n = s.one(
      "SELECT * FROM notifications WHERE id=? AND tenant_id=? AND organization_id=? AND user_id=?",
      c.req.param("id"),
      c.get("user").tenant_id,
      c.get("company").id,
      c.get("user").id,
    );
    if (!n) fail(403, "Notification unavailable");
    if (n.source_type === "announcements")
      fail(422, "Open the announcement to mark it read");
    s.update("notifications", n.id, { read_at: n.read_at || now() });
    return c.json({ ok: true });
  });
  return app;
}
