import { type Row, money, localDate } from "./api";
import {
  Badge,
  DataTable,
  dateColumn,
  amountColumn,
  type Translate,
} from "./components";
export default function EmployeeReport({
  employee: e,
  t,
}: {
  employee: Row;
  t: Translate;
}) {
  return (
    <div className="print-report">
      <div className="profile-header">
        <span className="avatar large">{e.first_name_th?.slice(0, 1)}</span>
        <div>
          <h2>
            {e.first_name_th} {e.last_name_th}
          </h2>
          <p>
            {e.employee_no} · {e.company_email || "—"}
          </p>
          <Badge value={e.employment_status} />
        </div>
      </div>
      <div className="profile-grid">
        {[
          ["โทรศัพท์", "Phone", e.mobile_phone],
          ["อีเมลส่วนตัว", "Personal email", e.personal_email],
          ["วันเริ่มงาน", "Hire date", localDate(e.hire_date)],
          ["ประเภทการจ้าง", "Employment type", e.employment_type],
          ["เลขบัตรประชาชน", "National ID", e.national_id_masked],
          ["ที่อยู่", "Address", e.addresses?.[0]?.address_line1],
        ].map(([th, en, value]) => (
          <div key={en}>
            <small>{t(th, en)}</small>
            <p>{value || "—"}</p>
          </div>
        ))}
      </div>
      <h3>{t("ผู้ติดต่อฉุกเฉิน", "Emergency contacts")}</h3>
      {(e.emergency_contacts || []).map((c: Row) => (
        <p key={c.id}>
          {c.full_name} · {c.relationship} · {c.phone}
        </p>
      ))}
      <h3>{t("ค่าตอบแทนและประวัติ", "Compensation history")}</h3>
      <DataTable
        rows={e.compensation || []}
        t={t}
        columns={[
          dateColumn("effective_from", "มีผลตั้งแต่", "Effective from"),
          { key: "pay_type", th: "ประเภท", en: "Basis" },
          amountColumn("base_salary_satang", "รายเดือน", "Monthly"),
          amountColumn("daily_rate_satang", "รายวัน", "Daily"),
          amountColumn("hourly_rate_satang", "รายชั่วโมง", "Hourly"),
        ]}
      />
      <h3>{t("ประวัติการจ้าง", "Employment history")}</h3>
      {(e.history || []).map((h: Row) => (
        <div className="timeline" key={h.id}>
          <Badge value={h.event_type} />
          {localDate(h.effective_from)}
          <small>{h.reason}</small>
        </div>
      ))}
      <h3>{t("ประสบการณ์ทำงาน", "Work experience")}</h3>
      {!(e.experiences || []).length && (
        <p className="muted">
          {t("ยังไม่มีประสบการณ์ที่บันทึก", "No experience recorded")}
        </p>
      )}
      {(e.experiences || []).map((x: Row) => (
        <div className="timeline" key={x.id}>
          <strong>
            {x.position_name} · {x.company_name}
          </strong>
          <small>
            {x.started_on} — {x.ended_on || t("ปัจจุบัน", "Present")}
          </small>
          <p>{x.description}</p>
        </div>
      ))}
      <h3>{t("สิทธิ์ลาคงเหลือ", "Leave balances")}</h3>
      {(e.balances || []).map((b: Row) => (
        <p key={b.id}>
          {b.name_th}:{" "}
          {(b.opening_minutes +
            b.accrued_minutes +
            b.adjusted_minutes +
            b.carried_forward_minutes -
            b.used_minutes) /
            480}{" "}
          {t("วัน", "days")} · {b.balance_year}
        </p>
      ))}
    </div>
  );
}
