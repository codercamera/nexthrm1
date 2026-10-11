import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { store, uuid, now, today, type Row } from "./db";
import {
  type Env,
  type C,
  text,
  date,
  money,
  requirePermission,
  employee,
  audit,
  fail,
} from "./core";
export function transferRoutes(db: Database) {
  const app = new Hono<Env>(),
    s = store(db);
  const destination = (c: C, id: string) => {
    const co = s.one(
      "SELECT o.* FROM organizations o JOIN user_company_access a ON a.organization_id=o.id WHERE o.id=? AND o.tenant_id=? AND o.status='ACTIVE' AND a.user_id=? AND a.access_status='ACTIVE'",
      id,
      c.get("user").tenant_id,
      c.get("user").id,
    );
    if (!co) fail(403, "Destination company access denied");
    const grant = s.one(
      "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND r.tenant_id=? AND (ur.organization_id=? OR ur.scope_type='TENANT') AND ur.scope_type IN ('TENANT','COMPANY') AND p.code IN ('*','employees.write')",
      c.get("user").id,
      c.get("user").tenant_id,
      id,
    );
    if (!grant) fail(403, "Destination employee permission required");
    return co;
  };
  app.get("/transfers", (c) => {
    requirePermission(c, "employees.write");
    return c.json({
      items: s.all(
        "SELECT t.*,e.first_name_th,e.last_name_th,o.display_name destination_company FROM intercompany_employee_transfers t JOIN employees e ON e.id=t.source_employee_id JOIN organizations o ON o.id=t.destination_organization_id WHERE t.tenant_id=? AND t.source_organization_id=? ORDER BY t.requested_at DESC LIMIT 100",
        c.get("user").tenant_id,
        c.get("company").id,
      ),
    });
  });
  app.post("/transfers", async (c) => {
    requirePermission(c, "employees.write");
    const b = z
      .object({
        employee_id: z.uuid(),
        destination_organization_id: z.uuid(),
        effective_date: date,
        transfer_type: z.enum(["TRANSFER", "SECONDMENT", "DUAL_EMPLOYMENT"]),
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    const e = employee(db, c, b.employee_id);
    destination(c, b.destination_organization_id);
    if (e.organization_id === b.destination_organization_id)
      fail(422, "Select a different destination company");
    if (b.effective_date < e.hire_date)
      fail(422, "Transfer precedes hire date");
    const id = uuid();
    s.insert("intercompany_employee_transfers", {
      id,
      tenant_id: c.get("user").tenant_id,
      person_id: e.person_id,
      source_employee_id: e.id,
      source_organization_id: e.organization_id,
      destination_organization_id: b.destination_organization_id,
      effective_date: b.effective_date,
      transfer_type: b.transfer_type,
      reason: b.reason,
      status: "PENDING",
      requested_by_user_id: c.get("user").id,
    });
    audit(
      db,
      c,
      "REQUEST",
      "intercompany_employee_transfers",
      id,
      null,
      b,
      b.reason,
      e.id,
    );
    return c.json({ id }, 201);
  });
  app.post("/transfers/:id/approve", async (c) => {
    requirePermission(c, "employees.write");
    const r = s.one(
      "SELECT * FROM intercompany_employee_transfers WHERE id=? AND tenant_id=? AND source_organization_id=?",
      c.req.param("id"),
      c.get("user").tenant_id,
      c.get("company").id,
    );
    if (!r) fail(403, "Transfer outside company");
    const e = employee(db, c, r.source_employee_id);
    destination(c, r.destination_organization_id);
    if (r.status !== "PENDING") fail(409, "Transfer already processed");
    if (r.requested_by_user_id === c.get("user").id)
      fail(403, "Transfer requires an independent approver");
    if (r.effective_date > today())
      fail(422, "Execute transfer on or after its effective date");
    const b = z
      .object({
        salary_satang: money.refine((v) => v > 0),
        pay_type: z.enum(["MONTHLY", "DAILY", "HOURLY"]),
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    const id = db.transaction(() => {
      const id = uuid(),
        number =
          "EMP-" +
          String(
            s.one(
              "SELECT COUNT(*) n FROM employees WHERE organization_id=?",
              r.destination_organization_id,
            )!.n + 1,
          ).padStart(5, "0");
      s.insert("employees", {
        id,
        organization_id: r.destination_organization_id,
        person_id: e.person_id,
        user_id: e.user_id,
        employee_no: number,
        first_name_th: e.first_name_th,
        last_name_th: e.last_name_th,
        company_email: e.company_email,
        personal_email: e.personal_email,
        mobile_phone: e.mobile_phone,
        national_id_encrypted: e.national_id_encrypted,
        employment_type: e.employment_type,
        employment_status: "ACTIVE",
        hire_date: r.effective_date,
        created_by_user_id: c.get("user").id,
      });
      s.insert("compensation_history", {
        id: uuid(),
        employee_id: id,
        effective_from: r.effective_date,
        pay_type: b.pay_type,
        base_salary_satang: b.pay_type === "MONTHLY" ? b.salary_satang : 0,
        daily_rate_satang: b.pay_type === "DAILY" ? b.salary_satang : null,
        hourly_rate_satang: b.pay_type === "HOURLY" ? b.salary_satang : null,
        reason: b.reason,
        created_by_user_id: c.get("user").id,
      });
      for (const [employee_id, event] of [
        [e.id, "TRANSFERRED"],
        [id, "HIRED"],
      ])
        s.insert("employment_history", {
          id: uuid(),
          employee_id,
          event_type: event,
          effective_from: r.effective_date,
          reason: b.reason,
          created_by_user_id: c.get("user").id,
        });
      if (r.transfer_type === "TRANSFER") {
        s.update("employees", e.id, {
          employment_status: "TERMINATED",
          termination_date: r.effective_date,
          termination_reason: r.reason,
          updated_at: now(),
        });
        s.run(
          "UPDATE user_company_access SET access_status='REVOKED',is_default=0,revoked_at=? WHERE employee_id=?",
          now(),
          e.id,
        );
      }
      if (e.user_id) {
        s.run(
          "INSERT INTO user_company_access(id,user_id,organization_id,employee_id,granted_by_user_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET employee_id=excluded.employee_id,access_status='ACTIVE'",
          uuid(),
          e.user_id,
          r.destination_organization_id,
          id,
          c.get("user").id,
        );
        const role = s.one(
          "SELECT id FROM roles WHERE tenant_id=? AND code='EMPLOYEE'",
          r.tenant_id,
        )!;
        s.run(
          "INSERT OR IGNORE INTO user_roles(id,user_id,role_id,organization_id,scope_type) VALUES(?,?,?,?,'SELF')",
          uuid(),
          e.user_id,
          role.id,
          r.destination_organization_id,
        );
      }
      for (const p of s.all(
        "SELECT * FROM leave_policies WHERE organization_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
        r.destination_organization_id,
        r.effective_date,
        r.effective_date,
      )) {
        const bal = uuid();
        s.insert("employee_leave_balances", {
          id: bal,
          employee_id: id,
          leave_type_id: p.leave_type_id,
          balance_year: Number(r.effective_date.slice(0, 4)),
          opening_minutes:
            p.accrual_method === "ANNUAL" && !p.minimum_service_days
              ? p.annual_entitlement_minutes
              : 0,
        });
        s.insert("leave_balance_transactions", {
          id: uuid(),
          employee_leave_balance_id: bal,
          transaction_type: "OPENING",
          minutes:
            p.accrual_method === "ANNUAL" && !p.minimum_service_days
              ? p.annual_entitlement_minutes
              : 0,
          reason: "New destination employment",
          created_by_user_id: c.get("user").id,
        });
      }
      s.update("intercompany_employee_transfers", r.id, {
        status: "COMPLETED",
        destination_employee_id: id,
        approved_by_user_id: c.get("user").id,
        approved_at: now(),
        completed_at: now(),
      });
      audit(
        db,
        c,
        "COMPLETE",
        "intercompany_employee_transfers",
        r.id,
        r,
        { destination_employee_id: id },
        b.reason,
        e.id,
      );
      s.insert("audit_logs", {
        id: uuid(),
        tenant_id: r.tenant_id,
        organization_id: r.destination_organization_id,
        actor_user_id: c.get("user").id,
        action: "TRANSFER_IN",
        object_type: "employees",
        object_id: id,
        employee_id: id,
        reason: b.reason,
        request_id: c.get("requestId"),
      });
      return id;
    })();
    return c.json({ id }, 201);
  });
  return app;
}
