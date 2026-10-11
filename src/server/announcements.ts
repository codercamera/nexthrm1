import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { store, uuid, now, type Row } from "./db";
import {
  type Env,
  type C,
  text,
  timestamp,
  requirePermission,
  can,
  companyObject,
  audit,
  fail,
  notification,
} from "./core";
const schema = z
  .object({
    title: text(200),
    body: text(20000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    status: z
      .enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED", "CANCELLED"])
      .default("DRAFT"),
    scheduled_at: timestamp.nullable().default(null),
    expires_at: timestamp.nullable().default(null),
    requires_acknowledgement: z.boolean().default(false),
    targets: z
      .array(
        z.object({
          type: z.enum(["ALL", "BRANCH", "DEPARTMENT", "ROLE", "USER"]),
          id: z.uuid().nullable().default(null),
        }),
      )
      .min(1),
    company_ids: z.array(z.uuid()).min(1).max(100).optional(),
    reason: text(1000).default("Announcement created"),
  })
  .strict();
export function announcementRoutes(
  db: Database,
  push: (tenant: string, company: string, user: string) => void,
) {
  const app = new Hono<Env>(),
    s = store(db);
  const announcement = (c: C) => {
    const a = s.one(
      "SELECT a.* FROM announcements a WHERE a.id=? AND a.tenant_id=? AND (a.organization_id=? OR(a.organization_id IS NULL AND EXISTS(SELECT 1 FROM announcement_revisions r,json_each(r.schedule_snapshot_json,'$.company_ids') j WHERE r.announcement_id=a.id AND r.revision_no=a.current_revision_no AND j.value=?)))",
      c.req.param("id"),
      c.get("user").tenant_id,
      c.get("company").id,
      c.get("company").id,
    );
    if (!a) fail(403, "Announcement outside company");
    if (a.tenant_id !== c.get("user").tenant_id)
      fail(403, "Workspace mismatch");
    if (
      !can(c, "announcements.write") &&
      !s.one(
        "SELECT 1 FROM announcement_company_activity WHERE announcement_id=? AND user_id=? AND organization_id=?",
        a.id,
        c.get("user").id,
        c.get("company").id,
      )
    )
      fail(403, "You are not a recipient");
    return a;
  };
  function recipients(a: Row, targets: Row[]) {
    const ids = new Set<string>();
    for (const t of targets) {
      let sql = `SELECT DISTINCT u.id FROM users u JOIN user_company_access ac ON ac.user_id=u.id LEFT JOIN employees e ON e.id=ac.employee_id WHERE u.tenant_id=? AND u.status='ACTIVE' AND ac.organization_id=? AND ac.access_status='ACTIVE'`,
        args: any[] = [a.tenant_id, a.organization_id];
      if (t.type === "USER") {
        sql += " AND u.id=?";
        args.push(t.id);
      }
      if (t.type === "BRANCH") {
        sql += " AND e.branch_id=?";
        args.push(t.id);
      }
      if (t.type === "DEPARTMENT") {
        sql += " AND e.department_id=?";
        args.push(t.id);
      }
      if (t.type === "ROLE") {
        sql +=
          " AND EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role_id=? AND (ur.organization_id=? OR ur.scope_type='TENANT'))";
        args.push(t.id, a.organization_id);
      }
      for (const row of s.all(sql, ...args)) ids.add(row.id);
    }
    return ids;
  }
  function companies(a: Row): string[] {
    return a.organization_id
      ? [a.organization_id]
      : JSON.parse(
          s.one(
            "SELECT schedule_snapshot_json FROM announcement_revisions WHERE announcement_id=? AND revision_no=?",
            a.id,
            a.current_revision_no || 1,
          )!.schedule_snapshot_json,
        ).company_ids;
  }
  function deliver(a: Row) {
    const targets = s.all(
      "SELECT target_type type,target_id id FROM announcement_targets WHERE announcement_id=?",
      a.id,
    );
    for (const org of companies(a)) {
      for (const id of recipients({ ...a, organization_id: org }, targets)) {
        s.run(
          "INSERT OR IGNORE INTO announcement_user_activity(announcement_id,user_id) VALUES(?,?)",
          a.id,
          id,
        );
        s.run(
          "INSERT OR IGNORE INTO announcement_company_activity(announcement_id,organization_id,user_id) VALUES(?,?,?)",
          a.id,
          org,
          id,
        );
        if (id !== a.created_by_user_id)
          s.run(
            "INSERT OR IGNORE INTO notifications(id,tenant_id,organization_id,user_id,notification_type,title,source_type,source_id,created_at) VALUES(?,?,?,?,'ANNOUNCEMENT',?,'announcements',?,?)",
            uuid(),
            a.tenant_id,
            org,
            id,
            a.title,
            a.id,
            now(),
          );
      }
    }
  }
  function notify(a: Row) {
    for (const row of s.all(
      "SELECT organization_id,user_id FROM announcement_company_activity WHERE announcement_id=?",
      a.id,
    ))
      push(a.tenant_id, row.organization_id, row.user_id);
  }
  function validate(c: C, b: Row) {
    if (b.company_ids) {
      for (const id of b.company_ids) {
        if (
          !s.one(
            "SELECT 1 FROM organizations o JOIN user_company_access a ON a.organization_id=o.id WHERE o.id=? AND o.tenant_id=? AND o.status='ACTIVE' AND a.user_id=? AND a.access_status='ACTIVE'",
            id,
            c.get("user").tenant_id,
            c.get("user").id,
          )
        )
          fail(403, "Group target company access denied");
        if (
          !s.one(
            "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND r.tenant_id=? AND (ur.organization_id=? OR ur.scope_type='TENANT') AND p.code IN ('*','announcements.write')",
            c.get("user").id,
            c.get("user").tenant_id,
            id,
          )
        )
          fail(403, "Group announcement permission denied");
      }
      if (b.targets.some((t: Row) => t.type !== "ALL"))
        fail(
          422,
          "Group announcements require ALL audience; company announcements support granular targets",
        );
    }

    if (
      b.status === "SCHEDULED" &&
      (!b.scheduled_at || Date.parse(b.scheduled_at) <= Date.now())
    )
      fail(422, "Schedule must be in the future");
    if (
      b.expires_at &&
      Date.parse(b.expires_at) <= Date.parse(b.scheduled_at || now())
    )
      fail(422, "Expiry must follow publication");
    for (const t of b.targets) {
      if (t.type === "ALL") {
        if (t.id) fail(422, "ALL must have no target ID");
      } else if (!t.id) fail(422, "Select a target");
      else if (t.type === "BRANCH" || t.type === "DEPARTMENT")
        companyObject(
          db,
          c,
          t.type === "BRANCH" ? "branches" : "departments",
          t.id,
        );
      else if (
        t.type === "USER" &&
        !s.one(
          "SELECT 1 FROM user_company_access a JOIN users u ON u.id=a.user_id WHERE a.organization_id=? AND a.user_id=? AND u.tenant_id=? AND a.access_status='ACTIVE'",
          c.get("company").id,
          t.id,
          c.get("user").tenant_id,
        )
      )
        fail(403, "Target user has no company access");
      else if (
        t.type === "ROLE" &&
        !s.one(
          "SELECT 1 FROM roles WHERE id=? AND tenant_id=?",
          t.id,
          c.get("user").tenant_id,
        )
      )
        fail(403, "Role belongs to another workspace");
    }
  }
  app.get("/", (c) => {
    const admin = can(c, "announcements.write");
    const rows = s.all(
      `SELECT a.*,ac.view_count my_view_count,ac.acknowledged_at my_acknowledged_at FROM announcements a LEFT JOIN announcement_user_activity ac ON ac.announcement_id=a.id AND ac.user_id=? WHERE a.tenant_id=? AND (a.organization_id=? OR(a.organization_id IS NULL AND EXISTS(SELECT 1 FROM announcement_revisions r,json_each(r.schedule_snapshot_json,'$.company_ids') j WHERE r.announcement_id=a.id AND r.revision_no=a.current_revision_no AND j.value=?))) ${admin ? "" : "AND a.status='PUBLISHED' AND (a.expires_at IS NULL OR a.expires_at>?) AND EXISTS(SELECT 1 FROM announcement_company_activity ca WHERE ca.announcement_id=a.id AND ca.organization_id=? AND ca.user_id=?)"} ORDER BY a.created_at DESC LIMIT 100`,
      c.get("user").id,
      c.get("user").tenant_id,
      c.get("company").id,
      c.get("company").id,
      ...(admin ? [] : [now(), c.get("company").id, c.get("user").id]),
    );
    if (admin && rows.length) {
      const activity = s.all(
        "SELECT ca.*,ac.acknowledged_at,u.display_name FROM announcement_company_activity ca JOIN announcement_user_activity ac ON ac.announcement_id=ca.announcement_id AND ac.user_id=ca.user_id JOIN users u ON u.id=ca.user_id JOIN announcements a ON a.id=ca.announcement_id WHERE a.tenant_id=? AND ca.organization_id=?",
        c.get("user").tenant_id,
        c.get("company").id,
      );
      const revisions = s.all(
        "SELECT r.* FROM announcement_revisions r JOIN announcements a ON a.id=r.announcement_id WHERE a.tenant_id=? AND (a.organization_id=? OR a.organization_id IS NULL) AND r.revision_no=a.current_revision_no",
        c.get("user").tenant_id,
        c.get("company").id,
      );
      for (const r of rows) {
        r.activity = activity.filter((a) => a.announcement_id === r.id);
        r.recipient_count = r.activity.length;
        r.unique_viewers = r.activity.filter(
          (a: Row) => a.view_count > 0,
        ).length;
        r.total_views = r.activity.reduce(
          (n: number, a: Row) => n + a.view_count,
          0,
        );
        const rev = revisions.find((v) => v.announcement_id === r.id);
        r.targets = JSON.parse(rev?.target_snapshot_json || "[]");
        r.company_ids = JSON.parse(
          rev?.schedule_snapshot_json || "{}",
        ).company_ids;
      }
    }
    return c.json({ items: rows });
  });
  app.post("/", async (c) => {
    requirePermission(c, "announcements.write");
    const b = schema.parse(await c.req.json());
    validate(c, b);
    const id = uuid();
    db.transaction(() => {
      const { targets, reason, company_ids, ...data } = b;
      const a = s.insert("announcements", {
        id,
        tenant_id: c.get("user").tenant_id,
        organization_id: company_ids ? null : c.get("company").id,
        ...data,
        requires_acknowledgement: b.requires_acknowledgement ? 1 : 0,
        published_at: b.status === "PUBLISHED" ? now() : null,
        created_by_user_id: c.get("user").id,
      });
      for (const t of targets)
        s.insert("announcement_targets", {
          id: uuid(),
          announcement_id: id,
          target_type: t.type,
          target_id: t.id,
        });
      s.insert("announcement_revisions", {
        id: uuid(),
        announcement_id: id,
        revision_no: 1,
        title: b.title,
        body: b.body,
        target_snapshot_json: JSON.stringify(targets),
        schedule_snapshot_json: JSON.stringify({
          company_ids: company_ids || [c.get("company").id],
        }),
        created_by_user_id: c.get("user").id,
      });
      if (b.status === "PUBLISHED") deliver(a);
      audit(db, c, "CREATE", "announcements", id, null, b, reason);
    })();
    notify(s.one("SELECT * FROM announcements WHERE id=?", id)!);
    return c.json({ id }, 201);
  });
  app.put("/:id", async (c) => {
    requirePermission(c, "announcements.write");
    const a = announcement(c),
      b = schema.parse(await c.req.json());
    validate(c, b);
    if (a.organization_id === null && !b.company_ids)
      fail(422, "Group announcement company targets must be preserved");
    if (a.organization_id !== null && b.company_ids)
      fail(422, "Cannot change announcement scope");
    if (a.published_at) {
      const prior = s.one(
        "SELECT * FROM announcement_revisions WHERE announcement_id=? AND revision_no=?",
        a.id,
        a.current_revision_no,
      )!;
      if (
        JSON.stringify(b.targets) !== prior.target_snapshot_json ||
        JSON.stringify(b.company_ids || [a.organization_id]) !==
          JSON.stringify(JSON.parse(prior.schedule_snapshot_json).company_ids)
      )
        fail(
          422,
          "Published audience is immutable; create another announcement for new recipients",
        );
    }
    db.transaction(() => {
      const { targets, reason, company_ids, ...data } = b;
      const patch = {
        ...data,
        requires_acknowledgement: b.requires_acknowledgement ? 1 : 0,
        current_revision_no: a.current_revision_no + 1,
        published_at: b.status === "PUBLISHED" ? a.published_at || now() : null,
        updated_by_user_id: c.get("user").id,
        updated_at: now(),
      };
      s.update("announcements", a.id, patch);
      s.run("DELETE FROM announcement_targets WHERE announcement_id=?", a.id);
      for (const t of targets)
        s.insert("announcement_targets", {
          id: uuid(),
          announcement_id: a.id,
          target_type: t.type,
          target_id: t.id,
        });
      s.insert("announcement_revisions", {
        id: uuid(),
        announcement_id: a.id,
        revision_no: patch.current_revision_no,
        title: b.title,
        body: b.body,
        target_snapshot_json: JSON.stringify(targets),
        schedule_snapshot_json: JSON.stringify({
          company_ids: company_ids || [c.get("company").id],
        }),
        change_summary: reason,
        created_by_user_id: c.get("user").id,
      });
      if (b.status === "PUBLISHED") deliver({ ...a, ...patch });
      audit(db, c, "UPDATE", "announcements", a.id, a, b, reason);
    })();
    notify(s.one("SELECT * FROM announcements WHERE id=?", a.id)!);
    return c.json({ ok: true });
  });
  app.post("/:id/open", (c) => {
    const a = announcement(c);
    if (a.status !== "PUBLISHED" || (a.expires_at && a.expires_at <= now()))
      fail(409, "Announcement is not published");
    if (
      !s.one(
        "SELECT 1 FROM announcement_company_activity WHERE announcement_id=? AND user_id=? AND organization_id=?",
        a.id,
        c.get("user").id,
        c.get("company").id,
      )
    )
      fail(403, "Not a recipient");
    db.transaction(() => {
      s.run(
        "UPDATE announcement_company_activity SET view_count=view_count+1,last_viewed_at=? WHERE announcement_id=? AND organization_id=? AND user_id=?",
        now(),
        a.id,
        c.get("company").id,
        c.get("user").id,
      );
      s.run(
        "UPDATE announcement_user_activity SET view_count=view_count+1,first_viewed_at=COALESCE(first_viewed_at,?),last_viewed_at=? WHERE announcement_id=? AND user_id=?",
        now(),
        now(),
        a.id,
        c.get("user").id,
      );
      s.run(
        "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND tenant_id=? AND organization_id=? AND source_type='announcements' AND source_id=?",
        now(),
        c.get("user").id,
        c.get("user").tenant_id,
        c.get("company").id,
        a.id,
      );
    })();
    push(c.get("user").tenant_id, c.get("company").id, c.get("user").id);
    return c.json({ ok: true });
  });
  app.post("/:id/acknowledge", (c) => {
    const a = announcement(c);
    if (!a.requires_acknowledgement || a.status !== "PUBLISHED")
      fail(409, "Acknowledgement unavailable");
    const ac = s.one(
      "SELECT * FROM announcement_user_activity WHERE announcement_id=? AND user_id=?",
      a.id,
      c.get("user").id,
    );
    if (!ac?.view_count) fail(422, "Open this announcement first");
    s.run(
      "UPDATE announcement_user_activity SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE announcement_id=? AND user_id=?",
      now(),
      a.id,
      c.get("user").id,
    );
    return c.json({ ok: true });
  });
  const tick = () => {
    const due = s.all(
      "SELECT * FROM announcements WHERE status='SCHEDULED' AND scheduled_at<=?",
      now(),
    );
    for (const a of due) {
      const eligible =
        s.one(
          "SELECT 1 FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=? AND u.status='ACTIVE' AND t.status='ACTIVE'",
          a.created_by_user_id,
        ) &&
        companies(a).every(
          (id) =>
            s.one(
              "SELECT 1 FROM user_company_access ac JOIN organizations o ON o.id=ac.organization_id WHERE ac.user_id=? AND ac.organization_id=? AND ac.access_status='ACTIVE' AND o.status='ACTIVE'",
              a.created_by_user_id,
              id,
            ) &&
            s.one(
              "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND r.tenant_id=? AND (ur.organization_id=? OR ur.scope_type='TENANT') AND p.code IN ('*','announcements.write')",
              a.created_by_user_id,
              a.tenant_id,
              id,
            ),
        );
      if (!eligible) {
        db.transaction(() => {
          s.update("announcements", a.id, {
            status: "CANCELLED",
            updated_at: now(),
          });
          s.insert("audit_logs", {
            id: uuid(),
            tenant_id: a.tenant_id,
            organization_id: a.organization_id,
            action: "CANCEL",
            object_type: "announcements",
            object_id: a.id,
            reason: "Scheduled publisher no longer authorized",
            request_id: uuid(),
          });
        })();
        continue;
      }
      db.transaction(() => {
        s.update("announcements", a.id, {
          status: "PUBLISHED",
          published_at: now(),
          updated_at: now(),
        });
        deliver(a);
        s.insert("audit_logs", {
          id: uuid(),
          tenant_id: a.tenant_id,
          organization_id: a.organization_id,
          action: "PUBLISH",
          object_type: "announcements",
          object_id: a.id,
          reason: "Scheduled publication",
          request_id: uuid(),
        });
      })();
      notify(a);
    }
    s.run(
      "UPDATE announcements SET status='ARCHIVED',updated_at=? WHERE status='PUBLISHED' AND expires_at IS NOT NULL AND expires_at<=?",
      now(),
      now(),
    );
  };
  return { app, tick };
}
