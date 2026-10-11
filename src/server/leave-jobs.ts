import type { Database } from "bun:sqlite";
import { store, uuid, now, today, type Row } from "./db";
/** Policy-driven accrual. Each credit uses a stable ledger source key, so restarts are safe. */
export function accrueLeave(db: Database, asOf = today()) {
  const s = store(db),
    year = Number(asOf.slice(0, 4)),
    start = year + "-01-01",
    end = year + "-12-31",
    daysInYear = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  let credits = 0;
  const employees = s.all(
    "SELECT e.* FROM employees e JOIN organizations o ON o.id=e.organization_id JOIN tenants t ON t.id=o.tenant_id WHERE e.deleted_at IS NULL AND e.employment_status='ACTIVE' AND e.hire_date<=? AND o.status='ACTIVE' AND t.status='ACTIVE'",
    asOf,
  );
  for (const e of employees) {
    const types = s.all(
      "SELECT * FROM leave_types WHERE organization_id=? AND status='ACTIVE'",
      e.organization_id,
    );
    for (const type of types) {
      db.transaction(() => {
        const policies = s.all(
          "SELECT * FROM leave_policies WHERE organization_id=? AND leave_type_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) AND (employment_type IS NULL OR employment_type=?) ORDER BY effective_from DESC",
          e.organization_id,
          type.id,
          asOf,
          start,
          e.employment_type,
        );
        if (!policies.length) return;
        let balance = s.one(
          "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
          e.id,
          type.id,
          year,
        );
        if (!balance) {
          const id = uuid();
          s.insert("employee_leave_balances", {
            id,
            employee_id: e.id,
            leave_type_id: type.id,
            balance_year: year,
          });
          balance = s.one(
            "SELECT * FROM employee_leave_balances WHERE id=?",
            id,
          )!;
          const prior = s.one(
            "SELECT * FROM employee_leave_balances WHERE employee_id=? AND leave_type_id=? AND balance_year=?",
            e.id,
            type.id,
            year - 1,
          );
          if (prior) {
            const available = Math.max(
                0,
                prior.opening_minutes +
                  prior.accrued_minutes +
                  prior.adjusted_minutes +
                  prior.carried_forward_minutes -
                  prior.used_minutes,
              ),
              carry = Math.min(
                available,
                policies[0].carry_forward_limit_minutes,
              );
            if (available) {
              s.run(
                "UPDATE employee_leave_balances SET adjusted_minutes=adjusted_minutes-?,updated_at=? WHERE id=?",
                available,
                now(),
                prior.id,
              );
              s.insert("leave_balance_transactions", {
                id: uuid(),
                employee_leave_balance_id: prior.id,
                transaction_type: "EXPIRY",
                minutes: -available,
                source_type: "YEAR_END",
                source_id: String(year),
                reason: "Year-end expiration and carry forward",
              });
            }
            if (carry) {
              s.run(
                "UPDATE employee_leave_balances SET carried_forward_minutes=? WHERE id=?",
                carry,
                id,
              );
              s.insert("leave_balance_transactions", {
                id: uuid(),
                employee_leave_balance_id: id,
                transaction_type: "CARRY_FORWARD",
                minutes: carry,
                source_type: "YEAR_START",
                source_id: String(year),
                reason: "Policy carry-forward limit",
              });
            }
          }
        }
        const credit = (minutes: number, key: string, reason: string) => {
          if (
            !minutes ||
            s.one(
              "SELECT 1 FROM leave_balance_transactions WHERE employee_leave_balance_id=? AND transaction_type='ACCRUAL' AND source_type='POLICY_JOB' AND source_id=?",
              balance!.id,
              key,
            )
          )
            return;
          s.insert("leave_balance_transactions", {
            id: uuid(),
            employee_leave_balance_id: balance!.id,
            transaction_type: "ACCRUAL",
            minutes,
            source_type: "POLICY_JOB",
            source_id: key,
            reason,
          });
          s.run(
            "UPDATE employee_leave_balances SET accrued_minutes=accrued_minutes+?,updated_at=? WHERE id=?",
            minutes,
            now(),
            balance!.id,
          );
          credits++;
        };
        for (
          let value = Date.parse(start);
          value <= Date.parse(asOf);
          value += 86400000
        ) {
          const date = new Date(value).toISOString().slice(0, 10),
            p = policies.find(
              (p) =>
                p.effective_from <= date &&
                (!p.effective_to || p.effective_to >= date),
            );
          if (
            !p ||
            date < e.hire_date ||
            (value - Date.parse(e.hire_date)) / 86400000 <
              p.minimum_service_days
          )
            continue;
          if (p.accrual_method === "ANNUAL") {
            if (!balance.opening_minutes)
              credit(
                p.annual_entitlement_minutes,
                "ANNUAL:" + year,
                "Annual policy entitlement",
              );
          } else if (p.accrual_method === "MONTHLY") {
            const month = Number(date.slice(5, 7));
            credit(
              Math.floor((p.annual_entitlement_minutes * month) / 12) -
                Math.floor((p.annual_entitlement_minutes * (month - 1)) / 12),
              "MONTHLY:" + date.slice(0, 7),
              "Monthly policy accrual",
            );
          } else if (p.accrual_method === "DAILY") {
            const index = (value - Date.parse(start)) / 86400000 + 1;
            credit(
              Math.floor((p.annual_entitlement_minutes * index) / daysInYear) -
                Math.floor(
                  (p.annual_entitlement_minutes * (index - 1)) / daysInYear,
                ),
              "DAILY:" + date,
              "Daily policy accrual",
            );
          }
        }
      })();
    }
  }
  return { employees: employees.length, credits };
}
