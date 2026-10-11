import { openDb, bootstrap, store, uuid, now, today } from "../src/server/db";
import { createApp } from "../src/server/app";
// Explicit disposable demonstration database. Never runs during server startup.
if (process.env.NODE_ENV === "production")
  throw new Error("Demo setup is disabled in production");
if (!process.env.SETUP_PASSWORD || !process.env.ENCRYPTION_KEY)
  throw new Error("SETUP_PASSWORD and ENCRYPTION_KEY required");
const db = openDb(),
  s = store(db),
  password = process.env.SETUP_PASSWORD,
  setup = await bootstrap(
    db,
    process.env.SETUP_EMAIL || "admin@example.test",
    password,
    "Demo workspace",
    "บริษัท เน็กซ์ เอชอาร์ จำกัด",
  );
s.run("UPDATE tenants SET code='demo' WHERE id=?", setup.tenant);
const runtime = createApp(db, { key: process.env.ENCRYPTION_KEY });
let cookie = "";
async function api(path: string, body: any) {
  const r = await runtime.app.request("http://localhost:3000/api" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  return data as any;
}
await api("/auth/login", {
  workspace: "demo",
  email: process.env.SETUP_EMAIL || "admin@example.test",
  password,
});
const base = "/c/" + setup.org;
const department = await api(base + "/settings/departments", {
  code: "TECH",
  name_th: "เทคโนโลยี",
  name_en: "Technology",
});
const position = await api(base + "/settings/positions", {
  code: "DEV",
  name_th: "นักพัฒนาระบบ",
  name_en: "Software Developer",
});
const schedule = await api(base + "/settings/work_schedules", {
  code: "WEEKDAYS",
  name: "Monday–Friday 09:00–18:00",
  days: Array.from({ length: 7 }, (_, i) => ({
    weekday: i + 1,
    is_workday: i < 5,
    start_time: "09:00",
    end_time: "18:00",
  })),
});
for (const [i, [first, last]] of [
  ["กมลวรรณ", "ศรีประเสริฐ"],
  ["ณัฐพงศ์", "ไทยเจริญ"],
  ["ศิรินทร์", "กลมชาติ"],
  ["อัญชิสา", "พัฒนกุล"],
  ["วรพล", "เมฆวิริยะ"],
].entries()) {
  const e = await api(base + "/employees", {
    first_name_th: first,
    last_name_th: last,
    company_email: "employee" + (i + 1) + "@example.test",
    hire_date: "2026-01-01",
    salary_satang: (30000 + i * 5000) * 100,
    department_id: department.id,
    position_id: position.id,
    create_user: true,
    password,
    bank_code: "004",
    account_name: first + " " + last,
    account_number: "123456789" + i,
    mobile_phone: "080000000" + i,
  });
  await api(base + "/settings/schedule-assignment", {
    employee_id: e.id,
    work_schedule_id: schedule.id,
    effective_from: "2026-01-01",
  });
  if (i < 4)
    s.insert("attendance_records", {
      id: uuid(),
      employee_id: e.id,
      work_date: today(),
      status: "PRESENT",
      check_in_at: today() + "T02:00:00Z",
      check_out_at: today() + "T11:00:00Z",
      worked_minutes: 480,
      late_minutes: i === 3 ? 15 : 0,
    });
}
await api(base + "/announcements", {
  title: "ยินดีต้อนรับสู่พื้นที่ทำงานใหม่",
  body: "รวมข้อมูลพนักงาน เวลา การลา และเงินเดือนไว้ในระบบเดียว กรุณาตรวจสอบข้อมูลส่วนตัวและอ่านประกาศของบริษัท",
  status: "PUBLISHED",
  priority: "HIGH",
  requires_acknowledgement: true,
  targets: [{ type: "ALL", id: null }],
});
console.log(
  "Demo ready: workspace=demo, admin=" +
    (process.env.SETUP_EMAIL || "admin@example.test") +
    ", company=" +
    setup.org,
);
db.close();
