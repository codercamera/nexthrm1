import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
export type Row = Record<string, any>;
export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const hash = (value: string) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
export function openDb(path = process.env.DB_PATH || "data/hrm.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  for (const file of readdirSync(resolve("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const version = file.replace(".sql", "");
    const exists = db
      .query("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
      .get();
    if (
      !exists ||
      !db.query("SELECT 1 FROM schema_migrations WHERE version=?").get(version)
    )
      db.exec(readFileSync(resolve("migrations", file), "utf8"));
  }
  if (db.query("PRAGMA foreign_key_check").all().length)
    throw new Error("Invalid foreign keys");
  return db;
}
export function store(db: Database) {
  return {
    all: (sql: string, ...args: any[]) => db.query(sql).all(...args) as Row[],
    one: (sql: string, ...args: any[]) =>
      db.query(sql).get(...args) as Row | null,
    run: (sql: string, ...args: any[]) => db.query(sql).run(...args),
    insert: (table: string, row: Row) => {
      const keys = Object.keys(row);
      db.query(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ).run(...keys.map((k) => row[k]));
      return row;
    },
    update: (table: string, id: string, row: Row) => {
      const keys = Object.keys(row);
      if (keys.length)
        db.query(
          `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`,
        ).run(...keys.map((k) => row[k]), id);
    },
  };
}
export const rolePermissions: Record<string, string[]> = {
  TENANT_ADMIN: ["*"],
  HR: [
    "employees.read",
    "employees.write",
    "compensation.read",
    "attendance.read",
    "attendance.write",
    "leave.read",
    "leave.approve",
    "payroll.read",
    "payroll.prepare",
    "announcements.write",
    "audit.read",
    "exports.write",
    "settings.write",
  ],
  PAYROLL_REVIEWER: [
    "employees.read",
    "compensation.read",
    "payroll.read",
    "payroll.review",
  ],
  PAYROLL_APPROVER: ["payroll.read", "payroll.approve"],
  MANAGER: ["employees.read", "attendance.read", "leave.read", "leave.approve"],
  EMPLOYEE: ["self"],
};
export async function bootstrap(
  db: Database,
  email: string,
  password: string,
  workspace = "HR Workspace",
  company = "บริษัท ตัวอย่าง จำกัด",
) {
  const s = store(db);
  if (s.one("SELECT 1 FROM tenants"))
    throw new Error("Workspace already initialized");
  if (password.length < 12)
    throw new Error("Password must contain at least 12 characters");
  const password_hash = await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
  return db.transaction(() => {
    const tenant = uuid(),
      org = uuid(),
      user = uuid();
    s.insert("tenants", {
      id: tenant,
      code: tenant.slice(0, 8),
      name: workspace,
    });
    s.insert("tenant_settings", { tenant_id: tenant });
    s.insert("organizations", {
      id: org,
      tenant_id: tenant,
      code: "HQ",
      legal_name: company,
      display_name: company,
    });
    s.insert("organization_settings", { organization_id: org });
    s.insert("users", {
      id: user,
      tenant_id: tenant,
      default_organization_id: org,
      email: email.toLowerCase(),
      display_name: "Administrator",
      password_hash,
    });
    for (const [code, perms] of Object.entries(rolePermissions)) {
      const rid = uuid();
      s.insert("roles", {
        id: rid,
        tenant_id: tenant,
        code,
        name: code,
        is_system_role: 1,
      });
      for (const p of perms) {
        let permission = s.one("SELECT id FROM permissions WHERE code=?", p);
        if (!permission)
          permission = s.insert("permissions", {
            id: uuid(),
            code: p,
            module: p.split(".")[0],
          });
        s.insert("role_permissions", {
          role_id: rid,
          permission_id: permission.id,
        });
      }
      if (code === "TENANT_ADMIN")
        s.insert("user_roles", {
          id: uuid(),
          user_id: user,
          role_id: rid,
          scope_type: "TENANT",
          assigned_by_user_id: user,
        });
    }
    s.insert("user_company_access", {
      id: uuid(),
      user_id: user,
      organization_id: org,
      is_default: 1,
      granted_by_user_id: user,
    });
    const lt = uuid();
    s.insert("leave_types", {
      id: lt,
      organization_id: org,
      code: "ANNUAL",
      name_th: "ลาพักร้อน",
      name_en: "Annual leave",
    });
    s.insert("leave_policies", {
      id: uuid(),
      organization_id: org,
      leave_type_id: lt,
      name: "Annual leave",
      annual_entitlement_minutes: 4800,
      effective_from: "2020-01-01",
    });
    return { tenant, org, user };
  })();
}
