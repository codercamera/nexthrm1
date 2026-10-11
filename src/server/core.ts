import { Hono, type Context } from "hono";
import type { Database } from "bun:sqlite";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { uuid, now, store, type Row } from "./db";
export type Env = {
  Variables: {
    user: Row;
    company: Row;
    access: Row;
    grants: Row[];
    requestId: string;
  };
};
export type C = Context<Env>;
export function fail(
  status: 400 | 401 | 403 | 404 | 409 | 422,
  message: string,
): never {
  throw new HTTPException(status, { message });
}
export const text = (max = 200) => z.string().trim().min(1).max(max);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
export const timestamp = z.string().datetime({ offset: true });
export const money = z.number().int().nonnegative().max(1_000_000_000_000);
export const nullableId = z.uuid().nullable().default(null);
export function can(c: C, permission: string) {
  return c.get("grants").some((g) => g.code === "*" || g.code === permission);
}
export function requirePermission(c: C, permission: string) {
  const grants = c
    .get("grants")
    .filter((g) => g.code === "*" || g.code === permission);
  if (
    !grants.length ||
    (/^(payroll|settings|audit|exports)\./.test(permission) &&
      !grants.some((g) => ["TENANT", "COMPANY"].includes(g.scope_type)))
  )
    fail(403, "Permission denied");
}
export function scopeSql(
  c: C,
  permission: string,
  alias = "e",
): { sql: string; args: any[] } {
  const grants = c
    .get("grants")
    .filter((g) => g.code === "*" || g.code === permission);
  const me = c.get("access").employee_id;
  if (grants.some((g) => ["TENANT", "COMPANY"].includes(g.scope_type)))
    return { sql: "1=1", args: [] };
  const clauses = [`${alias}.id=?`],
    args: any[] = [me || ""];
  for (const g of grants) {
    if (g.scope_type === "BRANCH") {
      clauses.push(`${alias}.branch_id=?`);
      args.push(g.scope_id);
    }
    if (g.scope_type === "DEPARTMENT") {
      clauses.push(`${alias}.department_id=?`);
      args.push(g.scope_id);
    }
  }
  if (grants.length) {
    clauses.push(`${alias}.manager_employee_id=?`);
    args.push(me || "");
  }
  return { sql: `(${clauses.join(" OR ")})`, args };
}
export function employee(
  db: Database,
  c: C,
  id: string,
  permission = "employees.read",
) {
  const s = store(db),
    scope = scopeSql(c, permission);
  const e = s.one(
    `SELECT e.* FROM employees e JOIN organizations o ON o.id=e.organization_id WHERE e.id=? AND e.organization_id=? AND o.tenant_id=? AND e.deleted_at IS NULL AND ${scope.sql}`,
    id,
    c.get("company").id,
    c.get("user").tenant_id,
    ...scope.args,
  );
  if (!e) fail(403, "Employee is outside your authorized scope");
  return e;
}
export function companyObject(db: Database, c: C, table: string, id: string) {
  const r = store(db).one(
    `SELECT * FROM ${table} WHERE id=? AND organization_id=?`,
    id,
    c.get("company").id,
  );
  if (!r) fail(403, "Object is outside this company");
  return r;
}
export function audit(
  db: Database,
  c: C,
  action: string,
  object_type: string,
  object_id: string | null,
  before: Row | null = null,
  after: Row | null = null,
  reason: string | null = null,
  employee_id: string | null = null,
) {
  const redact = (r: Row | null) =>
    r
      ? JSON.stringify(r, (k, v) =>
          /password|token|encrypted|national_id|account_number|tax_id|insured_no/i.test(
            k,
          )
            ? "[REDACTED]"
            : v,
        )
      : null;
  store(db).insert("audit_logs", {
    id: uuid(),
    tenant_id: c.get("user").tenant_id,
    organization_id: c.get("company")?.id || null,
    actor_user_id: c.get("user").id,
    action,
    object_type,
    object_id,
    employee_id,
    before_json: redact(before),
    after_json: redact(after),
    reason,
    request_id: c.get("requestId"),
    created_at: now(),
  });
}
export function encryption(key: string) {
  if (!/^[0-9a-f]{64}$/i.test(key))
    throw new Error("ENCRYPTION_KEY must be 32 bytes in hex");
  const buffer = Buffer.from(key, "hex");
  return {
    encrypt: (value: string) => {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", buffer, iv),
        body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    decrypt: (value: string) => {
      const v = Buffer.from(value, "base64"),
        cipher = createDecipheriv("aes-256-gcm", buffer, v.subarray(0, 12));
      cipher.setAuthTag(v.subarray(12, 28));
      return Buffer.concat([
        cipher.update(v.subarray(28)),
        cipher.final(),
      ]).toString("utf8");
    },
  };
}
export const page = (c: C) => ({
  limit: Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25)),
  offset: Math.max(0, Number(c.req.query("offset")) || 0),
});
export function notification(
  db: Database,
  c: C,
  user: string,
  type: string,
  title: string,
  source: string,
  id: string,
) {
  if (user === c.get("user").id) return;
  store(db).run(
    "INSERT OR IGNORE INTO notifications(id,tenant_id,organization_id,user_id,notification_type,title,source_type,source_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    uuid(),
    c.get("user").tenant_id,
    c.get("company").id,
    user,
    type,
    title,
    source,
    id,
    now(),
  );
}
