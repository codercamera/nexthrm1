import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  Building2,
  Users,
  House,
  Clock3,
  CalendarDays,
  Wallet,
  Megaphone,
  Settings,
  ShieldCheck,
  LogOut,
  Bell,
  Sun,
  Moon,
  Plus,
  Trash2,
  Printer,
  Download,
  Menu,
  Check,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { request, type Row, money, localDate } from "./api";
import EmployeeReport from "./EmployeeReport";
import {
  Editor,
  Modal,
  Confirm,
  DataTable,
  Filters,
  Pager,
  Badge,
  nameColumn,
  statusColumn,
  amountColumn,
  dateColumn,
  type Field,
  type Translate,
} from "./components";
const day = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const f = (
  key: string,
  th: string,
  en: string,
  type = "text",
  required = true,
): Field => ({ key, th, en, type, required });
const choice = (
  key: string,
  th: string,
  en: string,
  values: string[],
): Field => ({
  ...f(key, th, en),
  options: values.map((v) => ({ value: v, label: v.replaceAll("_", " ") })),
});
const pages = [
  {
    key: "dashboard",
    th: "หน้าหลัก",
    en: "Dashboard",
    icon: House,
    id: "10001",
  },
  {
    key: "employees",
    th: "บุคลากร",
    en: "People",
    icon: Users,
    id: "10002",
    permission: "employees.read",
  },
  {
    key: "attendance",
    th: "เวลาทำงาน",
    en: "Attendance",
    icon: Clock3,
    id: "10003",
  },
  { key: "leaves", th: "การลา", en: "Leave", icon: CalendarDays, id: "10004" },
  {
    key: "payroll",
    th: "ค่าตอบแทน",
    en: "Payroll",
    icon: Wallet,
    id: "10005",
    permission: "payroll.read",
  },
  {
    key: "announcements",
    th: "ประกาศ",
    en: "Announcements",
    icon: Megaphone,
    id: "10006",
  },
  {
    key: "profile",
    th: "ข้อมูลของฉัน",
    en: "My profile",
    icon: Users,
    id: "10007",
  },
  {
    key: "payslips",
    th: "สลิปเงินเดือน",
    en: "My payslips",
    icon: Wallet,
    id: "10008",
  },
  {
    key: "settings",
    th: "ตั้งค่า",
    en: "Settings",
    icon: Settings,
    id: "10009",
    permission: "settings.write",
  },
  {
    key: "users",
    th: "ผู้ใช้และสิทธิ์",
    en: "Users & access",
    icon: ShieldCheck,
    id: "10010",
    permission: "*",
  },
  {
    key: "audit",
    th: "ประวัติการเปลี่ยนแปลง",
    en: "Audit log",
    icon: ShieldCheck,
    id: "10011",
    permission: "audit.read",
  },
];
export default function App() {
  const [lang, setLang] = useState(
      localStorage.getItem("hrm-language") || "th",
    ),
    [dark, setDark] = useState(localStorage.getItem("hrm-theme") === "dark");
  const t: Translate = (th, en) => (lang === "th" ? th : en);
  const [me, setMe] = useState<Row | null>(null),
    [company, setCompany] = useState(""),
    [context, setContext] = useState<Row | null>(null),
    [active, setActive] = useState("dashboard"),
    [data, setData] = useState<Row>({}),
    [lookups, setLookups] = useState<Row>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [q, setQ] = useState(""),
    [department, setDepartment] = useState(""),
    [status, setStatus] = useState(""),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [modal, setModal] = useState<ReactNode>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [detailType, setDetailType] = useState(""),
    [mobileMore, setMobileMore] = useState(false),
    [notifications, setNotifications] = useState<Row>({ items: [], unread: 0 }),
    [noticePanel, setNoticePanel] = useState(false),
    [calendar, setCalendar] = useState(false),
    [setting, setSetting] = useState("departments");
  const base = "/api/c/" + company,
    permit = (p: string) =>
      !!context?.permissions?.some((g: Row) => g.code === "*" || g.code === p),
    mutate = () => {
      setModal(null);
      setRevision((v) => v + 1);
      setMessage(t("บันทึกสำเร็จ", "Saved successfully"));
    };
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.lang = lang;
    localStorage.setItem("hrm-language", lang);
    localStorage.setItem("hrm-theme", dark ? "dark" : "light");
  }, [lang, dark]);
  useEffect(() => {
    request("/api/me")
      .then((u) => {
        setMe(u);
        const saved = localStorage.getItem("hrm-company");
        const selected =
          u.companies.find((c: Row) => c.id === saved) || u.companies[0];
        const route = location.pathname.split("/");
        const authorized = u.companies.find((c: Row) => c.id === route[2]);
        if (authorized) {
          setCompany(authorized.id);
          if (pages.some((p) => p.key === route[3])) setActive(route[3]);
        } else if (selected) setCompany(selected.id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!company) return;
    let live = true;
    setContext(null);
    Promise.all([request(base + "/context"), request(base + "/lookups")])
      .then(([c, l]) => {
        if (live) {
          setContext(c);
          setLookups(l);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [company, revision]);
  const currentCompany = useRef(company);
  currentCompany.current = company;
  const loadNotifications = useCallback(() => {
    if (company)
      request("/api/c/" + company + "/notifications")
        .then((r) => {
          if (currentCompany.current === company) setNotifications(r);
        })
        .catch(() => {});
  }, [company]);
  useEffect(() => {
    if (!company) return;
    loadNotifications();
    let stopped = false,
      ws: WebSocket | null = null,
      timer: ReturnType<typeof setTimeout> | undefined,
      delay = 1000;
    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(
        (location.protocol === "https:" ? "wss:" : "ws:") +
          "//" +
          location.host +
          "/api/c/" +
          company +
          "/ws",
      );
      ws.onopen = () => {
        delay = 1000;
        loadNotifications();
      };
      ws.onmessage = () => {
        loadNotifications();
        if (active === "announcements") setRevision((v) => v + 1);
      };
      ws.onclose = () => {
        if (!stopped) {
          timer = setTimeout(connect, delay);
          delay = Math.min(30000, delay * 2);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [company, active, loadNotifications]);
  useEffect(() => {
    if (!company || !context) return;
    let live = true;
    setLoading(true);
    setError("");
    setData({});
    let path = active;
    if (active === "employees")
      path =
        "employees?q=" +
        encodeURIComponent(q) +
        "&department=" +
        department +
        "&status=" +
        status +
        "&offset=" +
        offset;
    else if (active === "leaves" && calendar) {
      const date = day(),
        end = new Date(
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)),
          0,
        ).getDate();
      path =
        "leaves/calendar?start=" +
        date.slice(0, 8) +
        "01&end=" +
        date.slice(0, 8) +
        end;
    } else if (active === "profile")
      path = context.employee_id ? "employees/" + context.employee_id : "";
    else if (active === "settings") path = "settings/company";
    else if (active === "audit") path = "audit?q=" + encodeURIComponent(q);
    const timer = setTimeout(
      () => {
        (path ? request(base + "/" + path) : Promise.resolve({}))
          .then((r) => {
            if (live) setData(r);
          })
          .catch((e) => {
            if (live) setError(e.message);
          })
          .finally(() => {
            if (live) setLoading(false);
          });
      },
      q ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    company,
    context,
    active,
    q,
    department,
    status,
    offset,
    revision,
    calendar,
  ]);
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);
  const navigate = (page: string) => {
    setActive(page);
    setQ("");
    setDepartment("");
    setStatus("");
    setOffset(0);
    setDetail(null);
    setMobileMore(false);
    history.replaceState({}, "", "/c/" + company + "/" + page);
  };
  const changeCompany = (id: string) => {
    setCompany(id);
    localStorage.setItem("hrm-company", id);
    setContext(null);
    setData({});
    setDetail(null);
    setNotifications({ items: [], unread: 0 });
    setActive("dashboard");
    setQ("");
    setOffset(0);
    history.replaceState({}, "", "/c/" + id + "/dashboard");
  };
  function editor(
    title: string,
    id: string,
    fields: Field[],
    path: string,
    initial: Row = {},
    method = "POST",
    transform?: (b: Row) => Row,
    preview?: (b: Row) => ReactNode,
  ) {
    setModal(
      <Editor
        key={id + Date.now()}
        title={title}
        id={id}
        fields={fields}
        initial={initial}
        onClose={() => setModal(null)}
        t={t}
        preview={preview}
        submit={async (b) => {
          const result = await request(
            base + path,
            method,
            transform ? transform(b) : b,
          );
          mutate();
          if (result.accept_url) {
            setDetail({ reset_url: result.accept_url });
            setDetailType("reset");
          }
          if (path === "/companies") {
            const user = await request("/api/me");
            setMe(user);
          }
        }}
      />,
    );
  }
  function action(
    title: string,
    path: string,
    body: Row = {},
    method = "POST",
    key = "reason",
  ) {
    setModal(
      <Confirm
        title={title}
        t={t}
        onClose={() => setModal(null)}
        onConfirm={async (reason) => {
          await request(base + path, method, { ...body, [key]: reason });
          mutate();
          setDetail(null);
        }}
      />,
    );
  }
  const lookup = (
    key: string,
    th: string,
    en: string,
    table: string,
    required = false,
  ): Field => ({
    ...f(key, th, en, "text", required),
    options: (lookups[table] || []).map((r: Row) => ({
      value: r.id,
      label:
        r.name_th ||
        r.name ||
        r.employee_no + " " + r.first_name_th + " " + r.last_name_th,
    })),
  });
  async function showEmployee(id: string) {
    try {
      setDetail(await request(base + "/employees/" + id));
      setDetailType("employee");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function employeeForm(existing?: Row) {
    const ch = existing?.compensation?.[0],
      initial: Row = existing
        ? {
            ...existing,
            salary_baht:
              (ch?.pay_type === "DAILY"
                ? ch.daily_rate_satang
                : ch?.pay_type === "HOURLY"
                  ? ch.hourly_rate_satang
                  : ch?.base_salary_satang || 0) / 100,
            pay_type: ch?.pay_type || "MONTHLY",
            allowances: JSON.parse(ch?.regular_allowances_json || "[]"),
            address: existing.addresses?.[0]?.address_line1 || "",
            emergency_name: existing.emergency_contacts?.[0]?.full_name || "",
            emergency_relationship:
              existing.emergency_contacts?.[0]?.relationship || "",
            emergency_phone: existing.emergency_contacts?.[0]?.phone || "",
            effective_date: day(),
          }
        : {
            hire_date: day(),
            employment_type: "FULL_TIME",
            employment_status: "ACTIVE",
            pay_type: "MONTHLY",
            allowances: [],
          };
    const fields: Field[] = [
      f("first_name_th", "ชื่อ", "First name"),
      f("last_name_th", "นามสกุล", "Last name"),
      f("nickname", "ชื่อเล่น", "Nickname", "text", false),
      f("birth_date", "วันเกิด", "Date of birth", "date", false),
      f("company_email", "อีเมลบริษัท", "Company email", "email", false),
      f("personal_email", "อีเมลส่วนตัว", "Personal email", "email", false),
      f("mobile_phone", "โทรศัพท์", "Phone", "tel", false),
      f("address", "ที่อยู่", "Address", "textarea", false),
      f("hire_date", "วันเริ่มงาน", "Hire date", "date"),
      choice("employment_type", "ประเภทการจ้าง", "Employment type", [
        "FULL_TIME",
        "PART_TIME",
        "CONTRACT",
        "PROBATION",
        "INTERN",
        "DAILY",
      ]),
      choice("employment_status", "สถานะ", "Employment status", [
        "DRAFT",
        "ACTIVE",
        "ON_LEAVE",
        "SUSPENDED",
        "TERMINATED",
      ]),
      f(
        "probation_end_date",
        "สิ้นสุดทดลองงาน / สัญญา",
        "Probation / contract end",
        "date",
        false,
      ),
      lookup("branch_id", "สาขา", "Branch", "branches"),
      lookup("department_id", "แผนก", "Department", "departments"),
      lookup("position_id", "ตำแหน่ง", "Position", "positions"),
      lookup("manager_employee_id", "หัวหน้างาน", "Manager", "employees"),
      {
        ...f("salary_baht", "ค่าจ้าง (บาท)", "Wage (THB)", "number"),
        step: "0.01",
        min: "0",
      },
      choice("pay_type", "ประเภทค่าจ้าง", "Wage basis", [
        "MONTHLY",
        "DAILY",
        "HOURLY",
      ]),
      f(
        "allowances",
        "รายได้ประจำ (บาท)",
        "Regular earnings (THB)",
        "earnings",
        false,
      ),
      f("national_id", "เลขบัตรประชาชน", "National ID", "text", false),
      f("bank_code", "รหัสธนาคาร", "Bank code", "text", false),
      f("account_name", "ชื่อบัญชี", "Account name", "text", false),
      f("account_number", "เลขบัญชีใหม่", "New account number", "text", false),
      f(
        "emergency_name",
        "ผู้ติดต่อฉุกเฉิน",
        "Emergency contact",
        "text",
        false,
      ),
      f(
        "emergency_relationship",
        "ความสัมพันธ์",
        "Relationship",
        "text",
        false,
      ),
      f("emergency_phone", "โทรศัพท์ฉุกเฉิน", "Emergency phone", "tel", false),
    ];
    if (existing)
      fields.push(
        f("reason", "เหตุผลแก้ไข", "Change reason", "textarea"),
        f("effective_date", "วันที่มีผล", "Effective date", "date"),
        f(
          "termination_date",
          "วันที่สิ้นสุดการจ้าง",
          "Termination date",
          "date",
          false,
        ),
        f(
          "termination_reason",
          "เหตุผลที่ออก",
          "Termination reason",
          "text",
          false,
        ),
        f(
          "reauth_password",
          "ยืนยันรหัสผ่านเมื่อเปลี่ยนข้อมูลสำคัญ",
          "Re-enter password for sensitive changes",
          "password",
          false,
        ),
      );
    else
      fields.push(
        f(
          "create_user",
          "สร้างบัญชีผู้ใช้พร้อมพนักงาน",
          "Create user account",
          "checkbox",
          false,
        ),
        f(
          "password",
          "รหัสผ่านเริ่มต้น (อย่างน้อย 12 ตัว)",
          "Initial password (12+ characters)",
          "password",
          false,
        ),
      );
    editor(
      t(
        existing ? "แก้ไขพนักงาน" : "เพิ่มพนักงาน",
        existing ? "Edit employee" : "Add employee",
      ),
      existing ? "20004" : "20003",
      fields,
      existing ? "/employees/" + existing.id : "/employees",
      initial,
      existing ? "PUT" : "POST",
      (b) => {
        const { salary_baht, allowances, ...r } = b;
        for (const k of [
          "company_email",
          "personal_email",
          "birth_date",
          "branch_id",
          "department_id",
          "position_id",
          "manager_employee_id",
          "probation_end_date",
          "termination_date",
          "termination_reason",
          "national_id",
          "bank_code",
          "account_name",
          "account_number",
        ])
          if (k in r && !r[k]) r[k] = null;
        if (!r.password) delete r.password;
        return {
          ...r,
          salary_satang: Math.round(salary_baht * 100),
          regular_allowances: allowances || [],
        };
      },
      (b) => (
        <div>
          <h3>
            {b.first_name_th} {b.last_name_th}
          </h3>
          <p>
            {t("ค่าจ้าง", "Wage")}:{" "}
            {money(Math.round(Number(b.salary_baht || 0) * 100))}
          </p>
          {existing && (
            <p>
              {t("ค่าจ้างเดิม", "Previous wage")}:{" "}
              {money(ch?.base_salary_satang || 0)}
            </p>
          )}
        </div>
      ),
    );
  }
  function leaveForm() {
    editor(
      t("ยื่นคำขอลา", "Request leave"),
      "20005",
      [
        lookup("employee_id", "พนักงาน", "Employee", "employees", true),
        lookup("leave_type_id", "ประเภทลา", "Leave type", "leave_types", true),
        f("start_date", "วันเริ่มต้น", "Start date", "date"),
        f("end_date", "วันสิ้นสุด", "End date", "date"),
        {
          ...f(
            "minutes_per_day",
            "นาทีต่อวัน (480 เต็มวัน / 240 ครึ่งวัน)",
            "Minutes per day (480 full / 240 half)",
            "number",
          ),
          min: "1",
        },
        f(
          "start_work_minute",
          "เริ่มนาทีทำงาน (0 เช้า / 240 บ่าย)",
          "Start work minute (0 morning / 240 afternoon)",
          "number",
        ),
        f("reason", "เหตุผล", "Reason", "textarea"),
      ],
      "/leaves",
      {
        employee_id: context?.employee_id || "",
        start_date: day(),
        end_date: day(),
        minutes_per_day: 480,
        start_work_minute: 0,
      },
    );
  }
  function announcementForm(r?: Row) {
    editor(
      t(
        r ? "แก้ไขประกาศ" : "สร้างประกาศ",
        r ? "Edit announcement" : "Create announcement",
      ),
      "20006",
      [
        f("title", "หัวข้อ", "Title"),
        f("body", "เนื้อหา", "Body", "textarea"),
        choice("priority", "ความสำคัญ", "Priority", [
          "LOW",
          "NORMAL",
          "HIGH",
          "URGENT",
        ]),
        choice("status", "สถานะ", "Status", [
          "DRAFT",
          "SCHEDULED",
          "PUBLISHED",
          "ARCHIVED",
          "CANCELLED",
        ]),
        f(
          "scheduled_at",
          "ตั้งเวลาเผยแพร่",
          "Schedule publication",
          "datetime-local",
          false,
        ),
        f("expires_at", "หมดอายุ", "Expires at", "datetime-local", false),
        f(
          "requires_acknowledgement",
          "ต้องยืนยันรับทราบ",
          "Require acknowledgement",
          "checkbox",
          false,
        ),
        f(
          "group_scope",
          "ประกาศระดับกลุ่ม (ทุกบริษัทที่มีสิทธิ์)",
          "Group announcement (all accessible companies)",
          "checkbox",
          false,
        ),
        lookup(
          "department_target",
          "แผนกผู้รับ (ว่าง = ทุกคน)",
          "Target department (empty = everyone)",
          "departments",
        ),
        f("reason", "เหตุผล", "Reason", "textarea"),
      ],
      r ? "/announcements/" + r.id : "/announcements",
      {
        ...r,
        scheduled_at: r?.scheduled_at
          ? new Date(Date.parse(r.scheduled_at) + 7 * 3600000)
              .toISOString()
              .slice(0, 16)
          : "",
        expires_at: r?.expires_at
          ? new Date(Date.parse(r.expires_at) + 7 * 3600000)
              .toISOString()
              .slice(0, 16)
          : "",
        priority: r?.priority || "NORMAL",
        status: r?.status || "DRAFT",
        reason: "Announcement update",
        group_scope: r?.organization_id === null,
        department_target:
          r?.targets?.find((target: Row) => target.type === "DEPARTMENT")?.id ||
          "",
      },
      r ? "PUT" : "POST",
      (b) => {
        const { department_target, group_scope, ...data } = b;
        return {
          ...data,
          ...(group_scope
            ? {
                company_ids:
                  r?.company_ids || me!.companies.map((co: Row) => co.id),
              }
            : {}),
          scheduled_at: data.scheduled_at || null,
          expires_at: data.expires_at || null,
          targets: [
            department_target
              ? { type: "DEPARTMENT", id: department_target }
              : { type: "ALL", id: null },
          ],
        };
      },
      (b) => (
        <article>
          <Badge value={b.priority} />
          <h2>{b.title}</h2>
          <p className="prewrap">{b.body}</p>
        </article>
      ),
    );
  }
  async function showPayroll(id: string) {
    try {
      setDetail(await request(base + "/payroll/" + id));
      setDetailType("payroll");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const exportData = (module: string) =>
    setModal(
      <Confirm
        title={t("ส่งออกรายงาน", "Export report")}
        t={t}
        onClose={() => setModal(null)}
        onConfirm={async (reason) => {
          const r = await request(base + "/exports", "POST", {
            module,
            reason,
          });
          location.assign(r.url);
          setModal(null);
        }}
      />,
    );
  if (!me) {
    const params = new URLSearchParams(location.search),
      token = params.get("token"),
      kind = location.pathname.includes("reset-password")
        ? "reset"
        : location.pathname.includes("accept-invitation")
          ? "invitation"
          : "login";
    return (
      <div className="login">
        <div className="login-art">
          <div className="brand">
            <Users /> NEXTHRM
          </div>
          <h1>
            {t(
              "ทุกคน ทุกบริษัท\nในพื้นที่เดียว",
              "Your people.\nOne workspace.",
            )}
          </h1>
          <p>
            {t(
              "ดูแลบุคลากร เวลา และค่าตอบแทนอย่างเป็นระบบ",
              "Bring people, time and compensation together.",
            )}
          </p>
          <div className="art-grid">
            <span>
              <Users />
              {t("บุคลากร", "People")}
            </span>
            <span>
              <Clock3 />
              {t("เวลาทำงาน", "Time")}
            </span>
            <span>
              <Wallet />
              {t("ค่าตอบแทน", "Payroll")}
            </span>
          </div>
        </div>
        <div className="login-form">
          <span className="page-id">10000</span>
          <h2>
            {t(
              kind === "login"
                ? "ยินดีต้อนรับกลับ"
                : kind === "reset"
                  ? "ตั้งรหัสผ่านใหม่"
                  : "ตอบรับคำเชิญ",
              kind === "login"
                ? "Welcome back"
                : kind === "reset"
                  ? "Reset password"
                  : "Accept invitation",
            )}
          </h2>
          <p className="muted">
            {t("เข้าสู่พื้นที่ทำงานของคุณ", "Sign in to your workspace")}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setLoading(true);
              const values = Object.fromEntries(new FormData(e.currentTarget));
              try {
                if (kind === "login") {
                  await request("/api/auth/login", "POST", values);
                  const u = await request("/api/me");
                  setMe(u);
                  if (u.companies[0]) setCompany(u.companies[0].id);
                } else {
                  await request(
                    "/api/auth/" +
                      (kind === "reset"
                        ? "reset-password"
                        : "accept-invitation"),
                    "POST",
                    { ...values, token },
                  );
                  location.assign("/");
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setLoading(false);
              }
            }}
          >
            {kind === "login" ? (
              <>
                <label htmlFor="workspace">
                  {t("รหัส Workspace", "Workspace code")}
                </label>
                <input
                  id="workspace"
                  name="workspace"
                  required
                  autoComplete="organization"
                />
                <label htmlFor="email">{t("อีเมล", "Email")}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                />
              </>
            ) : kind === "invitation" ? (
              <>
                <label htmlFor="name">{t("ชื่อผู้ใช้", "Display name")}</label>
                <input id="name" name="display_name" required />
              </>
            ) : null}
            <label htmlFor="password">{t("รหัสผ่าน", "Password")}</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={kind === "login" ? 1 : 12}
              autoComplete={
                kind === "login" ? "current-password" : "new-password"
              }
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={loading}>
              {loading
                ? t("กำลังดำเนินการ…", "Please wait…")
                : t("ดำเนินการ", "Continue")}
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            className="language"
            onClick={() => setLang(lang === "th" ? "en" : "th")}
          >
            {lang === "th" ? "English" : "ภาษาไทย"}
          </button>
        </div>
      </div>
    );
  }
  const selected = pages.find((p) => p.key === active)!,
    visiblePages = pages.filter((p) => !p.permission || permit(p.permission));
  const detailClose = () => {
    setDetail(null);
    setDetailType("");
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Users /> NEXTHRM
        </div>
        <label className="company-label" htmlFor="company">
          {t("บริษัทปัจจุบัน", "CURRENT COMPANY")}
        </label>
        <select
          id="company"
          value={company}
          onChange={(e) => changeCompany(e.target.value)}
        >
          {me.companies.map((co: Row) => (
            <option key={co.id} value={co.id}>
              {co.display_name}
            </option>
          ))}
        </select>
        <nav>
          {visiblePages.map((p) => (
            <button
              key={p.key}
              className={p.key === active ? "nav-item selected" : "nav-item"}
              onClick={() => navigate(p.key)}
            >
              <p.icon size={20} />
              {t(p.th, p.en)}
            </button>
          ))}
        </nav>
        <button
          className="nav-item logout"
          onClick={async () => {
            await request("/api/logout", "POST", {});
            location.assign("/");
          }}
        >
          <LogOut size={19} />
          {t("ออกจากระบบ", "Logout")}
        </button>
        <small className="sidebar-caption">HRM WORKSPACE · V3</small>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            {t("พื้นที่ทำงาน", "Workspace")} <span>/</span>{" "}
            {t(selected.th, selected.en)}
          </span>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label={t("เปลี่ยนธีม", "Toggle theme")}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button onClick={() => setLang(lang === "th" ? "en" : "th")}>
              {lang === "th" ? "EN" : "ไทย"}
            </button>
            <button
              className="icon-button bell"
              aria-label={t("การแจ้งเตือน", "Notifications")}
              onClick={() => setNoticePanel(!noticePanel)}
            >
              <Bell size={20} />
              {notifications.unread > 0 && <b>{notifications.unread}</b>}
            </button>
            <span className="avatar">{me.display_name.slice(0, 1)}</span>
            <div className="user-label">
              <strong>{me.display_name}</strong>
              <small>{me.email}</small>
            </div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="page-id">{selected.id}</span>
              <h1>{t(selected.th, selected.en)}</h1>
              <p>
                {t(
                  context?.company.display_name || "เลือกบริษัท",
                  context?.company.display_name || "Select company",
                )}{" "}
                <span>·</span>{" "}
                {new Date().toLocaleDateString(
                  lang === "th" ? "th-TH" : "en-GB",
                  { timeZone: "Asia/Bangkok", dateStyle: "long" },
                )}
              </p>
            </div>
            <div className="heading-actions">
              {active === "dashboard" && permit("exports.write") && (
                <button
                  onClick={async () => {
                    try {
                      const report = await request(
                        base +
                          "/reports/companies?companies=" +
                          me!.companies.map((co: Row) => co.id).join(","),
                      );
                      setDetail(report);
                      setDetailType("company-report");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {t("ภาพรวมกลุ่มบริษัท", "Group overview")}
                </button>
              )}
              {active === "settings" && setting === "leave_types" && (
                <button
                  onClick={() =>
                    editor(
                      t("ปรับสิทธิ์ลา", "Adjust leave balance"),
                      "20025",
                      [
                        lookup(
                          "employee_id",
                          "พนักงาน",
                          "Employee",
                          "employees",
                          true,
                        ),
                        lookup(
                          "leave_type_id",
                          "ประเภทลา",
                          "Leave type",
                          "leave_types",
                          true,
                        ),
                        f("balance_year", "ปี ค.ศ.", "Year", "number"),
                        choice("transaction_type", "ประเภท", "Transaction", [
                          "ACCRUAL",
                          "ADJUSTMENT",
                          "CARRY_FORWARD",
                          "EXPIRY",
                        ]),
                        f(
                          "hours",
                          "จำนวนชั่วโมง (+เพิ่ม / -ลด)",
                          "Hours (+credit / -debit)",
                          "number",
                        ),
                        f("reason", "เหตุผล", "Reason", "textarea"),
                      ],
                      "/leaves/balance-adjustment",
                      {
                        balance_year: Number(day().slice(0, 4)),
                        transaction_type: "ADJUSTMENT",
                      },
                      "POST",
                      (b) => {
                        const { hours, ...r } = b;
                        return { ...r, minutes: Math.round(hours * 60) };
                      },
                    )
                  }
                >
                  {t("ปรับสิทธิ์ลา", "Adjust balance")}
                </button>
              )}
              {active === "settings" && setting === "departments" && (
                <button
                  onClick={() =>
                    editor(
                      t("กำหนดกำลังคนขั้นต่ำ", "Minimum staffing"),
                      "20026",
                      [
                        lookup(
                          "department_id",
                          "แผนก",
                          "Department",
                          "departments",
                          true,
                        ),
                        f(
                          "minimum_staff_count",
                          "จำนวนที่ต้องทำงานขั้นต่ำ",
                          "Minimum staff working",
                          "number",
                        ),
                        f(
                          "maximum_leave_count",
                          "จำนวนลาสูงสุดต่อวัน",
                          "Maximum staff on leave",
                          "number",
                        ),
                        f(
                          "effective_from",
                          "วันที่มีผล",
                          "Effective from",
                          "date",
                        ),
                      ],
                      "/settings/staffing",
                      {
                        minimum_staff_count: 1,
                        maximum_leave_count: 1,
                        effective_from: day(),
                      },
                    )
                  }
                >
                  {t("กำลังคนขั้นต่ำ", "Staffing rule")}
                </button>
              )}
              {active === "settings" &&
                setting === "company" &&
                permit("*") && (
                  <button
                    onClick={() =>
                      editor(
                        t("ความสัมพันธ์บริษัท", "Company relationship"),
                        "20027",
                        [
                          {
                            ...f(
                              "parent_organization_id",
                              "บริษัทแม่",
                              "Parent company",
                            ),
                            options: me!.companies.map((co: Row) => ({
                              value: co.id,
                              label: co.display_name,
                            })),
                          },
                          {
                            ...f(
                              "child_organization_id",
                              "บริษัทลูก",
                              "Child company",
                            ),
                            options: me!.companies.map((co: Row) => ({
                              value: co.id,
                              label: co.display_name,
                            })),
                          },
                          choice(
                            "relationship_type",
                            "ความสัมพันธ์",
                            "Relationship",
                            ["SUBSIDIARY", "AFFILIATE", "MANAGED_BY"],
                          ),
                          f(
                            "effective_from",
                            "วันที่มีผล",
                            "Effective from",
                            "date",
                          ),
                        ],
                        "/companies/relationships",
                        {
                          effective_from: day(),
                          relationship_type: "SUBSIDIARY",
                        },
                      )
                    }
                  >
                    {t("ความสัมพันธ์บริษัท", "Company relationship")}
                  </button>
                )}
              {active === "users" && permit("*") && (
                <button
                  onClick={async () => {
                    const roles = await request(base + "/roles");
                    editor(
                      t("สร้างบทบาท", "Create role"),
                      "20028",
                      [
                        f("code", "รหัสบทบาท", "Role code"),
                        f("name", "ชื่อบทบาท", "Role name"),
                        {
                          ...f(
                            "permissions",
                            "ความสามารถที่อนุญาต (เลือกได้หลายรายการ)",
                            "Allowed capabilities (select multiple)",
                            "multi-select",
                          ),
                          options: roles.permissions.map((p: Row) => ({
                            value: p.code,
                            label: p.code.replaceAll(".", " · "),
                          })),
                        },
                      ],
                      "/roles",
                    );
                  }}
                >
                  {t("สร้างบทบาท", "Create role")}
                </button>
              )}

              {active === "employees" && permit("employees.write") && (
                <button className="primary" onClick={() => employeeForm()}>
                  <Plus size={18} />
                  {t("เพิ่มพนักงาน", "Add employee")}
                </button>
              )}
              {active === "leaves" && (
                <button className="primary" onClick={leaveForm}>
                  <Plus size={18} />
                  {t("ยื่นคำขอลา", "Request leave")}
                </button>
              )}
              {active === "announcements" && permit("announcements.write") && (
                <button className="primary" onClick={() => announcementForm()}>
                  <Plus size={18} />
                  {t("สร้างประกาศ", "Create announcement")}
                </button>
              )}
              {active === "payroll" && permit("payroll.prepare") && (
                <button
                  className="primary"
                  onClick={() =>
                    editor(
                      t("สร้างรอบเงินเดือน", "Create payroll cycle"),
                      "20007",
                      [
                        f("code", "รหัสรอบ", "Cycle code"),
                        f("name", "ชื่อรอบ", "Cycle name"),
                        choice("cycle_type", "รอบจ่าย", "Cycle frequency", [
                          "DAILY",
                          "WEEKLY",
                          "BIWEEKLY",
                          "MONTHLY",
                        ]),
                        f("period_start", "เริ่มงวด", "Period start", "date"),
                        f("period_end", "สิ้นสุดงวด", "Period end", "date"),
                        f("pay_date", "วันที่จ่าย", "Pay date", "date"),
                      ],
                      "/payroll",
                      {
                        cycle_type: "MONTHLY",
                        period_start: day().slice(0, 8) + "01",
                        period_end: day(),
                        pay_date: day(),
                      },
                      "POST",
                      (b) => ({
                        ...b,
                        employee_ids: (lookups.employees || []).map(
                          (e: Row) => e.id,
                        ),
                      }),
                    )
                  }
                >
                  <Plus size={18} />
                  {t("สร้างรอบ", "Create cycle")}
                </button>
              )}
              {["employees", "attendance", "audit"].includes(active) &&
                permit("exports.write") && (
                  <button onClick={() => exportData(active)}>
                    <Download size={18} />
                    {t("ส่งออก", "Export")}
                  </button>
                )}
            </div>
          </div>
          {message && (
            <div className="success" role="status">
              <Check size={18} />
              {message}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setRevision((v) => v + 1)}>
                <RefreshCw size={16} />
                {t("ลองใหม่", "Retry")}
              </button>
            </div>
          )}
          {loading ? (
            <div className="skeleton">
              <div />
              <div />
              <div />
            </div>
          ) : (
            <>
              {active === "dashboard" && (
                <>
                  <div className="stats">
                    {[
                      ["พนักงาน", "Employees", data.total || 0, Users],
                      ["มาทำงาน", "Present", data.present || 0, Clock3],
                      ["ลางาน", "On leave", data.leave || 0, CalendarDays],
                      ["มาสาย", "Late", data.late || 0, Clock3],
                    ].map(([th, en, value, Icon]: any, i) => (
                      <button
                        key={en}
                        className="stat"
                        onClick={() =>
                          navigate(
                            i === 0
                              ? "employees"
                              : i === 2
                                ? "leaves"
                                : "attendance",
                          )
                        }
                      >
                        <span>{t(th, en)}</span>
                        <strong>{value}</strong>
                        <Icon size={22} />
                      </button>
                    ))}
                  </div>
                  <div className="dashboard-grid">
                    <section className="panel">
                      <div className="panel-title">
                        <h2>{t("ทีมวันนี้", "Your team today")}</h2>
                        <Badge value="LIVE" />
                      </div>
                      <DataTable
                        t={t}
                        rows={data.employees || []}
                        columns={[
                          nameColumn,
                          {
                            key: "department_name",
                            th: "แผนก",
                            en: "Department",
                          },
                          {
                            key: "position_name",
                            th: "ตำแหน่ง",
                            en: "Position",
                          },
                          {
                            key: "attendance_status",
                            th: "สถานะวันนี้",
                            en: "Today",
                            render: (r) => (
                              <Badge
                                value={r.attendance_status || "NOT CLOCKED"}
                              />
                            ),
                          },
                        ]}
                      />
                    </section>
                    <div className="dashboard-side">
                      <section className="panel">
                        <h2>{t("งานที่ต้องทำ", "Needs attention")}</h2>
                        <button
                          className="attention"
                          onClick={() => navigate("leaves")}
                        >
                          <CalendarDays />
                          <span>
                            {t("คำขอลารออนุมัติ", "Pending leave requests")}
                          </span>
                          <b>{data.pending_leaves || 0}</b>
                        </button>
                        <p className="muted">
                          {t(
                            "ตรวจคำขอและรายละเอียดก่อนอนุมัติ",
                            "Review requests and details before approving.",
                          )}
                        </p>
                      </section>
                      <section className="panel blue-panel">
                        <Building2 size={30} />
                        <h2>
                          {t(
                            "ข้อมูลแยกตามบริษัท",
                            "Company-specific workspace",
                          )}
                        </h2>
                        <p>
                          {t(
                            "ทุกการดำเนินการใช้สิทธิ์ของบริษัทปัจจุบัน และบันทึกประวัติการเปลี่ยนแปลง",
                            "Actions use your current company access and keep an audit trail.",
                          )}
                        </p>
                        <button onClick={() => navigate("profile")}>
                          {t("ข้อมูลของฉัน", "My profile")}
                          <ArrowRight size={16} />
                        </button>
                      </section>
                    </div>
                  </div>
                </>
              )}
              {active === "employees" && (
                <section className="panel">
                  <Filters
                    q={q}
                    setQ={(v) => {
                      setQ(v);
                      setOffset(0);
                    }}
                    t={t}
                  >
                    <select
                      aria-label={t("แผนก", "Department")}
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    >
                      <option value="">
                        {t("ทุกแผนก", "All departments")}
                      </option>
                      {(lookups.departments || []).map((d: Row) => (
                        <option value={d.id} key={d.id}>
                          {d.name_th}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("สถานะ", "Status")}
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">{t("ทุกสถานะ", "All statuses")}</option>
                      {[
                        "ACTIVE",
                        "DRAFT",
                        "ON_LEAVE",
                        "SUSPENDED",
                        "TERMINATED",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Filters>
                  <DataTable
                    rows={data.items || []}
                    t={t}
                    columns={[
                      nameColumn,
                      { key: "department_name", th: "แผนก", en: "Department" },
                      { key: "position_name", th: "ตำแหน่ง", en: "Position" },
                      statusColumn,
                      dateColumn("hire_date", "วันเริ่มงาน", "Hire date"),
                    ]}
                    actions={(r) => (
                      <>
                        <button
                          className="link"
                          onClick={() => showEmployee(r.id)}
                        >
                          {t("รายละเอียด", "Details")}
                        </button>
                        {permit("employees.write") && (
                          <button
                            className="delete-button"
                            onClick={() =>
                              action(
                                t("ลบพนักงาน", "Delete employee"),
                                "/employees/" + r.id,
                                {},
                                "DELETE",
                              )
                            }
                          >
                            <Trash2 size={15} />
                            delete
                          </button>
                        )}
                      </>
                    )}
                  />
                  <Pager
                    t={t}
                    offset={offset}
                    total={data.total || 0}
                    onChange={setOffset}
                  />
                </section>
              )}
              {active === "profile" &&
                (context?.employee_id ? (
                  <section className="panel">
                    <EmployeeReport employee={data} t={t} />
                    <div className="toolbar">
                      <button
                        onClick={() =>
                          editor(
                            t("ส่งคำขอแก้ไขข้อมูล", "Request profile change"),
                            "20008",
                            [
                              f(
                                "mobile_phone",
                                "โทรศัพท์",
                                "Phone",
                                "tel",
                                false,
                              ),
                              f(
                                "nickname",
                                "ชื่อเล่น",
                                "Nickname",
                                "text",
                                false,
                              ),
                              f("reason", "เหตุผล", "Reason", "textarea"),
                            ],
                            "/employees/" + data.id + "/change-requests",
                            {
                              mobile_phone: data.mobile_phone,
                              nickname: data.nickname,
                            },
                            "POST",
                            (b) => ({
                              reason: b.reason,
                              changes: {
                                mobile_phone: b.mobile_phone,
                                nickname: b.nickname,
                              },
                            }),
                          )
                        }
                      >
                        {t("ขอแก้ไขข้อมูล", "Request change")}
                      </button>
                      <button
                        onClick={() =>
                          editor(
                            t("เพิ่มประสบการณ์ทำงาน", "Add work experience"),
                            "20009",
                            [
                              f("company_name", "บริษัท", "Company"),
                              f("position_name", "ตำแหน่ง", "Position"),
                              f("started_on", "เริ่มงาน", "Started on", "date"),
                              f(
                                "ended_on",
                                "สิ้นสุด",
                                "Ended on",
                                "date",
                                false,
                              ),
                              f(
                                "description",
                                "รายละเอียด",
                                "Description",
                                "textarea",
                                false,
                              ),
                            ],
                            "/employees/" + data.id + "/experiences",
                            {},
                            "POST",
                            (b) => ({ ...b, ended_on: b.ended_on || null }),
                          )
                        }
                      >
                        <Plus size={16} />
                        {t("เพิ่มประสบการณ์", "Add experience")}
                      </button>
                    </div>
                  </section>
                ) : (
                  <div className="empty">
                    {t(
                      "บัญชีนี้ยังไม่ได้เชื่อมกับพนักงาน ติดต่อ HR",
                      "This account is not linked to an employee. Contact HR.",
                    )}
                  </div>
                ))}
              {active === "attendance" && (
                <section className="panel">
                  <div className="toolbar">
                    {context?.employee_id && (
                      <>
                        <button
                          className="primary"
                          onClick={() =>
                            request(base + "/attendance/clock", "POST", {
                              action: "IN",
                            })
                              .then(mutate)
                              .catch((e) => setError(e.message))
                          }
                        >
                          {t("ลงเวลาเข้า", "Clock in")}
                        </button>
                        <button
                          onClick={() =>
                            request(base + "/attendance/clock", "POST", {
                              action: "OUT",
                            })
                              .then(mutate)
                              .catch((e) => setError(e.message))
                          }
                        >
                          {t("ลงเวลาออก", "Clock out")}
                        </button>
                        <button
                          onClick={() =>
                            editor(
                              t("ขอ OT", "Request overtime"),
                              "20010",
                              [
                                lookup(
                                  "employee_id",
                                  "พนักงาน",
                                  "Employee",
                                  "employees",
                                  true,
                                ),
                                f("work_date", "วันที่", "Date", "date"),
                                f(
                                  "start_at",
                                  "เริ่ม",
                                  "Start",
                                  "datetime-local",
                                ),
                                f("end_at", "สิ้นสุด", "End", "datetime-local"),
                                f("reason", "เหตุผล", "Reason", "textarea"),
                              ],
                              "/overtime",
                              {
                                employee_id: context.employee_id,
                                work_date: day(),
                              },
                            )
                          }
                        >
                          {t("ขอ OT", "Request overtime")}
                        </button>
                      </>
                    )}
                    {permit("attendance.write") && (
                      <button
                        onClick={() =>
                          editor(
                            t("แก้ไขเวลา", "Correct attendance"),
                            "20011",
                            [
                              lookup(
                                "employee_id",
                                "พนักงาน",
                                "Employee",
                                "employees",
                                true,
                              ),
                              f("work_date", "วันที่", "Date", "date"),
                              f(
                                "check_in_at",
                                "เวลาเข้า",
                                "Clock in",
                                "datetime-local",
                              ),
                              f(
                                "check_out_at",
                                "เวลาออก",
                                "Clock out",
                                "datetime-local",
                              ),
                              f("reason", "เหตุผล", "Reason", "textarea"),
                            ],
                            "/attendance/manual",
                            { work_date: day() },
                          )
                        }
                      >
                        {t("แก้ไขเวลา", "Correct attendance")}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          const r = await request(base + "/overtime");
                          setDetail(r);
                          setDetailType("overtime");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      {t("รายการ OT", "Overtime requests")}
                    </button>
                  </div>
                  <DataTable
                    rows={data.items || []}
                    t={t}
                    columns={[
                      nameColumn,
                      dateColumn("work_date", "วันที่", "Date"),
                      dateColumn("check_in_at", "เวลาเข้า", "Clock in"),
                      dateColumn("check_out_at", "เวลาออก", "Clock out"),
                      {
                        key: "worked_minutes",
                        th: "นาทีทำงาน",
                        en: "Worked minutes",
                      },
                      {
                        key: "late_minutes",
                        th: "มาสาย (นาที)",
                        en: "Late minutes",
                      },
                      statusColumn,
                    ]}
                  />
                </section>
              )}
              {active === "leaves" && (
                <section className="panel">
                  <div className="toolbar">
                    <button
                      className={!calendar ? "active-tab" : ""}
                      onClick={() => setCalendar(false)}
                    >
                      {t("รายการ", "List")}
                    </button>
                    <button
                      className={calendar ? "active-tab" : ""}
                      onClick={() => setCalendar(true)}
                    >
                      <CalendarDays size={16} />
                      {t("ปฏิทินเดือนนี้", "This month")}
                    </button>
                  </div>
                  {calendar ? (
                    <div className="calendar-grid">
                      {Array.from(
                        {
                          length: new Date(
                            Number(day().slice(0, 4)),
                            Number(day().slice(5, 7)),
                            0,
                          ).getDate(),
                        },
                        (_, i) => {
                          const d =
                            day().slice(0, 8) + String(i + 1).padStart(2, "0");
                          return (
                            <div className="calendar-day" key={d}>
                              <b>{i + 1}</b>
                              {(data.items || [])
                                .filter(
                                  (r: Row) =>
                                    r.start_at.slice(0, 10) <= d &&
                                    r.end_at.slice(0, 10) >= d,
                                )
                                .map((r: Row) => (
                                  <button
                                    key={r.id}
                                    onClick={async () => {
                                      setDetail(
                                        await request(base + "/leaves/" + r.id),
                                      );
                                      setDetailType("leave");
                                    }}
                                  >
                                    {r.first_name_th} · {r.type_name}
                                  </button>
                                ))}
                            </div>
                          );
                        },
                      )}
                    </div>
                  ) : (
                    <DataTable
                      rows={data.items || []}
                      t={t}
                      columns={[
                        nameColumn,
                        { key: "type_name", th: "ประเภทลา", en: "Leave type" },
                        dateColumn("start_at", "เริ่ม", "Start"),
                        dateColumn("end_at", "สิ้นสุด", "End"),
                        { key: "requested_minutes", th: "นาที", en: "Minutes" },
                        statusColumn,
                      ]}
                      actions={(r) => (
                        <button
                          onClick={async () => {
                            setDetail(await request(base + "/leaves/" + r.id));
                            setDetailType("leave");
                          }}
                        >
                          {t("รายละเอียด", "Details")}
                        </button>
                      )}
                    />
                  )}
                </section>
              )}
              {active === "payroll" && (
                <section className="panel">
                  <DataTable
                    rows={data.items || []}
                    t={t}
                    columns={[
                      { key: "name", th: "รอบเงินเดือน", en: "Payroll cycle" },
                      { key: "cycle_type", th: "รอบจ่าย", en: "Frequency" },
                      dateColumn("period_start", "เริ่มงวด", "Period start"),
                      dateColumn("pay_date", "วันที่จ่าย", "Pay date"),
                      amountColumn("total_net_satang", "ยอดสุทธิ", "Net total"),
                      {
                        key: "blocking_error_count",
                        th: "รายการปิดกั้น",
                        en: "Blocking errors",
                      },
                      statusColumn,
                    ]}
                    actions={(r) => (
                      <button onClick={() => showPayroll(r.id)}>
                        {t("ตรวจสอบ", "Review")}
                      </button>
                    )}
                  />
                </section>
              )}
              {active === "payslips" && (
                <section className="panel">
                  <DataTable
                    rows={data.items || []}
                    t={t}
                    columns={[
                      { key: "slip_no", th: "เลขสลิป", en: "Slip number" },
                      { key: "cycle_name", th: "งวด", en: "Cycle" },
                      amountColumn("net_pay_satang", "รับสุทธิ", "Net pay"),
                      dateColumn("published_at", "เผยแพร่", "Published"),
                    ]}
                    actions={(r) => (
                      <button
                        onClick={async () => {
                          setDetail(await request(base + "/payslips/" + r.id));
                          setDetailType("payslip");
                        }}
                      >
                        {t("เปิดสลิป", "Open payslip")}
                      </button>
                    )}
                  />
                </section>
              )}
              {active === "announcements" && (
                <div className="announcement-list">
                  {!(data.items || []).length && (
                    <div className="empty">
                      {t("ยังไม่มีประกาศ", "No announcements")}
                    </div>
                  )}
                  {(data.items || []).map((a: Row) => (
                    <article className="panel announcement" key={a.id}>
                      <div className="toolbar">
                        <Badge value={a.priority} />
                        <Badge value={a.status} />
                        <small>
                          {localDate(a.published_at || a.created_at)}
                        </small>
                      </div>
                      <h2>
                        <button
                          className="title-button"
                          onClick={async () => {
                            try {
                              if (a.status === "PUBLISHED")
                                await request(
                                  base + "/announcements/" + a.id + "/open",
                                  "POST",
                                  {},
                                );
                              setDetail(a);
                              setDetailType("announcement");
                              loadNotifications();
                              setRevision((v) => v + 1);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          {a.title}
                        </button>
                      </h2>
                      <p className="prewrap">
                        {a.body.slice(0, 220)}
                        {a.body.length > 220 ? "…" : ""}
                      </p>
                      {permit("announcements.write") && (
                        <>
                          <div className="activity-summary">
                            <span>
                              {t("ผู้รับ", "Recipients")}: {a.recipient_count}
                            </span>
                            <span>
                              {t("ผู้เปิดอ่าน", "Readers")}: {a.unique_viewers}
                            </span>
                            <span>
                              {t("เปิดทั้งหมด", "Total views")}: {a.total_views}
                            </span>
                          </div>
                          <div className="toolbar">
                            <button onClick={() => announcementForm(a)}>
                              {t("แก้ไข", "Edit")}
                            </button>
                            <button
                              onClick={() => {
                                setDetail(a);
                                setDetailType("activity");
                              }}
                            >
                              {t("รายงานผู้เปิดอ่าน", "Read activity")}
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {active === "settings" && (
                <>
                  <section className="panel">
                    <div className="toolbar">
                      {[
                        "departments",
                        "branches",
                        "positions",
                        "job_levels",
                        "work_schedules",
                        "leave_types",
                        "holidays",
                        "company",
                      ].map((v) => (
                        <button
                          className={setting === v ? "active-tab" : ""}
                          key={v}
                          onClick={() => setSetting(v)}
                        >
                          {t(
                            (
                              {
                                departments: "แผนก",
                                branches: "สาขา",
                                positions: "ตำแหน่ง",
                                job_levels: "ระดับงาน",
                                work_schedules: "ตารางงาน",
                                leave_types: "ประเภทลา",
                                holidays: "วันหยุด",
                                company: "บริษัท",
                              } as Row
                            )[v],
                            v.replaceAll("_", " "),
                          )}
                        </button>
                      ))}
                    </div>
                    {setting === "company" ? (
                      <>
                        <h2>{data.display_name}</h2>
                        <p>
                          {data.legal_name} · {data.code}
                        </p>
                        <button
                          onClick={() =>
                            editor(
                              t("เพิ่มบริษัท", "Add company"),
                              "20012",
                              [
                                f("code", "รหัสบริษัท", "Company code"),
                                f("display_name", "ชื่อแสดง", "Display name"),
                                f("legal_name", "ชื่อนิติบุคคล", "Legal name"),
                              ],
                              "/companies",
                            )
                          }
                        >
                          {t("เพิ่มบริษัท", "Add company")}
                        </button>
                        <button
                          onClick={() =>
                            editor(
                              t(
                                "ตั้งค่าบริษัทและ Payroll",
                                "Company and payroll settings",
                              ),
                              "20013",
                              [
                                f("display_name", "ชื่อแสดง", "Display name"),
                                f("legal_name", "ชื่อนิติบุคคล", "Legal name"),
                                choice("status", "สถานะ", "Status", [
                                  "ACTIVE",
                                  "INACTIVE",
                                ]),
                                f(
                                  "social_security_percent",
                                  "อัตราประกันสังคม (%)",
                                  "Social security rate (%)",
                                  "number",
                                ),
                                f(
                                  "social_security_cap_baht",
                                  "เพดานเงินสมทบ (บาท)",
                                  "Contribution cap (THB)",
                                  "number",
                                ),
                                f(
                                  "effective_from",
                                  "วันที่มีผล",
                                  "Effective from",
                                  "date",
                                ),
                                f(
                                  "source_reference",
                                  "แหล่งอ้างอิงที่ตรวจสอบแล้ว",
                                  "Verified source reference",
                                ),
                                f("verified_by", "ผู้ตรวจสอบ", "Verified by"),
                                f("reason", "เหตุผล", "Reason", "textarea"),
                              ],
                              "/settings/company",
                              {
                                ...data,
                                ...data.settings?.payroll,
                                social_security_percent:
                                  (data.settings?.payroll
                                    ?.social_security_rate_basis_points || 0) /
                                  100,
                                social_security_cap_baht:
                                  (data.settings?.payroll
                                    ?.social_security_cap_satang || 0) / 100,
                              },
                              "PUT",
                              (b) => {
                                const {
                                  display_name,
                                  legal_name,
                                  status,
                                  reason,
                                  ...payroll
                                } = b;
                                return {
                                  display_name,
                                  legal_name,
                                  status,
                                  reason,
                                  payroll: {
                                    social_security_rate_basis_points:
                                      Math.round(
                                        payroll.social_security_percent * 100,
                                      ),
                                    social_security_cap_satang: Math.round(
                                      payroll.social_security_cap_baht * 100,
                                    ),
                                    effective_from: payroll.effective_from,
                                    source_reference: payroll.source_reference,
                                    verified_by: payroll.verified_by,
                                  },
                                };
                              },
                            )
                          }
                        >
                          {t("แก้ไขค่าตั้ง", "Edit settings")}
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="toolbar">
                          <button
                            className="primary"
                            onClick={() => {
                              let fields: Field[] = [
                                f("code", "รหัส", "Code"),
                                f(
                                  setting === "job_levels" ||
                                    setting === "work_schedules"
                                    ? "name"
                                    : "name_th",
                                  "ชื่อ",
                                  "Name",
                                ),
                              ];
                              if (setting === "holidays")
                                fields = [
                                  f("holiday_date", "วันที่", "Date", "date"),
                                  f("name_th", "ชื่อวันหยุด", "Holiday name"),
                                ];
                              if (setting === "work_schedules")
                                fields.push(
                                  f(
                                    "break_minutes",
                                    "พัก (นาที)",
                                    "Break minutes",
                                    "number",
                                  ),
                                  f(
                                    "grace_late_minutes",
                                    "ผ่อนผันสาย (นาที)",
                                    "Grace minutes",
                                    "number",
                                  ),
                                );
                              if (setting === "leave_types")
                                fields.push(
                                  f(
                                    "is_paid",
                                    "ได้รับค่าจ้าง",
                                    "Paid leave",
                                    "checkbox",
                                    false,
                                  ),
                                  f(
                                    "requires_attachment",
                                    "ต้องแนบเอกสาร",
                                    "Attachment required",
                                    "checkbox",
                                    false,
                                  ),
                                  f(
                                    "annual_entitlement_minutes",
                                    "สิทธิ์ต่อปี (นาที)",
                                    "Annual entitlement (minutes)",
                                    "number",
                                  ),
                                );
                              editor(
                                t("เพิ่มรายการ", "Add setting"),
                                "20014",
                                fields,
                                "/settings/" + setting,
                                {
                                  break_minutes: 60,
                                  grace_late_minutes: 0,
                                  annual_entitlement_minutes: 4800,
                                  is_paid: true,
                                },
                                "POST",
                                (b) =>
                                  setting === "work_schedules"
                                    ? {
                                        ...b,
                                        days: Array.from(
                                          { length: 7 },
                                          (_, i) => ({
                                            weekday: i + 1,
                                            is_workday: i < 5,
                                            start_time: "09:00",
                                            end_time: "18:00",
                                          }),
                                        ),
                                      }
                                    : b,
                              );
                            }}
                          >
                            <Plus size={17} />
                            {t("เพิ่ม", "Add")}
                          </button>
                          {setting === "work_schedules" && (
                            <button
                              onClick={() =>
                                editor(
                                  t("มอบหมายตารางงาน", "Assign schedule"),
                                  "20015",
                                  [
                                    lookup(
                                      "employee_id",
                                      "พนักงาน",
                                      "Employee",
                                      "employees",
                                      true,
                                    ),
                                    lookup(
                                      "work_schedule_id",
                                      "ตาราง",
                                      "Schedule",
                                      "work_schedules",
                                      true,
                                    ),
                                    f(
                                      "effective_from",
                                      "วันที่มีผล",
                                      "Effective from",
                                      "date",
                                    ),
                                    f(
                                      "effective_to",
                                      "สิ้นสุด",
                                      "Effective to",
                                      "date",
                                      false,
                                    ),
                                  ],
                                  "/settings/schedule-assignment",
                                  { effective_from: day() },
                                  "POST",
                                  (b) => ({
                                    ...b,
                                    effective_to: b.effective_to || null,
                                  }),
                                )
                              }
                            >
                              {t("มอบหมายตาราง", "Assign schedule")}
                            </button>
                          )}
                        </div>
                        <DataTable
                          rows={lookups[setting] || []}
                          t={t}
                          columns={[
                            { key: "code", th: "รหัส", en: "Code" },
                            {
                              key: "name",
                              th: "ชื่อ",
                              en: "Name",
                              render: (r) => r.name_th || r.name,
                            },
                            statusColumn,
                          ]}
                        />
                      </>
                    )}
                  </section>
                </>
              )}
              {active === "users" && (
                <section className="panel">
                  <div className="toolbar">
                    <button
                      className="primary"
                      onClick={() =>
                        editor(
                          t("เชิญผู้ใช้", "Invite user"),
                          "20016",
                          [
                            f("email", "อีเมล", "Email", "email"),
                            lookup("role_id", "บทบาท", "Role", "roles", true),
                          ],
                          "/users/invitations",
                          {},
                          "POST",
                          (b) => ({
                            email: b.email,
                            companies: [
                              { organization_id: company, role_id: b.role_id },
                            ],
                          }),
                        )
                      }
                    >
                      <Plus size={17} />
                      {t("เชิญผู้ใช้", "Invite user")}
                    </button>
                  </div>
                  <DataTable
                    rows={data.items || []}
                    t={t}
                    columns={[
                      { key: "display_name", th: "ชื่อ", en: "Name" },
                      { key: "email", th: "อีเมล", en: "Email" },
                      statusColumn,
                      {
                        key: "access",
                        th: "สิทธิ์ที่มี",
                        en: "Effective roles",
                        render: (r) =>
                          (data.access || [])
                            .filter(
                              (a: Row) =>
                                a.user_id === r.id &&
                                a.organization_id === company,
                            )
                            .map((a: Row) => a.role_code + " · " + a.scope_type)
                            .join(", "),
                      },
                    ]}
                    actions={(r) => (
                      <>
                        <button
                          onClick={() =>
                            editor(
                              t("เปลี่ยนสิทธิ์บริษัท", "Change company access"),
                              "20017",
                              [
                                lookup(
                                  "role_id",
                                  "บทบาท",
                                  "Role",
                                  "roles",
                                  true,
                                ),
                                choice("scope_type", "ขอบเขต", "Scope", [
                                  "COMPANY",
                                  "SELF",
                                ]),
                                choice("status", "สิทธิ์เข้าถึง", "Access", [
                                  "ACTIVE",
                                  "REVOKED",
                                ]),
                                f("reason", "เหตุผล", "Reason", "textarea"),
                              ],
                              "/users/" + r.id + "/access",
                              { scope_type: "COMPANY", status: "ACTIVE" },
                              "POST",
                              (b) => ({ ...b, organization_id: company }),
                            )
                          }
                        >
                          {t("สิทธิ์", "Access")}
                        </button>
                        <button
                          onClick={() =>
                            action(
                              t("ระงับผู้ใช้", "Suspend user"),
                              "/users/" + r.id,
                              { status: "SUSPENDED" },
                              "PUT",
                            )
                          }
                        >
                          {t("ระงับ", "Suspend")}
                        </button>
                        <button
                          onClick={() =>
                            action(
                              t("ปลดล็อก", "Unlock"),
                              "/users/" + r.id,
                              { status: "ACTIVE", unlock: true },
                              "PUT",
                            )
                          }
                        >
                          {t("ปลดล็อก", "Unlock")}
                        </button>
                        <button
                          onClick={async () => {
                            const reset = await request(
                              base + "/users/" + r.id + "/reset",
                              "POST",
                              {},
                            );
                            setDetail(reset);
                            setDetailType("reset");
                          }}
                        >
                          {t("ตั้งรหัสผ่านใหม่", "Reset password")}
                        </button>
                      </>
                    )}
                  />
                </section>
              )}
              {active === "audit" && (
                <section className="panel">
                  <Filters q={q} setQ={setQ} t={t} />
                  <DataTable
                    rows={data.items || []}
                    t={t}
                    columns={[
                      dateColumn("created_at", "เวลา", "Time"),
                      { key: "display_name", th: "ผู้ดำเนินการ", en: "Actor" },
                      { key: "action", th: "การกระทำ", en: "Action" },
                      { key: "object_type", th: "โมดูล", en: "Module" },
                      { key: "reason", th: "เหตุผล", en: "Reason" },
                    ]}
                    actions={(r) => (
                      <button
                        onClick={() => {
                          setDetail(r);
                          setDetailType("audit");
                        }}
                      >
                        {t("ดูการเปลี่ยนแปลง", "View diff")}
                      </button>
                    )}
                  />
                </section>
              )}
            </>
          )}
        </main>
      </div>
      <nav className="bottom-nav">
        {[pages[0], pages[2], pages[3], pages[5]].map((p) => (
          <button
            key={p.key}
            className={active === p.key ? "selected" : ""}
            onClick={() => navigate(p.key)}
          >
            <p.icon size={22} />
            <span>{t(p.th, p.en)}</span>
          </button>
        ))}
        <button
          onClick={() => setMobileMore(true)}
          className={mobileMore ? "selected" : ""}
        >
          <Menu size={22} />
          <span>{t("เพิ่มเติม", "More")}</span>
        </button>
      </nav>
      {mobileMore && (
        <Modal
          title={t("เมนูทั้งหมด", "All menus")}
          id="20018"
          t={t}
          onClose={() => setMobileMore(false)}
        >
          <div className="modal-body more-menu">
            <select
              aria-label={t("บริษัท", "Company")}
              value={company}
              onChange={(e) => {
                changeCompany(e.target.value);
                setMobileMore(false);
              }}
            >
              {me.companies.map((c: Row) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
            {visiblePages.map((p) => (
              <button key={p.key} onClick={() => navigate(p.key)}>
                <p.icon size={20} />
                {t(p.th, p.en)}
              </button>
            ))}
            <button
              onClick={async () => {
                await request("/api/logout", "POST", {});
                location.assign("/");
              }}
            >
              <LogOut size={20} />
              {t("ออกจากระบบ", "Logout")}
            </button>
          </div>
        </Modal>
      )}
      {noticePanel && (
        <Modal
          title={t("การแจ้งเตือน", "Notifications")}
          id="20019"
          t={t}
          onClose={() => setNoticePanel(false)}
        >
          <div className="modal-body">
            {!notifications.items.length && (
              <div className="empty">
                {t("ไม่มีการแจ้งเตือน", "No notifications")}
              </div>
            )}
            {notifications.items.map((n: Row) => (
              <button
                className="notification"
                key={n.id}
                onClick={async () => {
                  setNoticePanel(false);
                  if (n.source_type === "announcements") {
                    await request(
                      base + "/announcements/" + n.source_id + "/open",
                      "POST",
                      {},
                    );
                    navigate("announcements");
                    const announcements = await request(
                      base + "/announcements",
                    );
                    const a = announcements.items.find(
                      (r: Row) => r.id === n.source_id,
                    );
                    if (a) {
                      setDetail(a);
                      setDetailType("announcement");
                    }
                    loadNotifications();
                  } else {
                    const leave = await request(
                      base + "/leaves/" + n.source_id,
                    );
                    setDetail(leave);
                    setDetailType("leave");
                    await request(
                      base + "/notifications/" + n.id + "/read",
                      "POST",
                      {},
                    );
                    loadNotifications();
                  }
                }}
              >
                <span className={n.read_at ? "" : "unread-dot"} />
                <div>
                  <strong>{n.title}</strong>
                  <small>{localDate(n.created_at)}</small>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {detail && (
        <Modal
          title={t(
            (
              {
                employee: "รายละเอียดพนักงาน",
                leave: "รายละเอียดการลา",
                payroll: "ตรวจสอบรอบเงินเดือน",
                payslip: "สลิปเงินเดือน",
                announcement: "ประกาศ",
                activity: "ผู้เปิดอ่าน",
                audit: "ประวัติการเปลี่ยนแปลง",
                overtime: "คำขอ OT",
                reset: "ลิงก์ตั้งรหัสผ่าน",
              } as Row
            )[detailType] || "รายละเอียด",
            detailType,
          )}
          id="20001"
          onClose={detailClose}
          t={t}
        >
          <div className="modal-body">
            {detailType === "employee" && (
              <>
                <EmployeeReport employee={detail} t={t} />
                <div className="toolbar no-print">
                  <button onClick={() => window.print()}>
                    <Printer size={16} />
                    {t("พิมพ์โปรไฟล์", "Print profile")}
                  </button>
                  {permit("employees.write") && (
                    <>
                      <button
                        onClick={() => {
                          employeeForm(detail);
                          detailClose();
                        }}
                      >
                        {t("แก้ไข", "Edit")}
                      </button>
                      <button
                        onClick={() =>
                          editor(
                            t(
                              "ข้อมูลภาษีและประกันสังคม",
                              "Tax and social security",
                            ),
                            "20020",
                            [
                              choice("tax_method", "วิธีภาษี", "Tax method", [
                                "PROGRESSIVE",
                                "FIXED",
                                "EXEMPT",
                              ]),
                              f(
                                "fixed_tax_rate_basis_points",
                                "อัตราภาษีคงที่ (basis points)",
                                "Fixed tax rate (basis points)",
                                "number",
                                false,
                              ),
                              f(
                                "withholding_baht",
                                "ภาษีที่ตรวจสอบแล้ว (บาท)",
                                "Reviewed withholding (THB)",
                                "number",
                              ),
                              f(
                                "period_start",
                                "เริ่มงวด",
                                "Period start",
                                "date",
                              ),
                              f(
                                "period_end",
                                "สิ้นสุดงวด",
                                "Period end",
                                "date",
                              ),
                              f(
                                "contribution_enabled",
                                "เข้าร่วมประกันสังคม",
                                "Social security enrolled",
                                "checkbox",
                                false,
                              ),
                              f("reason", "เหตุผล", "Reason", "textarea"),
                            ],
                            "/employees/" + detail.id + "/tax-social",
                            {
                              tax_method: "PROGRESSIVE",
                              period_start: day().slice(0, 8) + "01",
                              period_end: day(),
                              withholding_baht: 0,
                              contribution_enabled: true,
                            },
                            "POST",
                            (b) => {
                              const { withholding_baht, ...r } = b;
                              return {
                                ...r,
                                withholding_satang: Math.round(
                                  withholding_baht * 100,
                                ),
                              };
                            },
                          )
                        }
                      >
                        {t("ภาษี / ประกันสังคม", "Tax / social security")}
                      </button>
                    </>
                  )}
                </div>
                {permit("employees.write") && (
                  <div className="toolbar">
                    <button
                      onClick={() =>
                        editor(
                          t("ย้ายหรือทำงานข้ามบริษัท", "Intercompany transfer"),
                          "20022",
                          [
                            {
                              ...f(
                                "destination_organization_id",
                                "บริษัทปลายทาง",
                                "Destination company",
                              ),
                              options: me.companies
                                .filter((co: Row) => co.id !== company)
                                .map((co: Row) => ({
                                  value: co.id,
                                  label: co.display_name,
                                })),
                            },
                            choice("transfer_type", "รูปแบบ", "Transfer type", [
                              "TRANSFER",
                              "SECONDMENT",
                              "DUAL_EMPLOYMENT",
                            ]),
                            f(
                              "effective_date",
                              "วันที่มีผล",
                              "Effective date",
                              "date",
                            ),
                            f("reason", "เหตุผล", "Reason", "textarea"),
                          ],
                          "/transfers",
                          { effective_date: day() },
                          "POST",
                          (b) => ({ ...b, employee_id: detail.id }),
                        )
                      }
                    >
                      {t("ขอย้ายบริษัท", "Request transfer")}
                    </button>
                    <button
                      onClick={async () => {
                        const r = await request(base + "/transfers");
                        setDetail(r);
                        setDetailType("transfers");
                      }}
                    >
                      {t("รายการย้ายบริษัท", "Transfer requests")}
                    </button>
                  </div>
                )}
                <h3>{t("บัญชีธนาคาร", "Bank accounts")}</h3>
                {(detail.banks || []).map((b: Row) => (
                  <p key={b.id}>
                    {b.bank_code} · ••••{b.account_number_last4} ·{" "}
                    {b.verified_at ? (
                      t("ยืนยันแล้ว", "Verified")
                    ) : (
                      <button
                        onClick={() =>
                          request(
                            base +
                              "/employees/" +
                              detail.id +
                              "/banks/" +
                              b.id +
                              "/verify",
                            "POST",
                            {},
                          )
                            .then(() => showEmployee(detail.id))
                            .catch((e) => setError(e.message))
                        }
                      >
                        {t("ยืนยันบัญชี", "Verify bank")}
                      </button>
                    )}
                  </p>
                ))}
                <h3>{t("เอกสาร", "Documents")}</h3>
                <input
                  aria-label={t("อัปโหลดเอกสาร", "Upload document")}
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const form = new FormData();
                      form.set("file", file);
                      form.set("employee_id", detail.id);
                      try {
                        await request(base + "/files", "POST", form);
                        setMessage(t("อัปโหลดสำเร็จ", "Uploaded"));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }
                  }}
                />
                {(detail.documents || []).map((doc: Row) => (
                  <p key={doc.id}>
                    <a href={doc.file_url}>{doc.file_name}</a>
                  </p>
                ))}
                <h3>{t("คำขอแก้ไขข้อมูล", "Profile change requests")}</h3>
                {(detail.change_requests || []).map((r: Row) => (
                  <div className="toolbar" key={r.id}>
                    <Badge value={r.status} />
                    {r.reason}
                    {r.status === "PENDING" && permit("employees.write") && (
                      <>
                        <button
                          onClick={() =>
                            action(
                              t("อนุมัติคำขอ", "Approve request"),
                              "/employees/" +
                                detail.id +
                                "/change-requests/" +
                                r.id +
                                "/decision",
                              { decision: "APPROVED" },
                              "POST",
                              "comment",
                            )
                          }
                        >
                          {t("อนุมัติ", "Approve")}
                        </button>
                        <button
                          onClick={() =>
                            action(
                              t("ปฏิเสธคำขอ", "Reject request"),
                              "/employees/" +
                                detail.id +
                                "/change-requests/" +
                                r.id +
                                "/decision",
                              { decision: "REJECTED" },
                              "POST",
                              "comment",
                            )
                          }
                        >
                          {t("ปฏิเสธ", "Reject")}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </>
            )}
            {detailType === "leave" && (
              <>
                <Badge value={detail.status} />
                <p>
                  {localDate(detail.start_at)} → {localDate(detail.end_at)}
                </p>
                <p>
                  {detail.requested_minutes} {t("นาที", "minutes")}
                </p>
                <p className="prewrap">{detail.reason}</p>
                <h3>{t("ลำดับการอนุมัติ", "Approval timeline")}</h3>
                {(detail.approvals || []).map((a: Row) => (
                  <div className="timeline" key={a.id}>
                    {a.step_no}. {a.display_name}
                    <Badge value={a.decision} />
                    <small>{a.comment}</small>
                  </div>
                ))}
                <div className="toolbar">
                  {permit("leave.approve") && detail.status === "PENDING" && (
                    <>
                      <button
                        className="primary"
                        onClick={() =>
                          action(
                            t("อนุมัติการลา", "Approve leave"),
                            "/leaves/" + detail.id + "/decision",
                            { decision: "APPROVED" },
                            "POST",
                            "comment",
                          )
                        }
                      >
                        {t("อนุมัติ", "Approve")}
                      </button>
                      <button
                        onClick={() =>
                          action(
                            t("ไม่อนุมัติ", "Reject leave"),
                            "/leaves/" + detail.id + "/decision",
                            { decision: "REJECTED" },
                            "POST",
                            "comment",
                          )
                        }
                      >
                        {t("ไม่อนุมัติ", "Reject")}
                      </button>
                    </>
                  )}
                  {["PENDING", "APPROVED"].includes(detail.status) && (
                    <button
                      onClick={() =>
                        action(
                          t("ยกเลิกการลา", "Cancel leave"),
                          "/leaves/" + detail.id + "/cancel",
                        )
                      }
                    >
                      {t("ยกเลิกการลา", "Cancel leave")}
                    </button>
                  )}
                </div>
              </>
            )}
            {detailType === "payroll" && (
              <>
                <div className="toolbar">
                  <h2>{detail.name}</h2>
                  <Badge value={detail.status} />
                  <select
                    aria-label="Calculation version"
                    value={detail.current_calculation_version}
                    onChange={async (e) => {
                      const r = await request(
                        base +
                          "/payroll/" +
                          detail.id +
                          "?version=" +
                          e.target.value,
                      );
                      setDetail({
                        ...r,
                        current_calculation_version: Number(e.target.value),
                      });
                    }}
                  >
                    {(detail.versions || []).map((v: Row) => (
                      <option key={v.id} value={v.version_no}>
                        Version {v.version_no} · {v.blocking_error_count}{" "}
                        blocked
                      </option>
                    ))}
                  </select>
                </div>
                <DataTable
                  rows={detail.results || []}
                  t={t}
                  columns={[
                    nameColumn,
                    amountColumn("base_salary_satang", "พื้นฐาน", "Base"),
                    amountColumn(
                      "additional_income_satang",
                      "รายได้เพิ่ม",
                      "Additional",
                    ),
                    amountColumn("tax_satang", "ภาษี", "Tax"),
                    amountColumn(
                      "social_security_satang",
                      "ประกันสังคม",
                      "Social security",
                    ),
                    amountColumn("net_pay_satang", "สุทธิ", "Net"),
                    {
                      key: "review_status",
                      th: "ผลตรวจสอบ",
                      en: "Review",
                      render: (r) => (
                        <>
                          <Badge value={r.review_status} />
                          {JSON.parse(r.warning_json || "[]").map(
                            (w: Row, i: number) => (
                              <small className="warning-text" key={i}>
                                {w.message}
                              </small>
                            ),
                          )}
                        </>
                      ),
                    },
                  ]}
                />
                <div className="toolbar">
                  {permit("payroll.prepare") &&
                    ["DRAFT", "REVIEW"].includes(detail.status) && (
                      <>
                        <button
                          className="primary"
                          onClick={() =>
                            request(
                              base + "/payroll/" + detail.id + "/calculate",
                              "POST",
                              {},
                            )
                              .then(() => showPayroll(detail.id))
                              .catch((e) => setError(e.message))
                          }
                        >
                          {t("คำนวณใหม่", "Calculate")}
                        </button>
                        <button
                          onClick={() =>
                            editor(
                              t("ปรับรายการเงินเดือน", "Manual adjustment"),
                              "20021",
                              [
                                lookup(
                                  "employee_id",
                                  "พนักงาน",
                                  "Employee",
                                  "employees",
                                  true,
                                ),
                                choice("item_type", "ประเภท", "Type", [
                                  "EARNING",
                                  "DEDUCTION",
                                ]),
                                f("item_code", "รหัสรายการ", "Item code"),
                                f("description", "รายการ", "Description"),
                                f(
                                  "amount_baht",
                                  "จำนวน (บาท)",
                                  "Amount (THB)",
                                  "number",
                                ),
                                f("reason", "เหตุผล", "Reason", "textarea"),
                              ],
                              "/payroll/" + detail.id + "/adjustments",
                              {},
                              "POST",
                              (b) => {
                                const { amount_baht, ...r } = b;
                                return {
                                  ...r,
                                  amount_satang: Math.round(amount_baht * 100),
                                };
                              },
                            )
                          }
                        >
                          {t("ปรับยอด", "Adjust")}
                        </button>
                      </>
                    )}
                  {permit("payroll.review") && detail.status === "REVIEW" && (
                    <button
                      onClick={() =>
                        action(
                          t("ยืนยันตรวจสอบ", "Confirm review"),
                          "/payroll/" + detail.id + "/review",
                          {},
                          "POST",
                          "comment",
                        )
                      }
                    >
                      {t("ส่งอนุมัติ", "Submit for approval")}
                    </button>
                  )}
                  {permit("payroll.approve") &&
                    detail.status === "PENDING_APPROVAL" && (
                      <button
                        className="primary"
                        onClick={() =>
                          action(
                            t("อนุมัติเงินเดือน", "Approve payroll"),
                            "/payroll/" + detail.id + "/approve",
                            {},
                            "POST",
                            "comment",
                          )
                        }
                      >
                        {t("อนุมัติ", "Approve")}
                      </button>
                    )}
                  {permit("payroll.approve") &&
                    ["APPROVED", "PAID"].includes(detail.status) && (
                      <button
                        onClick={() =>
                          action(
                            t("เปลี่ยนสถานะ", "Change status"),
                            "/payroll/" + detail.id + "/status",
                            {
                              status:
                                detail.status === "APPROVED"
                                  ? "PAID"
                                  : "CLOSED",
                            },
                          )
                        }
                      >
                        {t(
                          detail.status === "APPROVED"
                            ? "บันทึกจ่ายแล้ว"
                            : "ปิดรอบ",
                          detail.status === "APPROVED"
                            ? "Mark paid"
                            : "Close cycle",
                        )}
                      </button>
                    )}
                </div>
                <h3>{t("ประวัติรอบ", "Cycle timeline")}</h3>
                {(detail.history || []).map((h: Row) => (
                  <div className="timeline" key={h.id}>
                    <Badge value={h.to_status} />
                    {h.display_name}
                    <small>
                      {h.comment} · {localDate(h.changed_at)}
                    </small>
                  </div>
                ))}
              </>
            )}
            {detailType === "payslip" && (
              <>
                <div className="print-report">
                  <h1>{detail.company.legal_name}</h1>
                  <h2>
                    {t("สลิปเงินเดือน", "Payslip")} · {detail.slip_no}
                  </h2>
                  <p>
                    {detail.employee.first_name_th}{" "}
                    {detail.employee.last_name_th} ·{" "}
                    {detail.employee.employee_no}
                  </p>
                  <p>
                    {detail.cycle.period_start} — {detail.cycle.period_end}
                  </p>
                  <DataTable
                    rows={detail.items || []}
                    columns={[
                      { key: "item_name", th: "รายการ", en: "Item" },
                      amountColumn("amount_satang", "จำนวน", "Amount"),
                    ]}
                    t={t}
                  />
                  <h2>
                    {t("รับสุทธิ", "Net pay")}:{" "}
                    {money(detail.result.net_pay_satang)}
                  </h2>
                  <p>
                    YTD {t("รายได้", "Gross")}:{" "}
                    {money(detail.result.ytd_gross_income_satang)} ·{" "}
                    {t("ภาษี", "Tax")}: {money(detail.result.ytd_tax_satang)}
                  </p>
                </div>
                <button className="no-print" onClick={() => window.print()}>
                  <Printer size={18} />
                  {t("พิมพ์ / บันทึก PDF", "Print / Save PDF")}
                </button>
              </>
            )}
            {detailType === "announcement" && (
              <>
                <Badge value={detail.priority} />
                <h2>{detail.title}</h2>
                <p className="prewrap">{detail.body}</p>
                {detail.requires_acknowledgement === 1 && (
                  <button
                    className="primary"
                    onClick={() =>
                      request(
                        base + "/announcements/" + detail.id + "/acknowledge",
                        "POST",
                        {},
                      )
                        .then(() => {
                          mutate();
                          detailClose();
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    {t("ยืนยันรับทราบ", "Acknowledge")}
                  </button>
                )}
              </>
            )}
            {detailType === "activity" && (
              <DataTable
                rows={detail.activity || []}
                t={t}
                columns={[
                  { key: "display_name", th: "ผู้รับ", en: "Recipient" },
                  { key: "view_count", th: "จำนวนเปิด", en: "Views" },
                  dateColumn("last_viewed_at", "เปิดล่าสุด", "Last viewed"),
                  dateColumn("acknowledged_at", "รับทราบ", "Acknowledged"),
                ]}
              />
            )}
            {detailType === "audit" && (
              <>
                <p>{detail.reason}</p>
                <small>Request ID: {detail.request_id}</small>
                <div className="diff-grid">
                  <section>
                    <h3>{t("ก่อน", "Before")}</h3>
                    <pre>
                      {JSON.stringify(
                        JSON.parse(detail.before_json || "null"),
                        null,
                        2,
                      )}
                    </pre>
                  </section>
                  <section>
                    <h3>{t("หลัง", "After")}</h3>
                    <pre>
                      {JSON.stringify(
                        JSON.parse(detail.after_json || "null"),
                        null,
                        2,
                      )}
                    </pre>
                  </section>
                </div>
              </>
            )}
            {detailType === "overtime" && (
              <DataTable
                rows={detail.items || []}
                t={t}
                columns={[
                  nameColumn,
                  dateColumn("work_date", "วันที่", "Date"),
                  { key: "requested_minutes", th: "นาที", en: "Minutes" },
                  statusColumn,
                ]}
                actions={(r) =>
                  permit("attendance.write") && r.status === "PENDING" ? (
                    <>
                      <button
                        onClick={() =>
                          action(
                            t("อนุมัติ OT", "Approve overtime"),
                            "/overtime/" + r.id + "/decision",
                            { decision: "APPROVED" },
                            "POST",
                            "comment",
                          )
                        }
                      >
                        {t("อนุมัติ", "Approve")}
                      </button>
                      <button
                        onClick={() =>
                          action(
                            t("ปฏิเสธ OT", "Reject overtime"),
                            "/overtime/" + r.id + "/decision",
                            { decision: "REJECTED" },
                            "POST",
                            "comment",
                          )
                        }
                      >
                        {t("ปฏิเสธ", "Reject")}
                      </button>
                    </>
                  ) : null
                }
              />
            )}
            {detailType === "transfers" && (
              <DataTable
                rows={detail.items || []}
                t={t}
                columns={[
                  nameColumn,
                  {
                    key: "destination_company",
                    th: "ปลายทาง",
                    en: "Destination",
                  },
                  { key: "transfer_type", th: "รูปแบบ", en: "Type" },
                  dateColumn("effective_date", "วันที่มีผล", "Effective date"),
                  statusColumn,
                ]}
                actions={(r) =>
                  r.status === "PENDING" ? (
                    <button
                      onClick={() =>
                        editor(
                          t("อนุมัติการย้าย", "Approve transfer"),
                          "20023",
                          [
                            f(
                              "salary_baht",
                              "ค่าจ้างปลายทาง (บาท)",
                              "Destination wage (THB)",
                              "number",
                            ),
                            choice("pay_type", "ประเภทค่าจ้าง", "Wage basis", [
                              "MONTHLY",
                              "DAILY",
                              "HOURLY",
                            ]),
                            f("reason", "เหตุผล", "Reason", "textarea"),
                          ],
                          "/transfers/" + r.id + "/approve",
                          { pay_type: "MONTHLY" },
                          "POST",
                          (b) => {
                            const { salary_baht, ...r } = b;
                            return {
                              ...r,
                              salary_satang: Math.round(salary_baht * 100),
                            };
                          },
                        )
                      }
                    >
                      {t("อนุมัติ", "Approve")}
                    </button>
                  ) : null
                }
              />
            )}
            {detailType === "company-report" && (
              <DataTable
                rows={detail.items || []}
                t={t}
                columns={[
                  { key: "company_code", th: "รหัสบริษัท", en: "Company code" },
                  { key: "company_name", th: "บริษัท", en: "Company" },
                  { key: "employee_count", th: "พนักงาน", en: "Employees" },
                  {
                    key: "pending_leave_count",
                    th: "คำขอรออนุมัติ",
                    en: "Pending leave",
                  },
                  { key: "currency", th: "สกุลเงิน", en: "Currency" },
                ]}
              />
            )}
            {detailType === "reset" && (
              <>
                <p>
                  {t(
                    "ส่งลิงก์นี้ให้ผู้ใช้ผ่านช่องทางที่เชื่อถือได้ ลิงก์ใช้ได้ครั้งเดียว",
                    "Share this one-time link with the user through a trusted channel.",
                  )}
                </p>
                <input readOnly value={location.origin + detail.reset_url} />
              </>
            )}
          </div>
        </Modal>
      )}
      {modal}
    </div>
  );
}
