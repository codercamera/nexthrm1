import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  X,
  Trash2,
  LoaderCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { type Row, money, localDate } from "./api";
export type Translate = (th: string, en: string) => string;
export type Field = {
  key: string;
  th: string;
  en: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  step?: string;
  min?: string;
  readonly?: boolean;
  section?: string;
};
export function Badge({ value }: { value: any }) {
  return (
    <span
      className={
        "badge " +
        ([
          "ACTIVE",
          "APPROVED",
          "PRESENT",
          "PAID",
          "CLOSED",
          "PUBLISHED",
          "REVIEWED",
        ].includes(value)
          ? "green"
          : [
                "REJECTED",
                "BLOCKED",
                "TERMINATED",
                "SUSPENDED",
                "INCOMPLETE",
              ].includes(value)
            ? "red"
            : "blue")
      }
    >
      {String(value ?? "—").replaceAll("_", " ")}
    </span>
  );
}
export function Modal({
  title,
  id,
  onClose,
  children,
  t,
}: {
  title: string;
  id: string;
  onClose: () => void;
  children: ReactNode;
  t: Translate;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="modal"
    >
      <div className="modal-head">
        <div>
          <small className="page-id">{id}</small>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t("ปิด", "Close")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Editor({
  title,
  id,
  fields,
  initial = {},
  submit,
  onClose,
  t,
  preview,
}: {
  title: string;
  id: string;
  fields: Field[];
  initial?: Row;
  submit: (b: Row) => Promise<void>;
  onClose: () => void;
  t: Translate;
  preview?: (b: Row) => ReactNode;
}) {
  const [values, setValues] = useState<Row>(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [showPreview, setShowPreview] = useState(false);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const close = () => {
    if (
      !dirty ||
      window.confirm(
        t(
          "มีข้อมูลยังไม่บันทึก ต้องการออกหรือไม่?",
          "Discard unsaved changes?",
        ),
      )
    )
      onClose();
  };
  return (
    <Modal title={title} id={id} onClose={close} t={t}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const output: Row = {};
            for (const f of fields) {
              let v = values[f.key];
              if (f.type === "number") v = Number(v || 0);
              if (f.type === "checkbox") v = !!v;
              if (f.type === "datetime-local" && v)
                v = new Date(v).toISOString();
              output[f.key] =
                v ??
                (f.type === "checkbox"
                  ? false
                  : ["earnings", "multi-select"].includes(f.type || "")
                    ? []
                    : "");
            }
            await submit(output);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <div className="form-grid">
            {fields.map((f, i) => (
              <div
                key={f.key}
                className={
                  (["textarea", "earnings"].includes(f.type || "")
                    ? "wide "
                    : "") + "form-field"
                }
              >
                {f.section &&
                  (i === 0 || fields[i - 1].section !== f.section) && (
                    <h3>{f.section}</h3>
                  )}
                <label htmlFor={"field-" + f.key}>
                  {t(f.th, f.en)}
                  {f.required && " *"}
                </label>
                {f.options ? (
                  <select
                    id={"field-" + f.key}
                    required={f.required}
                    multiple={f.type === "multi-select"}
                    value={
                      values[f.key] ?? (f.type === "multi-select" ? [] : "")
                    }
                    onChange={(e) => {
                      setValues({
                        ...values,
                        [f.key]:
                          f.type === "multi-select"
                            ? Array.from(
                                e.target.selectedOptions,
                                (o) => o.value,
                              )
                            : e.target.value,
                      });
                      setDirty(true);
                    }}
                  >
                    <option value="">{t("เลือก", "Select")}</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "earnings" ? (
                  <EarningsEditor
                    t={t}
                    value={values[f.key] || []}
                    onChange={(rows) => {
                      setValues({ ...values, [f.key]: rows });
                      setDirty(true);
                    }}
                  />
                ) : f.type === "textarea" ? (
                  <textarea
                    id={"field-" + f.key}
                    required={f.required}
                    value={values[f.key] ?? ""}
                    onChange={(e) => {
                      setValues({ ...values, [f.key]: e.target.value });
                      setDirty(true);
                    }}
                  />
                ) : (
                  <input
                    id={"field-" + f.key}
                    type={f.type || "text"}
                    required={f.required}
                    readOnly={f.readonly}
                    min={f.min}
                    step={f.step}
                    checked={
                      f.type === "checkbox" ? !!values[f.key] : undefined
                    }
                    value={
                      f.type === "checkbox" ? undefined : (values[f.key] ?? "")
                    }
                    onChange={(e) => {
                      setValues({
                        ...values,
                        [f.key]:
                          f.type === "checkbox"
                            ? e.target.checked
                            : e.target.value,
                      });
                      setDirty(true);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          {showPreview && preview && (
            <div className="preview">{preview(values)}</div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={close}>
            {t("ยกเลิก", "Cancel")}
          </button>
          {preview && (
            <button type="button" onClick={() => setShowPreview(!showPreview)}>
              {t("ดูตัวอย่าง", "Preview")}
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              t("บันทึก", "Save")
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function Confirm({
  title,
  onConfirm,
  onClose,
  t,
}: {
  title: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
  t: Translate;
}) {
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={title} id="20002" onClose={onClose} t={t}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onConfirm(reason);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p>
            {t(
              "การดำเนินการนี้จะบันทึกในประวัติ กรุณาระบุเหตุผล",
              "This action is audited. Please provide a reason.",
            )}
          </p>
          <label htmlFor="confirm-reason">{t("เหตุผล", "Reason")}</label>
          <textarea
            id="confirm-reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            {t("ยกเลิก", "Cancel")}
          </button>
          <button className="danger" disabled={busy}>
            <Trash2 size={16} /> {t("ยืนยัน", "Confirm")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export type Column = {
  key: string;
  th: string;
  en: string;
  render?: (row: Row) => ReactNode;
};
export function DataTable({
  rows,
  columns,
  actions,
  t,
}: {
  rows: Row[];
  columns: Column[];
  actions?: (r: Row) => ReactNode;
  t: Translate;
}) {
  if (!rows.length)
    return <div className="empty">{t("ยังไม่มีรายการ", "No records yet")}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{t(c.th, c.en)}</th>
            ))}
            {actions && <th>{t("จัดการ", "Actions")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {columns.map((c) => (
                <td key={c.key} data-label={t(c.th, c.en)}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                </td>
              ))}
              {actions && <td className="row-actions">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Filters({
  q,
  setQ,
  t,
  children,
}: {
  q: string;
  setQ: (q: string) => void;
  t: Translate;
  children?: ReactNode;
}) {
  return (
    <div className="filters">
      <div className="search">
        <Search size={18} />
        <input
          aria-label={t("ค้นหา", "Search")}
          placeholder={t(
            "ค้นหาชื่อ อีเมล ตำแหน่ง…",
            "Search name, email, position…",
          )}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {children}
    </div>
  );
}
export function Pager({
  offset,
  total,
  onChange,
  t,
}: {
  offset: number;
  total: number;
  onChange: (v: number) => void;
  t: Translate;
}) {
  return (
    <div className="pager">
      <span>
        {offset + 1}–{Math.min(offset + 25, total)} / {total}
      </span>
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 25))}
        aria-label={t("ก่อนหน้า", "Previous")}
      >
        <ChevronLeft size={18} />
      </button>
      <button
        disabled={offset + 25 >= total}
        onClick={() => onChange(offset + 25)}
        aria-label={t("ถัดไป", "Next")}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
export const nameColumn: Column = {
  key: "name",
  th: "พนักงาน",
  en: "Employee",
  render: (r) => (
    <div className="person">
      <span className="avatar">{r.first_name_th?.slice(0, 1) || "U"}</span>
      <div>
        <strong>
          {r.first_name_th} {r.last_name_th}
        </strong>
        <small>{r.employee_no}</small>
      </div>
    </div>
  ),
};
export const statusColumn: Column = {
  key: "status",
  th: "สถานะ",
  en: "Status",
  render: (r) => <Badge value={r.status || r.employment_status} />,
};
export const amountColumn = (key: string, th: string, en: string): Column => ({
  key,
  th,
  en,
  render: (r) => money(r[key]),
});
export const dateColumn = (key: string, th: string, en: string): Column => ({
  key,
  th,
  en,
  render: (r) => localDate(r[key]),
});

function EarningsEditor({
  value,
  onChange,
  t,
}: {
  value: Row[];
  onChange: (rows: Row[]) => void;
  t: Translate;
}) {
  const [pending, setPending] = useState<number | null>(null);
  return (
    <div>
      {value.map((row, index) => (
        <div className="earning-row" key={index}>
          <input
            aria-label={t("ชื่อรายได้ประจำ", "Earning name")}
            required
            placeholder={t("เช่น ค่าเดินทาง", "e.g. Travel allowance")}
            value={row.name}
            onChange={(e) =>
              onChange(
                value.map((r, i) =>
                  i === index ? { ...r, name: e.target.value } : r,
                ),
              )
            }
          />
          <input
            aria-label={t("จำนวนเงิน (บาท)", "Amount (THB)")}
            type="number"
            min="0"
            step="0.01"
            value={row.amount_satang / 100}
            onChange={(e) =>
              onChange(
                value.map((r, i) =>
                  i === index
                    ? {
                        ...r,
                        amount_satang: Math.round(Number(e.target.value) * 100),
                      }
                    : r,
                ),
              )
            }
          />
          <button
            type="button"
            className="delete-button"
            onClick={() => setPending(index)}
          >
            <Trash2 size={15} />
            delete
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, { name: "", amount_satang: 0 }])}
      >
        <Plus size={15} />
        {t("เพิ่มรายได้ประจำ", "Add regular earning")}
      </button>
      {pending !== null && (
        <Modal
          title={t("ลบรายได้ประจำ", "Delete regular earning")}
          id="20024"
          t={t}
          onClose={() => setPending(null)}
        >
          <div className="modal-body">
            <p>{t("ต้องการลบรายการนี้หรือไม่?", "Delete this earning?")}</p>
            <button type="button" onClick={() => setPending(null)}>
              {t("ยกเลิก", "Cancel")}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                onChange(value.filter((_, i) => i !== pending));
                setPending(null);
              }}
            >
              <Trash2 size={15} />
              delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
