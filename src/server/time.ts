import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { store, uuid, now, today, type Row } from "./db";
import {
  type Env,
  type C,
  text,
  date,
  timestamp,
  requirePermission,
  can,
  employee,
  scopeSql,
  companyObject,
  audit,
  fail,
  notification,
  page,
} from "./core";
export function workday(db: Database, e: Row, day: string): Row {
  const s = store(db),
    assignment = s.one(
      "SELECT * FROM employee_schedule_assignments WHERE employee_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1",
      e.id,
      day,
      day,
    );
  const holiday = s.one(
    "SELECT * FROM holidays WHERE organization_id=? AND holiday_date=? AND (branch_id IS NULL OR branch_id=?)",
    e.organization_id,
    day,
    e.branch_id,
  );
  if (holiday)
    return {
      is_workday: 0,
      start_time: "09:00",
      end_time: "18:00",
      break_minutes: 60,
      grace_late_minutes: 0,
    };
  if (!assignment)
    fail(
      422,
      "Assign a work schedule before requesting leave or calculating payroll",
    );
  const schedule = s.one(
    "SELECT * FROM work_schedules WHERE id=? AND organization_id=?",
    assignment.work_schedule_id,
    e.organization_id,
  )!;
  const weekday = new Date(day + "T00:00:00Z").getUTCDay() || 7,
    dayRow = s.one(
      "SELECT * FROM work_schedule_days WHERE work_schedule_id=? AND weekday=?",
      schedule.id,
      weekday,
    );
  if (!dayRow) fail(422, "Schedule day is not configured");
  return { ...schedule, ...dayRow };
}
export function timeRoutes(db: Database) {
  const app = new Hono<Env>(),
    s = store(db);
  const visible = (c: C, p: string) => scopeSql(c, p);
  app.get("/attendance", (c) => {
    const scope = visible(c, "attendance.read"),
      { limit, offset } = page(c);
    return c.json({
      items: s.all(
        `SELECT a.*,e.first_name_th,e.last_name_th,e.employee_no FROM attendance_records a JOIN employees e ON e.id=a.employee_id JOIN organizations o ON o.id=e.organization_id WHERE e.organization_id=? AND o.tenant_id=? AND ${scope.sql} AND (?='' OR a.work_date=?) ORDER BY a.work_date DESC,e.employee_no LIMIT ? OFFSET ?`,
        c.get("company").id,
        c.get("user").tenant_id,
        ...scope.args,
        c.req.query("date") || "",
        c.req.query("date") || "",
        limit,
        offset,
      ),
    });
  });
  app.post("/attendance/clock", async (c) => {
    const b = z
        .object({ action: z.enum(["IN", "OUT"]) })
        .strict()
        .parse(await c.req.json()),
      id = c.get("access").employee_id;
    if (!id) fail(422, "Link your account to an employee first");
    const e = employee(db, c, id),
      day = today(),
      schedule = workday(db, e, day);
    if (!schedule.is_workday) fail(422, "Today is a non-working day");
    const result = db.transaction(() => {
      const existing = s.one(
        "SELECT * FROM attendance_records WHERE employee_id=? AND work_date=?",
        id,
        day,
      );
      if (b.action === "IN") {
        if (existing) fail(409, "Already clocked in");
        const start = new Date(
            day + "T" + schedule.start_time + ":00+07:00",
          ).toISOString(),
          end = new Date(
            day + "T" + schedule.end_time + ":00+07:00",
          ).toISOString();
        const row = s.insert("attendance_records", {
          id: uuid(),
          employee_id: id,
          work_date: day,
          check_in_at: now(),
          scheduled_start_at: start,
          scheduled_end_at: end,
          late_minutes: Math.max(
            0,
            Math.floor((Date.now() - Date.parse(start)) / 60000) -
              schedule.grace_late_minutes,
          ),
          source: "WEB",
          status: "INCOMPLETE",
        });
        audit(
          db,
          c,
          "CLOCK_IN",
          "attendance_records",
          row.id,
          null,
          row,
          "Web clock",
          id,
        );
        return row;
      }
      if (!existing || existing.check_out_at)
        fail(409, "Clock in first; each day permits one clock-out");
      const patch = {
        check_out_at: now(),
        worked_minutes: Math.max(
          0,
          Math.floor((Date.now() - Date.parse(existing.check_in_at)) / 60000) -
            schedule.break_minutes,
        ),
        early_leave_minutes: Math.max(
          0,
          Math.floor(
            (Date.parse(existing.scheduled_end_at) - Date.now()) / 60000,
          ),
        ),
        status: "PRESENT",
        updated_at: now(),
      };
      s.update("attendance_records", existing.id, patch);
      audit(
        db,
        c,
        "CLOCK_OUT",
        "attendance_records",
        existing.id,
        existing,
        patch,
        "Web clock",
        id,
      );
      return { ...existing, ...patch };
    })();
    return c.json(result);
  });
  app.post("/attendance/manual", async (c) => {
    requirePermission(c, "attendance.write");
    const b = z
      .object({
        employee_id: z.uuid(),
        work_date: date,
        check_in_at: timestamp,
        check_out_at: timestamp,
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    const e = employee(db, c, b.employee_id, "attendance.read");
    const schedule = workday(db, e, b.work_date);
    if (Date.parse(b.check_out_at) <= Date.parse(b.check_in_at))
      fail(422, "Clock-out must follow clock-in");
    const start = new Date(
        b.work_date + "T" + schedule.start_time + ":00+07:00",
      ).toISOString(),
      end = new Date(
        b.work_date + "T" + schedule.end_time + ":00+07:00",
      ).toISOString();
    db.transaction(() => {
      const old = s.one(
          "SELECT * FROM attendance_records WHERE employee_id=? AND work_date=?",
          e.id,
          b.work_date,
        ),
        patch = {
          check_in_at: b.check_in_at,
          check_out_at: b.check_out_at,
          scheduled_start_at: start,
          scheduled_end_at: end,
          worked_minutes: Math.max(
            0,
            Math.floor(
              (Date.parse(b.check_out_at) - Date.parse(b.check_in_at)) / 60000,
            ) - schedule.break_minutes,
          ),
          late_minutes: Math.max(
            0,
            Math.floor(
              (Date.parse(b.check_in_at) - Date.parse(start)) / 60000,
            ) - schedule.grace_late_minutes,
          ),
          status: "PRESENT",
          source: "MANUAL",
          note: b.reason,
          approved_by_user_id: c.get("user").id,
          updated_at: now(),
        };
      if (old) s.update("attendance_records", old.id, patch);
      else
        s.insert("attendance_records", {
          id: uuid(),
          employee_id: e.id,
          work_date: b.work_date,
          ...patch,
        });
      audit(
        db,
        c,
        "CORRECT",
        "attendance_records",
        old?.id || e.id,
        old,
        patch,
        b.reason,
        e.id,
      );
    })();
    return c.json({ ok: true });
  });
  app.get("/overtime", (c) => {
    const scope = visible(c, "attendance.read");
    return c.json({
      items: s.all(
        `SELECT r.*,e.first_name_th,e.last_name_th FROM overtime_requests r JOIN employees e ON e.id=r.employee_id JOIN organizations o ON o.id=e.organization_id WHERE e.organization_id=? AND o.tenant_id=? AND ${scope.sql} ORDER BY r.work_date DESC LIMIT 100`,
        c.get("company").id,
        c.get("user").tenant_id,
        ...scope.args,
      ),
    });
  });
  app.post("/overtime", async (c) => {
    const b = z
      .object({
        employee_id: z.uuid(),
        work_date: date,
        start_at: timestamp,
        end_at: timestamp,
        reason: text(1000),
      })
      .parse(await c.req.json());
    employee(db, c, b.employee_id, "attendance.read");
    const minutes = Math.floor(
      (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000,
    );
    if (minutes <= 0 || minutes > 1440) fail(422, "Invalid overtime duration");
    if (
      s.one(
        "SELECT 1 FROM overtime_requests WHERE employee_id=? AND status IN ('PENDING','APPROVED') AND start_at<? AND end_at>?",
        b.employee_id,
        b.end_at,
        b.start_at,
      )
    )
      fail(409, "Overlapping overtime request");
    const id = uuid();
    s.insert("overtime_requests", {
      id,
      ...b,
      requested_minutes: minutes,
      status: "PENDING",
      submitted_at: now(),
    });
    audit(
      db,
      c,
      "SUBMIT",
      "overtime_requests",
      id,
      null,
      b,
      b.reason,
      b.employee_id,
    );
    return c.json({ id }, 201);
  });
  app.post("/overtime/:id/decision", async (c) => {
    requirePermission(c, "attendance.write");
    const r = s.one(
      "SELECT * FROM overtime_requests WHERE id=?",
      c.req.param("id"),
    );
    if (!r) fail(404, "Request not found");
    const e = employee(db, c, r.employee_id, "attendance.read");
    if (e.user_id === c.get("user").id)
      fail(403, "Cannot approve your own overtime");
    if (r.status !== "PENDING") fail(409, "Already decided");
    const b = z
      .object({
        decision: z.enum(["APPROVED", "REJECTED"]),
        comment: text(1000),
      })
      .parse(await c.req.json());
    s.update("overtime_requests", r.id, {
      status: b.decision,
      approved_minutes: b.decision === "APPROVED" ? r.requested_minutes : 0,
      decided_at: now(),
      decided_by_user_id: c.get("user").id,
    });
    audit(db, c, b.decision, "overtime_requests", r.id, r, b, b.comment, e.id);
    return c.json({ ok: true });
  });
  app.get("/leaves", (c) => {
    const scope = visible(c, "leave.read"),
      { limit, offset } = page(c);
    return c.json({
      items: s.all(
        `SELECT r.*,t.name_th type_name,t.privacy_level,e.first_name_th,e.last_name_th FROM leave_requests r JOIN employees e ON e.id=r.employee_id JOIN organizations o ON o.id=e.organization_id JOIN leave_types t ON t.id=r.leave_type_id WHERE e.organization_id=? AND o.tenant_id=? AND ${scope.sql} AND (?='' OR r.status=?) ORDER BY r.start_at DESC LIMIT ? OFFSET ?`,
        c.get("company").id,
        c.get("user").tenant_id,
        ...scope.args,
        c.req.query("status") || "",
        c.req.query("status") || "",
        limit,
        offset,
      ),
    });
  });
  app.get("/leaves/calendar", (c) => {
    const start = date.parse(
        c.req.query("start") || today().slice(0, 8) + "01",
      ),
      end = date.parse(c.req.query("end") || today().slice(0, 7) + "-28");
    const scope = visible(c, "leave.read");
    return c.json({
      items: s.all(
        `SELECT r.id,r.employee_id,r.start_at,r.end_at,r.status,e.first_name_th,e.last_name_th,CASE WHEN t.privacy_level='PUBLIC' THEN t.name_th ELSE 'ลา / Leave' END type_name FROM leave_requests r JOIN employees e ON e.id=r.employee_id JOIN organizations o ON o.id=e.organization_id JOIN leave_types t ON t.id=r.leave_type_id WHERE e.organization_id=? AND o.tenant_id=? AND r.status IN ('PENDING','APPROVED') AND date(r.start_at)<=? AND date(r.end_at)>=? ORDER BY r.start_at`,
        c.get("company").id,
        c.get("user").tenant_id,
        end,
        start,
      ),
    });
  });
  app.get("/leaves/:id", (c) => {
    const r = s.one(
      "SELECT * FROM leave_requests WHERE id=?",
      c.req.param("id"),
    );
    if (!r) fail(404, "Request not found");
    employee(db, c, r.employee_id, "leave.read");
    return c.json({
      ...r,
      days: s.all(
        "SELECT * FROM leave_request_days WHERE leave_request_id=?",
        r.id,
      ),
      approvals: s.all(
        "SELECT a.*,u.display_name FROM leave_approvals a JOIN users u ON u.id=a.approver_user_id WHERE leave_request_id=? ORDER BY step_no",
        r.id,
      ),
    });
  });
  app.post("/leaves", async (c) => {
    const b = z
      .object({
        employee_id: z.uuid(),
        leave_type_id: z.uuid(),
        start_date: date,
        end_date: date,
        minutes_per_day: z.number().int().min(1).max(480).default(480),
        start_work_minute: z.number().int().min(0).max(479).default(0),
        reason: text(1000),
        attachment_id: z.uuid().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const e = employee(db, c, b.employee_id, "leave.read"),
      type = companyObject(db, c, "leave_types", b.leave_type_id);
    if (type.status !== "ACTIVE") fail(422, "Leave type inactive");
    if (
      b.end_date < b.start_date ||
      b.start_date.slice(0, 4) !== b.end_date.slice(0, 4) ||
      Date.parse(b.end_date) - Date.parse(b.start_date) > 90 * 86400000
    )
      fail(422, "Leave must fit within one calendar year and 90 days");
    const policy = s.one(
      "SELECT * FROM leave_policies WHERE leave_type_id=? AND organization_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) AND (employment_type IS NULL OR employment_type=?) ORDER BY effective_from DESC LIMIT 1",
      type.id,
      e.organization_id,
      b.start_date,
      b.end_date,
      e.employment_type,
    );
    if (!policy) fail(422, "No applicable leave policy");
    if (
      (Date.parse(b.start_date) - Date.parse(e.hire_date)) / 86400000 <
      policy.minimum_service_days
    )
      fail(422, "Minimum service not reached");
    let attachment: string | null = null;
    if (b.attachment_id) {
      const f = s.one(
        "SELECT * FROM file_attachments WHERE id=? AND tenant_id=? AND organization_id=? AND object_type='employees' AND object_id=?",
        b.attachment_id,
        c.get("user").tenant_id,
        e.organization_id,
        e.id,
      );
      if (!f) fail(403, "Attachment unavailable");
      attachment = f.file_url;
    }
    if (type.requires_attachment && !attachment)
      fail(422, "Attachment required");
    const days: Row[] = [];
    for (
      let d = Date.parse(b.start_date);
      d <= Date.parse(b.end_date);
      d += 86400000
    ) {
      const day = new Date(d).toISOString().slice(0, 10),
        schedule = workday(db, e, day);
      if (schedule.is_workday) days.push({ day, minutes: b.minutes_per_day });
    }
    if (!days.length) fail(422, "No working days selected");
    const minutes = days.length * b.minutes_per_day;
    if (b.start_work_minute + b.minutes_per_day > 480)
      fail(422, "Leave exceeds workday");
    const start = b.start_date + "T00:00:00+07:00",
      end = b.end_date + "T23:59:59+07:00";
    const id = db.transaction(() => {
      for (const d of days)
        if (
          s.one(
            "SELECT 1 FROM leave_request_days ld JOIN leave_requests lr ON lr.id=ld.leave_request_id WHERE lr.employee_id=? AND lr.status IN ('PENDING','APPROVED') AND ld.leave_date=? AND ld.start_work_minute<? AND ld.end_work_minute>?",
            e.id,
            d.day,
            b.start_work_minute + b.minutes_per_day,
            b.start_work_minute,
          )
        )
          fail(409, "Leave dates overlap");
      const balance = s.one(
        "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
        e.id,
        type.id,
        Number(b.start_date.slice(0, 4)),
      );
      const reserved = s.one(
        "SELECT COALESCE(SUM(requested_minutes),0) n FROM leave_requests WHERE employee_id=? AND leave_type_id=? AND status='PENDING' AND substr(start_at,1,4)=?",
        e.id,
        type.id,
        b.start_date.slice(0, 4),
      )!.n;
      if (
        !type.allow_negative_balance &&
        (!balance ||
          balance.opening_minutes +
            balance.accrued_minutes +
            balance.adjusted_minutes +
            balance.carried_forward_minutes -
            balance.used_minutes -
            reserved <
            minutes)
      )
        fail(422, "Insufficient available leave balance");
      const id = uuid();
      s.insert("leave_requests", {
        id,
        employee_id: e.id,
        leave_type_id: type.id,
        start_at: start,
        end_at: end,
        requested_minutes: minutes,
        reason: b.reason,
        attachment_url: attachment,
        status: "PENDING",
        submitted_at: now(),
      });
      for (const d of days)
        s.insert("leave_request_days", {
          id: uuid(),
          leave_request_id: id,
          leave_date: d.day,
          leave_minutes: d.minutes,
          start_work_minute: b.start_work_minute,
          end_work_minute: b.start_work_minute + b.minutes_per_day,
          is_paid: type.is_paid,
        });
      const managers = e.manager_employee_id
        ? s.one(
            "SELECT user_id FROM employees WHERE id=?",
            e.manager_employee_id,
          )
        : null;
      const approvers: string[] = [];
      if (managers?.user_id && managers.user_id !== e.user_id)
        approvers.push(managers.user_id);
      const hr = s.one(
        `SELECT DISTINCT u.id FROM users u JOIN user_company_access a ON a.user_id=u.id JOIN user_roles ur ON ur.user_id=u.id JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE u.tenant_id=? AND u.status='ACTIVE' AND a.organization_id=? AND a.access_status='ACTIVE' AND u.id<>? AND (ur.organization_id=? OR ur.scope_type='TENANT') AND p.code IN ('*','leave.approve') AND ur.scope_type IN ('TENANT','COMPANY') ORDER BY u.id LIMIT 1`,
        c.get("user").tenant_id,
        e.organization_id,
        e.user_id || "",
        e.organization_id,
      );
      if (hr && !approvers.includes(hr.id)) approvers.push(hr.id);
      if (!approvers.length)
        fail(422, "Configure an independent leave approver");
      approvers.forEach((user, i) => {
        s.insert("leave_approvals", {
          id: uuid(),
          leave_request_id: id,
          step_no: i + 1,
          approver_user_id: user,
        });
        notification(
          db,
          c,
          user,
          "LEAVE",
          "คำขอลารออนุมัติ",
          "leave_requests",
          id,
        );
      });
      audit(db, c, "SUBMIT", "leave_requests", id, null, b, b.reason, e.id);
      return id;
    })();
    return c.json({ id }, 201);
  });
  app.post("/leaves/:id/decision", async (c) => {
    requirePermission(c, "leave.approve");
    const r = s.one(
      "SELECT * FROM leave_requests WHERE id=?",
      c.req.param("id"),
    );
    if (!r) fail(404, "Request not found");
    const e = employee(db, c, r.employee_id, "leave.read");
    if (e.user_id === c.get("user").id)
      fail(403, "Cannot approve your own leave");
    const b = z
      .object({
        decision: z.enum(["APPROVED", "REJECTED"]),
        comment: text(1000),
      })
      .parse(await c.req.json());
    db.transaction(() => {
      if (r.status !== "PENDING") fail(409, "Request already decided");
      const step = s.one(
        "SELECT * FROM leave_approvals WHERE leave_request_id=? AND decision='PENDING' ORDER BY step_no LIMIT 1",
        r.id,
      );
      if (!step || step.approver_user_id !== c.get("user").id)
        fail(403, "Waiting for the assigned approver");
      if (b.decision === "APPROVED") {
        const rules = s.all(
          "SELECT * FROM department_staffing_rules WHERE organization_id=? AND department_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
          e.organization_id,
          e.department_id,
          r.start_at.slice(0, 10),
          r.end_at.slice(0, 10),
        );
        for (const d of s.all(
          "SELECT * FROM leave_request_days WHERE leave_request_id=?",
          r.id,
        )) {
          const team = s.one(
            "SELECT COUNT(*) n FROM employees WHERE organization_id=? AND department_id=? AND employment_status='ACTIVE' AND deleted_at IS NULL",
            e.organization_id,
            e.department_id,
          )!.n;
          const absent = s.one(
            "SELECT COUNT(DISTINCT l.employee_id) n FROM leave_requests l JOIN employees x ON x.id=l.employee_id JOIN leave_request_days ld ON ld.leave_request_id=l.id WHERE x.organization_id=? AND x.department_id=? AND l.status='APPROVED' AND ld.leave_date=?",
            e.organization_id,
            e.department_id,
            d.leave_date,
          )!.n;
          for (const rule of rules)
            if (
              team - absent - 1 < rule.minimum_staff_count ||
              (rule.maximum_leave_count !== null &&
                absent + 1 > rule.maximum_leave_count)
            )
              fail(422, "Minimum staffing would be violated");
        }
      }
      s.update("leave_approvals", step.id, {
        decision: b.decision,
        comment: b.comment,
        decided_at: now(),
      });
      const more = s.one(
        "SELECT 1 FROM leave_approvals WHERE leave_request_id=? AND decision='PENDING'",
        r.id,
      );
      const final =
        b.decision === "REJECTED" ? "REJECTED" : more ? "PENDING" : "APPROVED";
      s.update("leave_requests", r.id, { status: final, updated_at: now() });
      if (final === "APPROVED") {
        const bal = s.one(
          "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
          e.id,
          r.leave_type_id,
          Number(r.start_at.slice(0, 4)),
        );
        if (!bal) fail(422, "Balance is not initialized");
        s.run(
          "UPDATE employee_leave_balances SET used_minutes=used_minutes+?,updated_at=? WHERE id=?",
          r.requested_minutes,
          now(),
          bal.id,
        );
        s.insert("leave_balance_transactions", {
          id: uuid(),
          employee_leave_balance_id: bal.id,
          transaction_type: "USAGE",
          minutes: -r.requested_minutes,
          source_type: "leave_requests",
          source_id: r.id,
          created_by_user_id: c.get("user").id,
        });
        for (const d of s.all(
          "SELECT * FROM leave_request_days WHERE leave_request_id=?",
          r.id,
        ))
          s.run(
            "INSERT INTO attendance_records(id,employee_id,work_date,status) VALUES(?,?,?,'LEAVE') ON CONFLICT(employee_id,work_date) DO NOTHING",
            uuid(),
            e.id,
            d.leave_date,
          );
      }
      if (e.user_id)
        notification(db, c, e.user_id, "LEAVE", final, "leave_requests", r.id);
      audit(
        db,
        c,
        b.decision,
        "leave_requests",
        r.id,
        r,
        { status: final },
        b.comment,
        e.id,
      );
    })();
    return c.json({ ok: true });
  });
  app.post("/leaves/:id/cancel", async (c) => {
    const r = s.one(
      "SELECT * FROM leave_requests WHERE id=?",
      c.req.param("id"),
    );
    if (!r) fail(404, "Not found");
    const e = employee(db, c, r.employee_id, "leave.read");
    if (e.user_id !== c.get("user").id && !can(c, "leave.approve"))
      fail(403, "Permission denied");
    const b = z.object({ reason: text(1000) }).parse(await c.req.json());
    db.transaction(() => {
      if (!["PENDING", "APPROVED"].includes(r.status))
        fail(409, "Cannot cancel");
      if (r.status === "APPROVED") {
        const locked = s.one(
          "SELECT 1 FROM payroll_cycles WHERE organization_id=? AND status IN ('APPROVED','PAID','CLOSED') AND period_start<=? AND period_end>=?",
          e.organization_id,
          r.end_at.slice(0, 10),
          r.start_at.slice(0, 10),
        );
        if (locked) fail(409, "Leave is included in locked payroll");
        const bal = s.one(
          "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
          e.id,
          r.leave_type_id,
          Number(r.start_at.slice(0, 4)),
        )!;
        s.run(
          "UPDATE employee_leave_balances SET used_minutes=used_minutes-? WHERE id=?",
          r.requested_minutes,
          bal.id,
        );
        s.insert("leave_balance_transactions", {
          id: uuid(),
          employee_leave_balance_id: bal.id,
          transaction_type: "REVERSAL",
          minutes: r.requested_minutes,
          source_type: "leave_requests",
          source_id: r.id,
          reason: b.reason,
          created_by_user_id: c.get("user").id,
        });
        s.run(
          "DELETE FROM attendance_records WHERE employee_id=? AND status='LEAVE' AND work_date IN (SELECT leave_date FROM leave_request_days WHERE leave_request_id=?)",
          e.id,
          r.id,
        );
      }
      s.update("leave_requests", r.id, {
        status: "CANCELLED",
        cancelled_at: now(),
        updated_at: now(),
      });
      audit(db, c, "CANCEL", "leave_requests", r.id, r, null, b.reason, e.id);
    })();
    return c.json({ ok: true });
  });
  return app;
}
