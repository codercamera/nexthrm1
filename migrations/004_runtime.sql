BEGIN;
CREATE UNIQUE INDEX ux_employee_company_user ON employees(organization_id,user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ux_notification_delivery ON notifications(user_id,organization_id,source_type,source_id);
CREATE UNIQUE INDEX ux_leave_ledger_source ON leave_balance_transactions(employee_leave_balance_id,transaction_type,source_type,source_id) WHERE source_id IS NOT NULL;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TABLE runtime_idempotency (tenant_id TEXT NOT NULL, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, route TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,organization_id,user_id,route,key));
INSERT INTO schema_migrations(version) VALUES('004_runtime');
COMMIT;
