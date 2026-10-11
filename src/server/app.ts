import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { upgradeWebSocket, websocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { store, uuid, now, today, hash, type Row } from "./db";
import {
  type Env,
  type C,
  text,
  date,
  requirePermission,
  can,
  employee,
  scopeSql,
  audit,
  fail,
} from "./core";
import { employeeRoutes } from "./employees";
import { timeRoutes } from "./time";
import { payrollRoutes } from "./payroll";
import { announcementRoutes } from "./announcements";
import { adminRoutes } from "./admin";
import { transferRoutes } from "./transfers";
import { managementRoutes } from "./management";
export function createApp(
  db: Database,
  options: {
    key: string;
    origin?: string;
    production?: boolean;
    staticRoot?: string;
    storageRoot?: string;
  },
) {
  const app = new Hono<Env>(),
    s = store(db),
    production = options.production ?? false,
    origin = options.origin || "http://localhost:3000",
    storage = resolve(options.storageRoot || "data/files"),
    sockets = new Set<{
      ws: WSContext;
      tenant: string;
      company: string;
      user: string;
      session: string;
    }>();
  const push = (tenant: string, company: string, user: string) => {
    for (const connection of sockets) {
      if (
        connection.tenant !== tenant ||
        connection.company !== company ||
        connection.user !== user
      )
        continue;
      const active = s.one(
        "SELECT 1 FROM user_sessions se JOIN users u ON u.id=se.user_id JOIN user_company_access a ON a.user_id=u.id JOIN organizations o ON o.id=a.organization_id WHERE se.id=? AND se.revoked_at IS NULL AND se.expires_at>? AND u.status='ACTIVE' AND o.status='ACTIVE' AND a.access_status='ACTIVE' AND a.organization_id=? AND u.tenant_id=?",
        connection.session,
        now(),
        company,
        tenant,
      );
      if (active)
        connection.ws.send(JSON.stringify({ type: "notification", company }));
      else connection.ws.close(1008, "Access revoked");
    }
  };
  const announcements = announcementRoutes(db, push);
  app.use("*", async (c, next) => {
    c.set("requestId", uuid());
    c.header("X-Request-ID", c.get("requestId"));
    await next();
  });
  app.use("*", async (c, next) => {
    if (c.req.header("Upgrade")?.toLowerCase() === "websocket") return next();
    return secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    })(c, next);
  });
  app.use("/api/*", bodyLimit({ maxSize: 6 * 1024 * 1024 }));
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const o = c.req.header("Origin");
    if (
      (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) ||
        c.req.header("Upgrade")) &&
      ((o && o !== origin) || c.req.header("Sec-Fetch-Site") === "cross-site")
    )
      fail(403, "Request origin is not allowed");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json(
        { error: error.message, request_id: c.get("requestId") },
        error.status,
      );
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: error.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
          request_id: c.get("requestId"),
        },
        400,
      );
    if (error instanceof SyntaxError)
      return c.json({ error: "Invalid request body" }, 400);
    if (error.message.includes("UNIQUE constraint"))
      return c.json({ error: "A matching record already exists" }, 409);
    if (error.message.includes("constraint failed"))
      return c.json({ error: "Invalid reference or business constraint" }, 422);
    console.error("Request failed", c.get("requestId"), error.message);
    return c.json(
      { error: "Unexpected server error", request_id: c.get("requestId") },
      500,
    );
  });
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  const attempts = new Map<string, { count: number; reset: number }>();
  app.post("/api/auth/login", async (c) => {
    const b = z
      .object({
        workspace: text(100),
        email: z.email().transform((v) => v.toLowerCase()),
        password: z.string().min(1).max(128),
      })
      .strict()
      .parse(await c.req.json());
    const attemptKey = b.workspace + ":" + b.email;
    const current = attempts.get(attemptKey) || {
      count: 0,
      reset: Date.now() + 900000,
    };
    if (current.reset < Date.now()) {
      current.count = 0;
      current.reset = Date.now() + 900000;
    }
    if (current.count >= 10)
      throw new HTTPException(429, {
        message: "Too many attempts. Try again later.",
      });
    current.count++;
    attempts.set(attemptKey, current);
    const user = s.one(
      "SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.code=? AND lower(u.email)=? AND t.status='ACTIVE'",
      b.workspace,
      b.email,
    );
    const valid = user?.password_hash
      ? await Bun.password.verify(b.password, user.password_hash)
      : await Bun.password
          .verify(
            b.password,
            "$argon2id$v=19$m=65536,t=2,p=1$ZHVtbXlkdW1teWR1bW15ZA$N4Fb2W5g6gLXiGFUqTTpa14PrUJekvbWoJvlYSpNhtU",
          )
          .catch(() => false);
    if (
      !user ||
      !valid ||
      user.status !== "ACTIVE" ||
      (user.locked_until && user.locked_until > now())
    ) {
      if (user) {
        // Attempts during an active lock must not restart the 15-minute window.
        const locked = user.locked_until && user.locked_until > now();
        if (!locked && user.status === "ACTIVE" && !valid) {
          const failures = user.locked_until ? 1 : user.failed_login_count + 1;
          s.update("users", user.id, {
            failed_login_count: failures,
            locked_until:
              failures >= 5
                ? new Date(Date.now() + 900000).toISOString()
                : null,
          });
        }
        s.insert("audit_logs", {
          id: uuid(),
          tenant_id: user.tenant_id,
          actor_user_id: user.id,
          action: "LOGIN_FAILED",
          object_type: "users",
          object_id: user.id,
          request_id: c.get("requestId"),
        });
      }
      fail(401, "Invalid credentials or account temporarily locked");
    }
    const token = uuid() + uuid();
    s.insert("user_sessions", {
      id: uuid(),
      user_id: user.id,
      session_token_hash: hash(token),
      expires_at: new Date(Date.now() + 12 * 3600000).toISOString(),
    });
    s.update("users", user.id, {
      failed_login_count: 0,
      locked_until: null,
      last_login_at: now(),
    });
    s.insert("audit_logs", {
      id: uuid(),
      tenant_id: user.tenant_id,
      actor_user_id: user.id,
      action: "LOGIN",
      object_type: "users",
      object_id: user.id,
      request_id: c.get("requestId"),
    });
    attempts.delete(attemptKey);
    setCookie(c, "hrm_session", token, {
      httpOnly: true,
      secure: production,
      sameSite: "Lax",
      path: "/",
      maxAge: 43200,
    });
    return c.json({ ok: true });
  });
  app.post("/api/auth/accept-invitation", async (c) => {
    const b = z
      .object({
        token: text(200),
        display_name: text(),
        password: z.string().min(12).max(128),
      })
      .strict()
      .parse(await c.req.json());
    const inv = s.one(
      "SELECT * FROM user_invitations WHERE token_hash=? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at>?",
      hash(b.token),
      now(),
    );
    if (!inv) fail(400, "Invalid or expired invitation");
    const password_hash = await Bun.password.hash(b.password, {
      algorithm: "argon2id",
    });
    db.transaction(() => {
      if (
        s.one(
          "SELECT 1 FROM users WHERE tenant_id=? AND lower(email)=?",
          inv.tenant_id,
          inv.email,
        )
      )
        fail(409, "Account already exists");
      const id = uuid();
      s.insert("users", {
        id,
        tenant_id: inv.tenant_id,
        email: inv.email,
        display_name: b.display_name,
        password_hash,
        default_organization_id: inv.default_organization_id,
      });
      for (const company of s.all(
        "SELECT * FROM invitation_company_access WHERE invitation_id=?",
        inv.id,
      )) {
        const role = s.one(
          "SELECT * FROM roles WHERE id=? AND tenant_id=?",
          company.role_id,
          inv.tenant_id,
        );
        if (!role) fail(422, "Invitation role unavailable");
        s.insert("user_company_access", {
          id: uuid(),
          user_id: id,
          organization_id: company.organization_id,
          is_default:
            company.organization_id === inv.default_organization_id ? 1 : 0,
          granted_by_user_id: inv.invited_by_user_id,
        });
        s.insert("user_roles", {
          id: uuid(),
          user_id: id,
          role_id: company.role_id,
          organization_id: company.organization_id,
          scope_type: role.code === "EMPLOYEE" ? "SELF" : "COMPANY",
        });
      }
      s.update("user_invitations", inv.id, { accepted_at: now() });
    })();
    return c.json({ ok: true });
  });
  app.post("/api/auth/reset-password", async (c) => {
    const b = z
      .object({ token: text(200), password: z.string().min(12).max(128) })
      .strict()
      .parse(await c.req.json());
    const action = s.one(
      "SELECT * FROM account_action_tokens WHERE token_hash=? AND token_type='PASSWORD_RESET' AND consumed_at IS NULL AND expires_at>?",
      hash(b.token),
      now(),
    );
    if (!action) fail(400, "Invalid or expired reset link");
    const password_hash = await Bun.password.hash(b.password, {
      algorithm: "argon2id",
    });
    db.transaction(() => {
      s.update("users", action.user_id, {
        password_hash,
        password_changed_at: now(),
        failed_login_count: 0,
        locked_until: null,
      });
      s.update("account_action_tokens", action.id, { consumed_at: now() });
      s.run(
        "UPDATE user_sessions SET revoked_at=?,revoked_reason='Password reset' WHERE user_id=? AND revoked_at IS NULL",
        now(),
        action.user_id,
      );
    })();
    return c.json({ ok: true });
  });
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/health")
      return next();
    const token = getCookie(c, "hrm_session");
    if (!token) fail(401, "Sign in required");
    const user = s.one(
      "SELECT u.*,se.id session_id FROM user_sessions se JOIN users u ON u.id=se.user_id JOIN tenants t ON t.id=u.tenant_id WHERE se.session_token_hash=? AND se.revoked_at IS NULL AND se.expires_at>? AND u.status='ACTIVE' AND t.status='ACTIVE'",
      hash(token),
      now(),
    );
    if (!user) fail(401, "Session expired");
    c.set("user", user);
    await next();
  });
  app.get("/api/me", (c) => {
    const u = c.get("user");
    return c.json({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      tenant_id: u.tenant_id,
      companies: s.all(
        "SELECT o.*,a.employee_id FROM user_company_access a JOIN organizations o ON o.id=a.organization_id WHERE a.user_id=? AND a.access_status='ACTIVE' AND o.tenant_id=? AND o.status='ACTIVE' ORDER BY a.is_default DESC,o.display_name",
        u.id,
        u.tenant_id,
      ),
    });
  });
  app.post("/api/logout", (c) => {
    s.update("user_sessions", c.get("user").session_id, {
      revoked_at: now(),
      revoked_reason: "Logout",
    });
    deleteCookie(c, "hrm_session", { path: "/" });
    return c.json({ ok: true });
  });
  app.use("/api/c/:company/*", async (c, next) => {
    const user = c.get("user"),
      co = c.req.param("company");
    const access = s.one(
      "SELECT a.*,o.tenant_id FROM user_company_access a JOIN organizations o ON o.id=a.organization_id WHERE a.user_id=? AND a.organization_id=? AND a.access_status='ACTIVE' AND o.tenant_id=? AND o.status='ACTIVE'",
      user.id,
      co,
      user.tenant_id,
    );
    if (!access) fail(403, "Company access denied");
    const company = s.one(
      "SELECT * FROM organizations WHERE id=? AND tenant_id=?",
      co,
      user.tenant_id,
    )!;
    const grants = s.all(
      "SELECT p.code,ur.scope_type,ur.scope_id,r.code role_code FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? AND r.tenant_id=? AND (ur.organization_id=? OR (ur.scope_type='TENANT' AND ur.organization_id IS NULL))",
      user.id,
      user.tenant_id,
      co,
    );
    c.set("company", company);
    c.set("access", access);
    c.set("grants", grants);
    await next();
  });
  app.use("/api/c/:company/*", async (c, next) => {
    const idempotencyKey = c.req.header("Idempotency-Key");
    if (
      !idempotencyKey ||
      c.req.method !== "POST" ||
      c.req.path.endsWith("/files")
    )
      return next();
    if (idempotencyKey.length > 150) fail(400, "Idempotency key is too long");
    const body = await c.req.raw.clone().text(),
      requestHash = hash(body),
      args = [
        c.get("user").tenant_id,
        c.get("company").id,
        c.get("user").id,
        c.req.path,
        idempotencyKey,
      ];
    const previous = s.one(
      "SELECT * FROM runtime_idempotency WHERE tenant_id=? AND organization_id=? AND user_id=? AND route=? AND key=?",
      ...args,
    );
    if (previous) {
      if (previous.request_hash !== requestHash)
        fail(409, "Idempotency key reused with different content");
      const saved = JSON.parse(previous.response_json);
      return c.json(saved.body, saved.status);
    }
    await next();
    if (
      c.res.ok &&
      c.res.headers.get("Content-Type")?.includes("application/json")
    ) {
      const response = await c.res.clone().json();
      s.insert("runtime_idempotency", {
        tenant_id: args[0],
        organization_id: args[1],
        user_id: args[2],
        route: args[3],
        key: args[4],
        request_hash: requestHash,
        response_json: JSON.stringify({ body: response, status: c.res.status }),
        created_at: now(),
      });
    }
  });
  app.get("/api/c/:company/context", (c) =>
    c.json({
      company: c.get("company"),
      employee_id: c.get("access").employee_id,
      permissions: c.get("grants"),
    }),
  );
  app.get(
    "/api/c/:company/ws",
    upgradeWebSocket((c) => {
      let connection: typeof sockets extends Set<infer T> ? T : never;
      return {
        onOpen: (_, ws) => {
          connection = {
            ws,
            tenant: c.get("user").tenant_id,
            company: c.get("company").id,
            user: c.get("user").id,
            session: c.get("user").session_id,
          };
          sockets.add(connection);
        },
        onClose: () => {
          if (connection) sockets.delete(connection);
        },
      };
    }),
  );
  app.get("/api/c/:company/notifications", (c) =>
    c.json({
      items: s.all(
        "SELECT * FROM notifications WHERE tenant_id=? AND organization_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100",
        c.get("user").tenant_id,
        c.get("company").id,
        c.get("user").id,
      ),
      unread: s.one(
        "SELECT COUNT(*) n FROM notifications WHERE tenant_id=? AND organization_id=? AND user_id=? AND read_at IS NULL",
        c.get("user").tenant_id,
        c.get("company").id,
        c.get("user").id,
      )!.n,
    }),
  );
  app.get("/api/c/:company/dashboard", (c) => {
    const scope = scopeSql(c, "employees.read"),
      args = [c.get("company").id, c.get("user").tenant_id, ...scope.args];
    const employees = s.all(
      `SELECT e.id,e.employee_no,e.first_name_th,e.last_name_th,e.employment_status,d.name_th department_name,p.name_th position_name,a.check_in_at,a.check_out_at,a.status attendance_status,a.late_minutes FROM employees e JOIN organizations o ON o.id=e.organization_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN attendance_records a ON a.employee_id=e.id AND a.work_date=? WHERE e.organization_id=? AND o.tenant_id=? AND e.deleted_at IS NULL AND ${scope.sql} ORDER BY e.employee_no`,
      today(),
      ...args,
    );
    return c.json({
      date: today(),
      employees,
      total: employees.length,
      present: employees.filter(
        (e) =>
          e.attendance_status === "PRESENT" ||
          e.attendance_status === "INCOMPLETE",
      ).length,
      leave: employees.filter((e) => e.attendance_status === "LEAVE").length,
      late: employees.filter((e) => e.late_minutes > 0).length,
      pending_leaves: can(c, "leave.approve")
        ? s.one(
            "SELECT COUNT(*) n FROM leave_approvals a JOIN leave_requests r ON r.id=a.leave_request_id JOIN employees e ON e.id=r.employee_id WHERE e.organization_id=? AND a.approver_user_id=? AND a.decision='PENDING' AND r.status='PENDING'",
            c.get("company").id,
            c.get("user").id,
          )!.n
        : 0,
    });
  });
  app.route("/api/c/:company/employees", employeeRoutes(db, options.key));
  app.route("/api/c/:company", timeRoutes(db));
  app.route("/api/c/:company/payroll", payrollRoutes(db));
  app.route("/api/c/:company/announcements", announcements.app);
  app.route("/api/c/:company", adminRoutes(db, options.key));
  app.route("/api/c/:company", transferRoutes(db));
  app.route("/api/c/:company", managementRoutes(db));
  app.get("/api/c/:company/payslips", (c) => {
    const scope = scopeSql(c, "payroll.read");
    return c.json({
      items: s.all(
        `SELECT ps.*,pr.net_pay_satang,e.first_name_th,e.last_name_th,pc.name cycle_name FROM payslips ps JOIN employees e ON e.id=ps.employee_id JOIN organizations o ON o.id=e.organization_id JOIN payroll_results pr ON pr.id=ps.payroll_result_id JOIN payroll_cycles pc ON pc.id=ps.payroll_cycle_id WHERE e.organization_id=? AND o.tenant_id=? AND ${scope.sql} AND ps.revoked_at IS NULL AND ps.published_at IS NOT NULL ORDER BY ps.issued_at DESC LIMIT 100`,
        c.get("company").id,
        c.get("user").tenant_id,
        ...scope.args,
      ),
    });
  });
  app.get("/api/c/:company/payslips/:id", (c) => {
    const ps = s.one("SELECT * FROM payslips WHERE id=?", c.req.param("id"));
    if (!ps) fail(404, "Payslip unavailable");
    const e = employee(db, c, ps.employee_id, "payroll.read");
    if (!can(c, "payroll.read") && e.id !== c.get("access").employee_id)
      fail(403, "Payslip is private");
    if (ps.revoked_at || !ps.published_at)
      fail(403, "Payslip is not published");
    s.update("payslips", ps.id, {
      first_viewed_at: ps.first_viewed_at || now(),
      last_viewed_at: now(),
      view_count: ps.view_count + 1,
      delivery_status: "VIEWED",
    });
    audit(db, c, "VIEW", "payslips", ps.id, null, null, "Payslip viewed", e.id);
    return c.json({
      ...ps,
      employee: {
        employee_no: e.employee_no,
        first_name_th: e.first_name_th,
        last_name_th: e.last_name_th,
      },
      company: c.get("company"),
      cycle: s.one(
        "SELECT * FROM payroll_cycles WHERE id=?",
        ps.payroll_cycle_id,
      ),
      result: s.one(
        "SELECT * FROM payroll_results WHERE id=?",
        ps.payroll_result_id,
      ),
      items: s.all(
        "SELECT * FROM payroll_result_items WHERE payroll_result_id=?",
        ps.payroll_result_id,
      ),
    });
  });
  app.post("/api/c/:company/files", async (c) => {
    const form = await c.req.formData(),
      file = form.get("file"),
      employeeId = z.uuid().parse(form.get("employee_id"));
    employee(db, c, employeeId);
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
      fail(422, "Upload a file up to 5 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type;
    const png = mime === "image/png" && bytes[0] === 137 && bytes[1] === 80,
      jpeg = mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216,
      pdf =
        mime === "application/pdf" &&
        new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    if (!png && !jpeg && !pdf)
      fail(422, "Only valid PNG, JPEG and PDF files are allowed");
    const id = uuid(),
      directory = resolve(
        storage,
        c.get("user").tenant_id,
        c.get("company").id,
      );
    mkdirSync(directory, { recursive: true });
    await Bun.write(resolve(directory, id), bytes);
    s.insert("file_attachments", {
      id,
      tenant_id: c.get("user").tenant_id,
      organization_id: c.get("company").id,
      object_type: "employees",
      object_id: employeeId,
      file_name: file.name.slice(0, 150),
      file_url: "/api/c/" + c.get("company").id + "/files/" + id,
      mime_type: mime,
      file_size_bytes: file.size,
      checksum_sha256: hash(Buffer.from(bytes).toString("base64")),
      uploaded_by_user_id: c.get("user").id,
    });
    audit(
      db,
      c,
      "UPLOAD",
      "file_attachments",
      id,
      null,
      { name: file.name },
      "Employee document",
      employeeId,
    );
    return c.json({ id }, 201);
  });
  app.get("/api/c/:company/files/:id", async (c) => {
    const file = s.one(
      "SELECT * FROM file_attachments WHERE id=? AND tenant_id=? AND organization_id=?",
      c.req.param("id"),
      c.get("user").tenant_id,
      c.get("company").id,
    );
    if (!file) fail(403, "File outside company");
    employee(db, c, file.object_id);
    const path = resolve(
      storage,
      file.tenant_id,
      file.organization_id,
      file.id,
    );
    c.header("Content-Type", file.mime_type);
    c.header(
      "Content-Disposition",
      `attachment; filename="document-${file.id}"`,
    );
    audit(
      db,
      c,
      "DOWNLOAD",
      "file_attachments",
      file.id,
      null,
      null,
      "Document downloaded",
      file.object_id,
    );
    return c.body(await Bun.file(path).arrayBuffer());
  });
  app.post("/api/c/:company/exports", async (c) => {
    requirePermission(c, "exports.write");
    const b = z
      .object({
        module: z.enum(["employees", "attendance", "audit"]),
        reason: text(1000),
      })
      .strict()
      .parse(await c.req.json());
    const id = uuid();
    s.insert("data_exports", {
      id,
      tenant_id: c.get("user").tenant_id,
      organization_id: c.get("company").id,
      requested_by_user_id: c.get("user").id,
      export_type: "CSV",
      object_type: b.module,
      reason: b.reason,
      filter_snapshot_json: JSON.stringify({
        company: c.get("company").id,
        module: b.module,
      }),
      status: "COMPLETED",
      file_expires_at: new Date(Date.now() + 3600000).toISOString(),
      completed_at: now(),
    });
    audit(db, c, "EXPORT_REQUEST", b.module, id, null, null, b.reason);
    return c.json({
      id,
      url: "/api/c/" + c.get("company").id + "/exports/" + id,
    });
  });
  app.get("/api/c/:company/exports/:id", (c) => {
    requirePermission(c, "exports.write");
    const exp = s.one(
      "SELECT * FROM data_exports WHERE id=? AND tenant_id=? AND organization_id=? AND requested_by_user_id=?",
      c.req.param("id"),
      c.get("user").tenant_id,
      c.get("company").id,
      c.get("user").id,
    );
    if (!exp || exp.file_expires_at < now())
      fail(403, "Export unavailable or expired");
    const scope = scopeSql(c, "employees.read");
    let rows: Row[] = [];
    if (exp.object_type === "employees")
      rows = s.all(
        `SELECT e.employee_no,e.first_name_th,e.last_name_th,e.company_email,e.employment_status,e.hire_date FROM employees e WHERE organization_id=? AND deleted_at IS NULL AND ${scope.sql}`,
        c.get("company").id,
        ...scope.args,
      );
    else if (exp.object_type === "attendance") {
      requirePermission(c, "attendance.read");
      rows = s.all(
        `SELECT a.work_date,e.employee_no,a.check_in_at,a.check_out_at,a.worked_minutes,a.status FROM attendance_records a JOIN employees e ON e.id=a.employee_id WHERE e.organization_id=? AND ${scope.sql}`,
        c.get("company").id,
        ...scope.args,
      );
    } else {
      requirePermission(c, "audit.read");
      rows = s.all(
        "SELECT created_at,action,object_type,object_id,reason,request_id FROM audit_logs WHERE tenant_id=? AND organization_id=?",
        c.get("user").tenant_id,
        c.get("company").id,
      );
    }
    const keys = rows.length ? Object.keys(rows[0]) : ["No records"];
    const escape = (v: any) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv =
      "\uFEFF" +
      [
        keys.map(escape).join(","),
        ...rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
      ].join("\r\n");
    audit(
      db,
      c,
      "EXPORT_DOWNLOAD",
      "data_exports",
      exp.id,
      null,
      { rows: rows.length },
      exp.reason,
    );
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      'attachment; filename="hrm-' + exp.object_type + '.csv"',
    );
    return c.body(csv);
  });
  app.notFound((c) => {
    if (c.req.path.startsWith("/api/"))
      return c.json({ error: "Endpoint not found" }, 404);
    if (!options.staticRoot) return c.text("Build frontend first", 404);
    const root = resolve(options.staticRoot),
      requested = resolve(root, "." + decodeURIComponent(c.req.path));
    if (!requested.startsWith(root + sep) && requested !== root)
      return c.text("Not found", 404);
    const file = Bun.file(requested);
    return file.exists().then((exists) => {
      if (exists) return new Response(file);
      if (c.req.path.includes(".")) return c.text("Not found", 404);
      return new Response(Bun.file(resolve(root, "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    });
  });
  return {
    app,
    websocket,
    tick: announcements.tick,
    push,
    closeSockets: () => {
      for (const s of sockets) s.ws.close();
      sockets.clear();
    },
  };
}
