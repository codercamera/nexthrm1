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
  companyObject,
  audit,
  fail,
} from "./core";
import { workday } from "./time";
const range = (start: string, end: string) => {
  const days: string[] = [];
  for (let d = Date.parse(start); d <= Date.parse(end); d += 86400000)
    days.push(new Date(d).toISOString().slice(0, 10));
  return days;
};
export function payrollRoutes(db: Database) {
  const app = new Hono<Env>(),
    s = store(db);
  const cycle = (c: C) =>
    companyObject(db, c, "payroll_cycles", c.req.param("id")!);
  const change = (c: C, r: Row, status: string, comment: string) => {
    s.update("payroll_cycles", r.id, { status, updated_at: now() });
    s.insert("payroll_cycle_status_history", {
      id: uuid(),
      payroll_cycle_id: r.id,
      from_status: r.status,
      to_status: status,
      comment,
      changed_by_user_id: c.get("user").id,
      changed_at: now(),
    });
    audit(
      db,
      c,
      status,
      "payroll_cycles",
      r.id,
      { status: r.status },
      { status },
      comment,
    );
  };
  app.get("/", (c) => {
    requirePermission(c, "payroll.read");
    return c.json({
      items: s.all(
        "SELECT p.*,r.employee_count,r.total_net_satang,r.blocking_error_count,r.warning_count FROM payroll_cycles p LEFT JOIN payroll_calculation_runs r ON r.payroll_cycle_id=p.id AND r.version_no=p.current_calculation_version WHERE p.organization_id=? ORDER BY p.period_start DESC LIMIT 100",
        c.get("company").id,
      ),
    });
  });
  app.post("/", async (c) => {
    requirePermission(c, "payroll.prepare");
    const b = z
      .object({
        code: text(50),
        name: text(),
        cycle_type: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]),
        period_start: date,
        period_end: date,
        pay_date: date,
        employee_ids: z.array(z.uuid()).min(1).max(5000),
      })
      .strict()
      .parse(await c.req.json());
    if (
      b.period_end < b.period_start ||
      b.pay_date < b.period_end ||
      Date.parse(b.period_end) - Date.parse(b.period_start) > 31 * 86400000
    )
      fail(422, "Invalid payroll period");
    for (const id of b.employee_ids) employee(db, c, id);
    const id = uuid();
    db.transaction(() => {
      if (
        s.one(
          "SELECT 1 FROM payroll_cycles WHERE organization_id=? AND cycle_type=? AND status<>'CANCELLED' AND period_start<=? AND period_end>=?",
          c.get("company").id,
          b.cycle_type,
          b.period_end,
          b.period_start,
        )
      )
        fail(409, "Payroll periods overlap");
      const { employee_ids, ...fields } = b;
      s.insert("payroll_cycles", {
        id,
        organization_id: c.get("company").id,
        ...fields,
        created_by_user_id: c.get("user").id,
      });
      for (const employee_id of new Set(employee_ids))
        s.insert("payroll_cycle_employees", {
          payroll_cycle_id: id,
          employee_id,
        });
      s.insert("payroll_cycle_status_history", {
        id: uuid(),
        payroll_cycle_id: id,
        to_status: "DRAFT",
        changed_by_user_id: c.get("user").id,
      });
      audit(
        db,
        c,
        "CREATE",
        "payroll_cycles",
        id,
        null,
        fields,
        "Payroll created",
      );
    })();
    return c.json({ id }, 201);
  });
  app.get("/:id", (c) => {
    requirePermission(c, "payroll.read");
    const r = cycle(c);
    return c.json({
      ...r,
      versions: s.all(
        "SELECT * FROM payroll_calculation_runs WHERE payroll_cycle_id=? ORDER BY version_no DESC",
        r.id,
      ),
      results: s.all(
        "SELECT pr.*,e.employee_no,e.first_name_th,e.last_name_th FROM payroll_results pr JOIN payroll_calculation_runs cr ON cr.id=pr.calculation_run_id JOIN employees e ON e.id=pr.employee_id WHERE pr.payroll_cycle_id=? AND cr.version_no=?",
        r.id,
        Number(c.req.query("version")) || r.current_calculation_version,
      ),
      history: s.all(
        "SELECT h.*,u.display_name FROM payroll_cycle_status_history h LEFT JOIN users u ON u.id=h.changed_by_user_id WHERE h.payroll_cycle_id=? ORDER BY h.changed_at",
        r.id,
      ),
      approvals: s.all(
        "SELECT a.*,u.display_name FROM payroll_approvals a JOIN users u ON u.id=a.approver_user_id WHERE a.payroll_cycle_id=? ORDER BY a.step_no",
        r.id,
      ),
    });
  });
  app.post("/:id/adjustments", async (c) => {
    requirePermission(c, "payroll.prepare");
    const r = cycle(c);
    if (!["DRAFT", "REVIEW"].includes(r.status)) fail(409, "Payroll is locked");
    const b = z
      .object({
        employee_id: z.uuid(),
        item_type: z.enum(["EARNING", "DEDUCTION"]),
        item_code: text(50),
        description: text(),
        amount_satang: money,
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    employee(db, c, b.employee_id);
    if (
      !s.one(
        "SELECT 1 FROM payroll_cycle_employees WHERE payroll_cycle_id=? AND employee_id=?",
        r.id,
        b.employee_id,
      )
    )
      fail(422, "Employee is not in this cycle");
    db.transaction(() => {
      s.insert("payroll_adjustments", {
        id: uuid(),
        payroll_cycle_id: r.id,
        ...b,
        created_by_user_id: c.get("user").id,
      });
      change(c, r, "DRAFT", b.reason);
    })();
    return c.json({ ok: true });
  });
  app.post("/:id/calculate", (c) => {
    requirePermission(c, "payroll.prepare");
    const r = cycle(c);
    if (!["DRAFT", "REVIEW"].includes(r.status)) fail(409, "Payroll is locked");
    const run = db.transaction(() => {
      const settings = s.one(
        "SELECT * FROM organization_settings WHERE organization_id=?",
        r.organization_id,
      )!;
      const config = JSON.parse(settings.settings_json).payroll;
      if (
        !config ||
        !Number.isInteger(config.social_security_rate_basis_points) ||
        !Number.isInteger(config.social_security_cap_satang) ||
        !config.effective_from ||
        config.effective_from > r.period_start ||
        !config.verified_by ||
        !config.source_reference
      )
        fail(
          422,
          "Configure and verify payroll statutory parameters for this period first",
        );
      change(c, r, "CALCULATING", "Calculation started");
      const version = r.current_calculation_version + 1,
        run = uuid();
      s.insert("payroll_calculation_runs", {
        id: run,
        payroll_cycle_id: r.id,
        version_no: version,
        triggered_by_user_id: c.get("user").id,
      });
      let totalIncome = 0,
        totalDeduction = 0,
        totalNet = 0,
        blocked = 0,
        warnings = 0,
        count = 0;
      for (const member of s.all(
        "SELECT e.* FROM payroll_cycle_employees p JOIN employees e ON e.id=p.employee_id WHERE p.payroll_cycle_id=? AND p.inclusion_status='INCLUDED'",
        r.id,
      )) {
        if (member.organization_id !== r.organization_id)
          fail(403, "Cross-company payroll employee");
        const alerts: Row[] = [];
        const compensation = s.all(
          "SELECT * FROM compensation_history WHERE employee_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from",
          member.id,
          r.period_end,
          r.period_start,
        );
        const bank = s.one(
          "SELECT * FROM employee_bank_accounts WHERE employee_id=? AND is_primary=1 AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
          member.id,
          r.pay_date,
          r.pay_date,
        );
        if (!bank?.verified_at)
          alerts.push({
            level: "BLOCKED",
            message: "Missing verified bank account",
          });
        let base = 0,
          allowances = 0,
          ot = 0,
          unpaid = 0;
        for (const day of range(r.period_start, r.period_end)) {
          if (
            day < member.hire_date ||
            (member.termination_date && day > member.termination_date)
          )
            continue;
          const ch = compensation.find(
            (ch) =>
              ch.effective_from <= day &&
              (!ch.effective_to || ch.effective_to >= day),
          );
          if (!ch) {
            alerts.push({
              level: "BLOCKED",
              message: "Missing compensation on " + day,
            });
            continue;
          }
          let schedule: Row;
          try {
            schedule = workday(db, member, day);
          } catch {
            alerts.push({
              level: "BLOCKED",
              message: "Missing work schedule on " + day,
            });
            continue;
          }
          const attendance = s.one(
            "SELECT * FROM attendance_records WHERE employee_id=? AND work_date=?",
            member.id,
            day,
          );
          if (
            schedule.is_workday &&
            day <= today() &&
            (!attendance ||
              ["PENDING", "INCOMPLETE", "ABSENT"].includes(attendance.status))
          )
            alerts.push({
              level: "BLOCKED",
              message: "Unresolved attendance on " + day,
            });
          const monthDays = new Date(
            Number(day.slice(0, 4)),
            Number(day.slice(5, 7)),
            0,
          ).getDate();
          if (ch.pay_type === "MONTHLY") {
            base += ch.base_salary_satang / monthDays;
            allowances +=
              JSON.parse(ch.regular_allowances_json).reduce(
                (n: number, a: Row) => n + a.amount_satang,
                0,
              ) / monthDays;
          } else if (
            ch.pay_type === "DAILY" &&
            attendance?.status === "PRESENT"
          )
            base += ch.daily_rate_satang;
          else if (ch.pay_type === "HOURLY" && attendance?.status === "PRESENT")
            base += (ch.hourly_rate_satang * attendance.worked_minutes) / 60;
          const unpaidLeave = s.one(
            "SELECT COALESCE(SUM(d.leave_minutes),0) n FROM leave_request_days d JOIN leave_requests lr ON lr.id=d.leave_request_id WHERE lr.employee_id=? AND lr.status='APPROVED' AND d.is_paid=0 AND d.leave_date=?",
            member.id,
            day,
          )!.n;
          if (ch.pay_type === "MONTHLY")
            unpaid +=
              ((ch.base_salary_satang / monthDays) * unpaidLeave) /
              settings.standard_work_minutes_per_day;
          const rate =
            ch.pay_type === "MONTHLY"
              ? ch.base_salary_satang /
                30 /
                settings.standard_work_minutes_per_day
              : ch.pay_type === "DAILY"
                ? ch.daily_rate_satang / settings.standard_work_minutes_per_day
                : ch.hourly_rate_satang / 60;
          for (const o of s.all(
            "SELECT * FROM overtime_requests WHERE employee_id=? AND work_date=? AND status='APPROVED'",
            member.id,
            day,
          ))
            ot += o.approved_minutes * rate * o.rate_multiplier;
        }
        base = Math.round(base);
        allowances = Math.round(allowances);
        ot = Math.round(ot);
        unpaid = Math.round(unpaid);
        let earnings = allowances,
          deductions = unpaid;
        const adjustments = s.all(
          "SELECT * FROM payroll_adjustments WHERE payroll_cycle_id=? AND employee_id=? AND status='ACTIVE'",
          r.id,
          member.id,
        );
        for (const a of adjustments) {
          if (a.item_type === "EARNING") earnings += a.amount_satang;
          else deductions += a.amount_satang;
        }
        const gross = base + earnings + ot,
          taxProfile = s.one(
            "SELECT * FROM employee_tax_profiles WHERE employee_id=? AND effective_from<=?",
            member.id,
            r.period_start,
          ),
          social = s.one(
            "SELECT * FROM employee_social_security_profiles WHERE employee_id=? AND effective_from<=?",
            member.id,
            r.period_start,
          );
        let tax = 0;
        if (!taxProfile)
          alerts.push({
            level: "BLOCKED",
            message: "Missing verified tax profile",
          });
        else if (taxProfile.tax_method === "FIXED")
          tax = Math.round(
            (gross * (taxProfile.fixed_tax_rate_basis_points || 0)) / 10000,
          );
        else if (taxProfile.tax_method === "PROGRESSIVE") {
          const snapshot = JSON.parse(taxProfile.deductions_json);
          if (
            !Number.isInteger(snapshot.withholding_satang) ||
            snapshot.period_start !== r.period_start ||
            snapshot.period_end !== r.period_end ||
            !snapshot.verified_by
          )
            alerts.push({
              level: "BLOCKED",
              message:
                "Progressive withholding requires reviewed amount for this exact period",
            });
          else tax = snapshot.withholding_satang;
        }
        if (!social)
          alerts.push({
            level: "BLOCKED",
            message: "Missing social security profile",
          });
        const ss = social?.contribution_enabled
          ? Math.min(
              Math.round(
                (gross * config.social_security_rate_basis_points) / 10000,
              ),
              Math.round(
                (config.social_security_cap_satang *
                  range(r.period_start, r.period_end).length) /
                  new Date(
                    Number(r.period_start.slice(0, 4)),
                    Number(r.period_start.slice(5, 7)),
                    0,
                  ).getDate(),
              ),
            )
          : 0;
        const net = gross - deductions - tax - ss;
        if (net < 0)
          alerts.push({ level: "BLOCKED", message: "Negative net pay" });
        const previous = s.one(
          "SELECT pr.net_pay_satang FROM payroll_results pr JOIN payroll_cycles pc ON pc.id=pr.payroll_cycle_id JOIN payroll_calculation_runs cr ON cr.id=pr.calculation_run_id WHERE pr.employee_id=? AND pc.organization_id=? AND pc.status IN ('APPROVED','PAID','CLOSED') AND pc.period_end<? AND cr.version_no=pc.current_calculation_version ORDER BY pc.period_end DESC LIMIT 1",
          member.id,
          r.organization_id,
          r.period_start,
        );
        const ytd = s.one(
          "SELECT COALESCE(SUM(pr.gross_income_satang),0) gross,COALESCE(SUM(pr.tax_satang),0) tax,COALESCE(SUM(pr.social_security_satang),0) ss,COALESCE(SUM(pr.net_pay_satang),0) net FROM payroll_results pr JOIN payroll_cycles pc ON pc.id=pr.payroll_cycle_id JOIN payroll_calculation_runs cr ON cr.id=pr.calculation_run_id WHERE pr.employee_id=? AND pc.organization_id=? AND pc.status IN ('APPROVED','PAID','CLOSED') AND pc.period_end<? AND substr(pc.period_end,1,4)=? AND cr.version_no=pc.current_calculation_version",
          member.id,
          r.organization_id,
          r.period_start,
          r.period_start.slice(0, 4),
        )!;
        const variance = previous ? net - previous.net_pay_satang : null;
        if (previous && Math.abs(variance!) > previous.net_pay_satang * 0.2)
          alerts.push({
            level: "WARNING",
            message: "Net pay changed more than 20%",
          });
        const isBlocked = alerts.some((a) => a.level === "BLOCKED");
        blocked += isBlocked ? 1 : 0;
        warnings += alerts.filter((a) => a.level === "WARNING").length;
        count++;
        const id = uuid();
        s.insert("payroll_results", {
          id,
          calculation_run_id: run,
          payroll_cycle_id: r.id,
          employee_id: member.id,
          base_salary_satang: base,
          additional_income_satang: earnings,
          overtime_satang: ot,
          gross_income_satang: gross,
          other_deduction_satang: deductions,
          tax_satang: tax,
          social_security_satang: ss,
          net_pay_satang: net,
          previous_net_pay_satang: previous?.net_pay_satang ?? null,
          variance_satang: variance,
          review_status: isBlocked
            ? "BLOCKED"
            : alerts.length
              ? "WARNING"
              : "NORMAL",
          warning_json: JSON.stringify(alerts),
          formula_snapshot_json: JSON.stringify({
            method: "monthly-calendar-day-proration",
            compensation,
            config,
            unpaid,
            adjustments,
            statutory: "reviewed-company-parameters",
          }),
          ytd_gross_income_satang: ytd.gross + gross,
          ytd_tax_satang: ytd.tax + tax,
          ytd_social_security_satang: ytd.ss + ss,
          ytd_net_pay_satang: ytd.net + net,
        });
        for (const [code, type, amount] of [
          ["BASE", "EARNING", base],
          ["ALLOWANCES", "EARNING", earnings],
          ["OT", "EARNING", ot],
          ["UNPAID_AND_ADJUSTMENTS", "DEDUCTION", deductions],
          ["TAX", "TAX", tax],
          ["SSO", "SOCIAL_SECURITY", ss],
        ] as const)
          s.insert("payroll_result_items", {
            id: uuid(),
            payroll_result_id: id,
            item_type: type,
            item_code: code,
            item_name: code,
            amount_satang: amount,
            source_type: "CALCULATION",
            source_id: run,
          });
        s.run(
          "UPDATE payroll_cycle_employees SET compensation_history_id=?,bank_account_id=? WHERE payroll_cycle_id=? AND employee_id=?",
          compensation.at(-1)?.id || null,
          bank?.id || null,
          r.id,
          member.id,
        );
        totalIncome += gross;
        totalDeduction += deductions + tax + ss;
        totalNet += net;
      }
      s.update("payroll_calculation_runs", run, {
        status: "COMPLETED",
        employee_count: count,
        total_income_satang: totalIncome,
        total_deduction_satang: totalDeduction,
        total_net_satang: totalNet,
        blocking_error_count: blocked,
        warning_count: warnings,
        completed_at: now(),
      });
      s.update("payroll_cycles", r.id, {
        current_calculation_version: version,
      });
      change(
        c,
        { ...r, status: "CALCULATING" },
        "REVIEW",
        "Version " + version + " calculated",
      );
      return { id: run, version, blocked, warnings };
    })();
    return c.json(run);
  });
  app.post("/:id/review", async (c) => {
    requirePermission(c, "payroll.review");
    const r = cycle(c);
    if (r.status !== "REVIEW") fail(409, "Payroll is not in review");
    if (r.created_by_user_id === c.get("user").id)
      fail(403, "Reviewer must be independent of preparer");
    const b = z.object({ comment: text(1000) }).parse(await c.req.json());
    const run = s.one(
      "SELECT * FROM payroll_calculation_runs WHERE payroll_cycle_id=? AND version_no=?",
      r.id,
      r.current_calculation_version,
    );
    if (!run || run.blocking_error_count)
      fail(422, "Resolve all blocking errors first");
    db.transaction(() => {
      s.run(
        "UPDATE payroll_results SET review_status='REVIEWED' WHERE calculation_run_id=?",
        run.id,
      );
      s.insert("payroll_approvals", {
        id: uuid(),
        payroll_cycle_id: r.id,
        step_no:
          s.one(
            "SELECT COALESCE(MAX(step_no),0) n FROM payroll_approvals WHERE payroll_cycle_id=?",
            r.id,
          )!.n + 1,
        approver_user_id: c.get("user").id,
        decision: "APPROVED",
        comment: b.comment,
        decided_at: now(),
      });
      s.update("payroll_cycles", r.id, {
        submitted_by_user_id: c.get("user").id,
        submitted_at: now(),
      });
      change(c, r, "PENDING_APPROVAL", b.comment);
    })();
    return c.json({ ok: true });
  });
  app.post("/:id/approve", async (c) => {
    requirePermission(c, "payroll.approve");
    const r = cycle(c);
    if (r.status !== "PENDING_APPROVAL")
      fail(409, "Payroll is not pending approval");
    if (
      [r.created_by_user_id, r.submitted_by_user_id].includes(c.get("user").id)
    )
      fail(403, "Approver must be independent of preparer and reviewer");
    const b = z.object({ comment: text(1000) }).parse(await c.req.json());
    db.transaction(() => {
      s.insert("payroll_approvals", {
        id: uuid(),
        payroll_cycle_id: r.id,
        step_no:
          s.one(
            "SELECT COALESCE(MAX(step_no),0) n FROM payroll_approvals WHERE payroll_cycle_id=?",
            r.id,
          )!.n + 1,
        approver_user_id: c.get("user").id,
        decision: "APPROVED",
        comment: b.comment,
        decided_at: now(),
      });
      s.update("payroll_cycles", r.id, {
        approved_by_user_id: c.get("user").id,
        approved_at: now(),
        locked_at: now(),
      });
      change(c, r, "APPROVED", b.comment);
      for (const result of s.all(
        "SELECT pr.*,cr.version_no,e.employee_no FROM payroll_results pr JOIN payroll_calculation_runs cr ON cr.id=pr.calculation_run_id JOIN employees e ON e.id=pr.employee_id WHERE pr.payroll_cycle_id=? AND cr.version_no=?",
        r.id,
        r.current_calculation_version,
      ))
        s.insert("payslips", {
          id: uuid(),
          payroll_cycle_id: r.id,
          payroll_result_id: result.id,
          employee_id: result.employee_id,
          slip_no: r.code + "-" + result.employee_no,
          issued_at: now(),
          published_at: now(),
          delivery_status: "PUBLISHED",
        });
    })();
    return c.json({ ok: true });
  });
  app.post("/:id/status", async (c) => {
    requirePermission(c, "payroll.approve");
    const r = cycle(c),
      b = z
        .object({ status: z.enum(["PAID", "CLOSED"]), reason: text(1000) })
        .parse(await c.req.json());
    if (
      (b.status === "PAID" && r.status !== "APPROVED") ||
      (b.status === "CLOSED" && r.status !== "PAID")
    )
      fail(409, "Invalid payroll transition");
    db.transaction(() => {
      s.update("payroll_cycles", r.id, {
        [b.status === "PAID" ? "paid_at" : "closed_at"]: now(),
      });
      change(c, r, b.status, b.reason);
    })();
    return c.json({ ok: true });
  });
  return app;
}
