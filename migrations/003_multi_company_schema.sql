-- HRM System - SQLite Schema
-- Money values are stored in satang (INTEGER).
-- Dates use YYYY-MM-DD and timestamps use ISO-8601 UTC strings.
-- Enable this for every SQLite connection.
PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  default_locale TEXT NOT NULL DEFAULT 'th-TH',
  default_timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tenant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  allow_cross_company_reporting INTEGER NOT NULL DEFAULT 1
    CHECK (allow_cross_company_reporting IN (0,1)),
  allow_cross_company_employee_link INTEGER NOT NULL DEFAULT 1
    CHECK (allow_cross_company_employee_link IN (0,1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tax_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  currency_code TEXT NOT NULL DEFAULT 'THB' CHECK (currency_code = 'THB'),
  locale TEXT NOT NULL DEFAULT 'th-TH',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, code)
);

CREATE INDEX ix_organizations_tenant_status
  ON organizations(tenant_id, status);

CREATE TABLE organization_relationships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  child_organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'SUBSIDIARY'
    CHECK (relationship_type IN ('SUBSIDIARY','AFFILIATE','MANAGED_BY')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (parent_organization_id <> child_organization_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (parent_organization_id, child_organization_id, effective_from)
);

CREATE TABLE organization_settings (
  organization_id TEXT PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,
  employee_no_prefix TEXT,
  payroll_default_cycle TEXT NOT NULL DEFAULT 'MONTHLY'
    CHECK (payroll_default_cycle IN ('DAILY','WEEKLY','BIWEEKLY','MONTHLY')),
  payroll_cutoff_day INTEGER CHECK (payroll_cutoff_day BETWEEN 1 AND 31),
  standard_work_minutes_per_day INTEGER NOT NULL DEFAULT 480
    CHECK (standard_work_minutes_per_day > 0),
  social_security_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (social_security_enabled IN (0,1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  address_json TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  parent_department_id TEXT
    REFERENCES departments(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  cost_center_code TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE job_levels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rank_order INTEGER NOT NULL DEFAULT 0,
  minimum_salary_satang INTEGER CHECK (minimum_salary_satang >= 0),
  maximum_salary_satang INTEGER CHECK (maximum_salary_satang >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    maximum_salary_satang IS NULL OR minimum_salary_satang IS NULL
    OR maximum_salary_satang >= minimum_salary_satang
  ),
  UNIQUE (organization_id, code)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  default_organization_id TEXT
    REFERENCES organizations(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'th'
    CHECK (preferred_language IN ('th','en')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','DISABLED')),
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ux_users_tenant_email
  ON users (tenant_id, lower(email));

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system_role INTEGER NOT NULL DEFAULT 0
    CHECK (is_system_role IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, code)
);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description TEXT
);

CREATE TABLE user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'COMPANY'
    CHECK (scope_type IN ('TENANT','COMPANY','BRANCH','DEPARTMENT','SELF')),
  scope_id TEXT,
  assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ux_user_roles_scope
  ON user_roles(
    user_id,
    role_id,
    ifnull(organization_id, ''),
    scope_type,
    ifnull(scope_id, '')
  );

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  national_id_hash TEXT,
  passport_no_hash TEXT,
  primary_email TEXT,
  primary_phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ux_people_tenant_national_id
  ON people(tenant_id, national_id_hash)
  WHERE national_id_hash IS NOT NULL;

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  employee_no TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title_th TEXT,
  first_name_th TEXT NOT NULL,
  last_name_th TEXT NOT NULL,
  first_name_en TEXT,
  last_name_en TEXT,
  nickname TEXT,
  national_id_encrypted TEXT,
  passport_no_encrypted TEXT,
  birth_date TEXT,
  gender TEXT CHECK (gender IN ('MALE','FEMALE','NON_BINARY','UNSPECIFIED')),
  mobile_phone TEXT,
  personal_email TEXT,
  company_email TEXT,
  avatar_url TEXT,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  position_id TEXT REFERENCES positions(id) ON DELETE SET NULL,
  job_level_id TEXT REFERENCES job_levels(id) ON DELETE SET NULL,
  manager_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  employment_type TEXT NOT NULL DEFAULT 'FULL_TIME'
    CHECK (employment_type IN (
      'FULL_TIME','PART_TIME','CONTRACT','PROBATION','INTERN','DAILY'
    )),
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (employment_status IN (
      'DRAFT','ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED'
    )),
  hire_date TEXT NOT NULL,
  probation_end_date TEXT,
  termination_date TEXT,
  termination_reason TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK (manager_employee_id IS NULL OR manager_employee_id <> id),
  CHECK (
    termination_date IS NULL OR termination_date >= hire_date
  ),
  UNIQUE (organization_id, employee_no)
);

CREATE INDEX ix_employees_person
  ON employees(person_id, organization_id);

CREATE INDEX ix_employees_org_status
  ON employees (organization_id, employment_status);
CREATE INDEX ix_employees_department
  ON employees (department_id, employment_status);
CREATE INDEX ix_employees_manager
  ON employees (manager_employee_id);

CREATE TABLE user_company_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  access_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (access_status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE (user_id, organization_id)
);

CREATE UNIQUE INDEX ux_user_default_company
  ON user_company_access(user_id)
  WHERE is_default = 1 AND access_status = 'ACTIVE';

CREATE TABLE employee_addresses (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  address_type TEXT NOT NULL
    CHECK (address_type IN ('REGISTERED','CURRENT','MAILING')),
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  subdistrict TEXT,
  district TEXT,
  province TEXT,
  postal_code TEXT,
  country_code TEXT NOT NULL DEFAULT 'TH',
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employee_emergency_contacts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  priority_order INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employee_documents (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_no_encrypted TEXT,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  issued_date TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_employee_documents_expiry
  ON employee_documents (expiry_date, status);

CREATE TABLE employee_bank_accounts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  bank_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number_encrypted TEXT NOT NULL,
  account_number_last4 TEXT NOT NULL,
  branch_name TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  verified_at TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX ux_employee_primary_bank
  ON employee_bank_accounts(employee_id)
  WHERE is_primary = 1 AND effective_to IS NULL;

CREATE TABLE employee_tax_profiles (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  tax_id_encrypted TEXT,
  tax_method TEXT NOT NULL DEFAULT 'PROGRESSIVE'
    CHECK (tax_method IN ('PROGRESSIVE','FIXED','EXEMPT')),
  fixed_tax_rate_basis_points INTEGER
    CHECK (fixed_tax_rate_basis_points BETWEEN 0 AND 10000),
  deductions_json TEXT NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employee_social_security_profiles (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  insured_no_encrypted TEXT,
  hospital_code TEXT,
  contribution_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (contribution_enabled IN (0,1)),
  effective_from TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employment_history (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'HIRED','PROBATION_PASSED','TRANSFERRED','PROMOTED',
      'DEMOTED','STATUS_CHANGED','SUSPENDED','TERMINATED','REHIRED'
    )),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  position_id TEXT REFERENCES positions(id) ON DELETE SET NULL,
  job_level_id TEXT REFERENCES job_levels(id) ON DELETE SET NULL,
  manager_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  employment_type TEXT,
  employment_status TEXT,
  reason TEXT,
  note TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX ix_employment_history_employee_date
  ON employment_history(employee_id, effective_from DESC);

CREATE TABLE compensation_history (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  pay_type TEXT NOT NULL
    CHECK (pay_type IN ('MONTHLY','DAILY','HOURLY')),
  base_salary_satang INTEGER NOT NULL DEFAULT 0 CHECK (base_salary_satang >= 0),
  daily_rate_satang INTEGER CHECK (daily_rate_satang >= 0),
  hourly_rate_satang INTEGER CHECK (hourly_rate_satang >= 0),
  regular_allowances_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX ix_compensation_employee_effective
  ON compensation_history(employee_id, effective_from DESC);

CREATE TABLE work_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  break_minutes INTEGER NOT NULL DEFAULT 60 CHECK (break_minutes >= 0),
  grace_late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_late_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE work_schedule_days (
  work_schedule_id TEXT NOT NULL
    REFERENCES work_schedules(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  is_workday INTEGER NOT NULL DEFAULT 1 CHECK (is_workday IN (0,1)),
  start_time TEXT,
  end_time TEXT,
  break_minutes INTEGER NOT NULL DEFAULT 60 CHECK (break_minutes >= 0),
  PRIMARY KEY (work_schedule_id, weekday)
);

CREATE TABLE employee_schedule_assignments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_schedule_id TEXT NOT NULL
    REFERENCES work_schedules(id) ON DELETE RESTRICT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX ix_schedule_assignment_effective
  ON employee_schedule_assignments(employee_id, effective_from DESC);

CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  scheduled_start_at TEXT,
  scheduled_end_at TEXT,
  check_in_at TEXT,
  check_out_at TEXT,
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_leave_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_leave_minutes >= 0),
  source TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('DEVICE','WEB','MOBILE','IMPORT','MANUAL')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PRESENT','ABSENT','LEAVE','HOLIDAY','INCOMPLETE')),
  note TEXT,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, work_date)
);

CREATE INDEX ix_attendance_date_status
  ON attendance_records(work_date, status);

CREATE TABLE overtime_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  requested_minutes INTEGER NOT NULL CHECK (requested_minutes > 0),
  approved_minutes INTEGER CHECK (approved_minutes >= 0),
  rate_multiplier REAL NOT NULL DEFAULT 1.5 CHECK (rate_multiplier > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),
  submitted_at TEXT,
  decided_at TEXT,
  decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE leave_types (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  unit TEXT NOT NULL DEFAULT 'DAY'
    CHECK (unit IN ('DAY','HOUR')),
  is_paid INTEGER NOT NULL DEFAULT 1 CHECK (is_paid IN (0,1)),
  requires_attachment INTEGER NOT NULL DEFAULT 0
    CHECK (requires_attachment IN (0,1)),
  allow_negative_balance INTEGER NOT NULL DEFAULT 0
    CHECK (allow_negative_balance IN (0,1)),
  privacy_level TEXT NOT NULL DEFAULT 'TEAM_NAME_ONLY'
    CHECK (privacy_level IN ('PUBLIC','TEAM_NAME_ONLY','PRIVATE')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code)
);

CREATE TABLE leave_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  employment_type TEXT,
  annual_entitlement_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (annual_entitlement_minutes >= 0),
  accrual_method TEXT NOT NULL DEFAULT 'ANNUAL'
    CHECK (accrual_method IN ('NONE','ANNUAL','MONTHLY','DAILY')),
  carry_forward_limit_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (carry_forward_limit_minutes >= 0),
  minimum_service_days INTEGER NOT NULL DEFAULT 0
    CHECK (minimum_service_days >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE employee_leave_balances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  balance_year INTEGER NOT NULL,
  opening_minutes INTEGER NOT NULL DEFAULT 0,
  accrued_minutes INTEGER NOT NULL DEFAULT 0,
  used_minutes INTEGER NOT NULL DEFAULT 0,
  adjusted_minutes INTEGER NOT NULL DEFAULT 0,
  carried_forward_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, leave_type_id, balance_year)
);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id TEXT NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  requested_minutes INTEGER NOT NULL CHECK (requested_minutes > 0),
  reason TEXT,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','PENDING','APPROVED','REJECTED','CANCELLED','WITHDRAWN'
    )),
  submitted_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_at >= start_at)
);

CREATE INDEX ix_leave_requests_employee_status
  ON leave_requests(employee_id, status, start_at);
CREATE INDEX ix_leave_requests_period
  ON leave_requests(start_at, end_at, status);

CREATE TABLE leave_request_days (
  id TEXT PRIMARY KEY,
  leave_request_id TEXT NOT NULL
    REFERENCES leave_requests(id) ON DELETE CASCADE,
  leave_date TEXT NOT NULL,
  leave_minutes INTEGER NOT NULL CHECK (leave_minutes > 0),
  is_paid INTEGER NOT NULL DEFAULT 1 CHECK (is_paid IN (0,1)),
  UNIQUE (leave_request_id, leave_date)
);

CREATE TABLE leave_approvals (
  id TEXT PRIMARY KEY,
  leave_request_id TEXT NOT NULL
    REFERENCES leave_requests(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL CHECK (step_no > 0),
  approver_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (decision IN ('PENDING','APPROVED','REJECTED','SKIPPED')),
  comment TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (leave_request_id, step_no)
);

CREATE TABLE payroll_cycles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  cycle_type TEXT NOT NULL
    CHECK (cycle_type IN ('DAILY','WEEKLY','BIWEEKLY','MONTHLY')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  attendance_cutoff_at TEXT,
  leave_cutoff_at TEXT,
  pay_date TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'THB' CHECK (currency_code = 'THB'),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','CALCULATING','REVIEW','PENDING_APPROVAL',
      'APPROVED','PAID','CLOSED','CANCELLED'
    )),
  current_calculation_version INTEGER NOT NULL DEFAULT 0
    CHECK (current_calculation_version >= 0),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  paid_at TEXT,
  locked_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (period_end >= period_start),
  UNIQUE (organization_id, code)
);

CREATE INDEX ix_payroll_cycles_period_status
  ON payroll_cycles(organization_id, period_start, period_end, status);

CREATE TABLE payroll_cycle_employees (
  payroll_cycle_id TEXT NOT NULL
    REFERENCES payroll_cycles(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  inclusion_status TEXT NOT NULL DEFAULT 'INCLUDED'
    CHECK (inclusion_status IN ('INCLUDED','EXCLUDED','ON_HOLD')),
  exclusion_reason TEXT,
  compensation_history_id TEXT
    REFERENCES compensation_history(id) ON DELETE SET NULL,
  bank_account_id TEXT
    REFERENCES employee_bank_accounts(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payroll_cycle_id, employee_id)
);

CREATE TABLE payroll_calculation_runs (
  id TEXT PRIMARY KEY,
  payroll_cycle_id TEXT NOT NULL
    REFERENCES payroll_cycles(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','COMPLETED','FAILED','SUPERSEDED')),
  employee_count INTEGER NOT NULL DEFAULT 0 CHECK (employee_count >= 0),
  total_income_satang INTEGER NOT NULL DEFAULT 0,
  total_deduction_satang INTEGER NOT NULL DEFAULT 0,
  total_net_satang INTEGER NOT NULL DEFAULT 0,
  blocking_error_count INTEGER NOT NULL DEFAULT 0
    CHECK (blocking_error_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  triggered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error_message TEXT,
  UNIQUE (payroll_cycle_id, version_no)
);

CREATE TABLE payroll_results (
  id TEXT PRIMARY KEY,
  calculation_run_id TEXT NOT NULL
    REFERENCES payroll_calculation_runs(id) ON DELETE CASCADE,
  payroll_cycle_id TEXT NOT NULL
    REFERENCES payroll_cycles(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  base_salary_satang INTEGER NOT NULL DEFAULT 0,
  additional_income_satang INTEGER NOT NULL DEFAULT 0,
  overtime_satang INTEGER NOT NULL DEFAULT 0,
  gross_income_satang INTEGER NOT NULL DEFAULT 0,
  pre_tax_deduction_satang INTEGER NOT NULL DEFAULT 0,
  tax_satang INTEGER NOT NULL DEFAULT 0,
  social_security_satang INTEGER NOT NULL DEFAULT 0,
  other_deduction_satang INTEGER NOT NULL DEFAULT 0,
  net_pay_satang INTEGER NOT NULL DEFAULT 0,
  previous_net_pay_satang INTEGER,
  variance_satang INTEGER,
  variance_basis_points INTEGER,
  ytd_gross_income_satang INTEGER NOT NULL DEFAULT 0,
  ytd_tax_satang INTEGER NOT NULL DEFAULT 0,
  ytd_social_security_satang INTEGER NOT NULL DEFAULT 0,
  ytd_net_pay_satang INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (review_status IN (
      'NORMAL','WARNING','BLOCKED','REVIEWED','MANUALLY_ADJUSTED'
    )),
  warning_json TEXT NOT NULL DEFAULT '[]',
  formula_snapshot_json TEXT NOT NULL DEFAULT '{}',
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (calculation_run_id, employee_id)
);

CREATE INDEX ix_payroll_results_review
  ON payroll_results(payroll_cycle_id, review_status);

CREATE TABLE payroll_result_items (
  id TEXT PRIMARY KEY,
  payroll_result_id TEXT NOT NULL
    REFERENCES payroll_results(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL
    CHECK (item_type IN ('EARNING','DEDUCTION','TAX','SOCIAL_SECURITY')),
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL,
  rate_satang INTEGER,
  amount_satang INTEGER NOT NULL,
  source_type TEXT,
  source_id TEXT,
  formula_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ix_payroll_items_result_type
  ON payroll_result_items(payroll_result_id, item_type, sort_order);

CREATE TABLE payroll_adjustments (
  id TEXT PRIMARY KEY,
  payroll_cycle_id TEXT NOT NULL
    REFERENCES payroll_cycles(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK (item_type IN ('EARNING','DEDUCTION')),
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_satang INTEGER NOT NULL CHECK (amount_satang >= 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','CANCELLED')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT
);

CREATE TABLE payroll_approvals (
  id TEXT PRIMARY KEY,
  payroll_cycle_id TEXT NOT NULL
    REFERENCES payroll_cycles(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL CHECK (step_no > 0),
  approver_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (decision IN ('PENDING','APPROVED','REJECTED','RETURNED')),
  comment TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (payroll_cycle_id, step_no)
);

CREATE TABLE payslips (
  id TEXT PRIMARY KEY,
  payroll_cycle_id TEXT NOT NULL
    REFERENCES payroll_cycles(id) ON DELETE RESTRICT,
  payroll_result_id TEXT NOT NULL UNIQUE
    REFERENCES payroll_results(id) ON DELETE RESTRICT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  slip_no TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  published_at TEXT,
  file_url TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'READY'
    CHECK (delivery_status IN ('READY','PUBLISHED','VIEWED','REVOKED')),
  first_viewed_at TEXT,
  last_viewed_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  revoked_at TEXT,
  revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (payroll_cycle_id, slip_no)
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  cover_image_url TEXT,
  requires_acknowledgement INTEGER NOT NULL DEFAULT 0
    CHECK (requires_acknowledgement IN (0,1)),
  current_revision_no INTEGER NOT NULL DEFAULT 1
    CHECK (current_revision_no > 0),
  priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED','ARCHIVED','CANCELLED')),
  scheduled_at TEXT,
  published_at TEXT,
  expires_at TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_announcements_org_status_publish
  ON announcements(organization_id, status, published_at DESC);

CREATE TABLE announcement_targets (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL
    REFERENCES announcements(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('ALL','BRANCH','DEPARTMENT','ROLE','USER')),
  target_id TEXT,
  CHECK (
    (target_type = 'ALL' AND target_id IS NULL)
    OR (target_type <> 'ALL' AND target_id IS NOT NULL)
  ),
  UNIQUE (announcement_id, target_type, target_id)
);

CREATE TABLE announcement_user_activity (
  announcement_id TEXT NOT NULL
    REFERENCES announcements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_viewed_at TEXT,
  last_viewed_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  acknowledged_at TEXT,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX ix_announcement_activity_user
  ON announcement_user_activity(user_id, delivered_at DESC);
CREATE INDEX ix_announcement_activity_admin_report
  ON announcement_user_activity(announcement_id, view_count DESC, last_viewed_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  source_type TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  dismissed_at TEXT
);

CREATE INDEX ix_notifications_user_unread
  ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE file_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes INTEGER CHECK (file_size_bytes >= 0),
  checksum_sha256 TEXT,
  uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_attachments_object
  ON file_attachments(object_type, object_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_audit_object
  ON audit_logs(organization_id, object_type, object_id, created_at DESC);
CREATE INDEX ix_audit_actor
  ON audit_logs(organization_id, actor_user_id, created_at DESC);
CREATE INDEX ix_audit_employee
  ON audit_logs(employee_id, created_at DESC);


CREATE TABLE intercompany_employee_transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  source_employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  source_organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE RESTRICT,
  destination_organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE RESTRICT,
  destination_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  effective_date TEXT NOT NULL,
  transfer_type TEXT NOT NULL DEFAULT 'TRANSFER'
    CHECK (transfer_type IN ('TRANSFER','SECONDMENT','DUAL_EMPLOYMENT')),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING','APPROVED','COMPLETED','REJECTED','CANCELLED')),
  reason TEXT,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  completed_at TEXT,
  CHECK (source_organization_id <> destination_organization_id)
);

CREATE INDEX ix_intercompany_transfer_person
  ON intercompany_employee_transfers(person_id, effective_date DESC);

CREATE TABLE user_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  default_organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_user_invitations_email_status
  ON user_invitations(tenant_id, email, accepted_at, cancelled_at);

CREATE TABLE invitation_company_access (
  invitation_id TEXT NOT NULL
    REFERENCES user_invitations(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  role_id TEXT REFERENCES roles(id) ON DELETE SET NULL,
  PRIMARY KEY (invitation_id, organization_id)
);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT,
  ip_address TEXT,
  user_agent TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_user_sessions_active
  ON user_sessions(user_id, revoked_at, expires_at);

CREATE TABLE account_action_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_type TEXT NOT NULL
    CHECK (token_type IN ('PASSWORD_RESET','EMAIL_VERIFY','UNLOCK')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_account_action_tokens_user
  ON account_action_tokens(user_id, token_type, expires_at);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'SYSTEM'
    CHECK (theme IN ('LIGHT','DARK','SYSTEM')),
  language TEXT NOT NULL DEFAULT 'th'
    CHECK (language IN ('th','en')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  notification_preferences_json TEXT NOT NULL DEFAULT '{}',
  accessibility_preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL
    CHECK (platform IN ('WEB','IOS','ANDROID')),
  push_token_encrypted TEXT,
  device_fingerprint_hash TEXT,
  last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, device_fingerprint_hash)
);

CREATE TABLE employee_profile_change_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL
    CHECK (request_type IN (
      'PERSONAL_INFO','NAME','IDENTITY','ADDRESS','BANK_ACCOUNT',
      'TAX','SOCIAL_SECURITY','EMERGENCY_CONTACT'
    )),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED')),
  reason TEXT,
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  reviewed_at TEXT,
  review_comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_profile_change_requests_status
  ON employee_profile_change_requests(employee_id, status, created_at DESC);

CREATE TABLE employee_profile_change_items (
  id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL
    REFERENCES employee_profile_change_requests(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  old_value_encrypted TEXT,
  new_value_encrypted TEXT,
  display_old_value_masked TEXT,
  display_new_value_masked TEXT,
  UNIQUE (change_request_id, field_path)
);

CREATE TABLE employee_work_experiences (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  position_name TEXT NOT NULL,
  employment_type TEXT,
  started_on TEXT NOT NULL,
  ended_on TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  description TEXT,
  attachment_url TEXT,
  submission_status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (submission_status IN ('DRAFT','SUBMITTED','VERIFIED','REJECTED')),
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  verified_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);

CREATE INDEX ix_work_experience_employee
  ON employee_work_experiences(employee_id, started_on DESC);

CREATE TABLE holidays (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
  holiday_date TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT,
  is_paid INTEGER NOT NULL DEFAULT 1 CHECK (is_paid IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, branch_id, holiday_date)
);

CREATE INDEX ix_holidays_date
  ON holidays(organization_id, holiday_date);

CREATE TABLE department_staffing_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  minimum_staff_count INTEGER NOT NULL DEFAULT 1
    CHECK (minimum_staff_count >= 0),
  maximum_leave_count INTEGER
    CHECK (maximum_leave_count IS NULL OR maximum_leave_count >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE leave_balance_transactions (
  id TEXT PRIMARY KEY,
  employee_leave_balance_id TEXT NOT NULL
    REFERENCES employee_leave_balances(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN (
      'OPENING','ACCRUAL','USAGE','REVERSAL','ADJUSTMENT','CARRY_FORWARD','EXPIRY'
    )),
  minutes INTEGER NOT NULL,
  source_type TEXT,
  source_id TEXT,
  reason TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_leave_balance_ledger
  ON leave_balance_transactions(employee_leave_balance_id, created_at);

CREATE TABLE payroll_cycle_status_history (
  id TEXT PRIMARY KEY,
  payroll_cycle_id TEXT NOT NULL
    REFERENCES payroll_cycles(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  comment TEXT,
  changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_payroll_status_history
  ON payroll_cycle_status_history(payroll_cycle_id, changed_at);

CREATE TABLE announcement_revisions (
  id TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL
    REFERENCES announcements(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  cover_image_url TEXT,
  target_snapshot_json TEXT NOT NULL DEFAULT '[]',
  schedule_snapshot_json TEXT NOT NULL DEFAULT '{}',
  change_summary TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (announcement_id, revision_no)
);

CREATE TABLE data_exports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  export_type TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  filter_snapshot_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','EXPIRED')),
  file_url TEXT,
  file_expires_at TEXT,
  row_count INTEGER CHECK (row_count >= 0),
  error_message TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX ix_data_exports_requester
  ON data_exports(requested_by_user_id, requested_at DESC);

INSERT INTO schema_migrations(version) VALUES ('003_multi_company_schema');

COMMIT;