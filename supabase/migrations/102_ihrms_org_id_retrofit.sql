-- =====================================================================
-- ⚠⚠⚠  DO NOT RUN YET — DESTRUCTIVE MIGRATION  ⚠⚠⚠
-- =====================================================================
-- Migration 102 — Multi-tenancy retrofit on existing IHRMS tables
-- Tenant Spec v1.0 §2.3
--
-- WHY THIS IS RISKY:
--   * Adds org_id to ~29 IHRMS tables.
--   * Backfills NULL org_id rows to a "default-legacy" org so the
--     subsequent NOT NULL constraint succeeds.
--   * Once NOT NULL is set, any INSERT that omits org_id will fail.
--     If your application code still inserts without org_id, those
--     write paths will break the moment this runs.
--
-- PRE-FLIGHT CHECKLIST (run BEFORE this migration):
--   1. Supabase Dashboard → Database → Backups → Create backup. Wait for
--      it to finish before proceeding.
--   2. Confirm Phase 2 of the tenant spec (IHRMS route retrofit, §11.1)
--      is complete OR scheduled for the same maintenance window.
--   3. Run during low-traffic hours (early morning IST).
--   4. Have rollback statements ready (drop columns + restore from backup).
--
-- HOW TO RUN:
--   * Apply this file in Supabase SQL Editor as a single transaction.
--   * If any DO block fails, the whole migration rolls back.
--   * Verify with the sanity queries at the bottom before considering
--     the migration complete.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 102.1: ADD org_id where missing (nullable initially)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'departments','designations','shifts','holidays',
    'attendance_logs','attendance_daily','attendance_regularizations',
    'leave_policies','leave_balances','leave_requests',
    'salary_structures','payroll_runs','payslips',
    'job_requisitions','candidates','interview_schedules','interview_feedbacks',
    'performance_reviews','warning_letters','appreciation_notes',
    'expense_claims','probation_reviews','exit_processes',
    'employee_documents','assets','announcements','statutory_compliance',
    'app_settings','notifications'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t)
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = t AND column_name = 'org_id'
       ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN org_id UUID REFERENCES organisations(id) ON DELETE CASCADE',
        t
      );
      RAISE NOTICE 'Added org_id to %', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 102.2: Backfill NULL rows to a "default-legacy" org so 102.3 can flip
--        NOT NULL. Skipped automatically if there's no orphan data.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  default_org_id UUID;
  tables TEXT[] := ARRAY[
    'departments','designations','shifts','holidays',
    'attendance_logs','attendance_daily','attendance_regularizations',
    'leave_policies','leave_balances','leave_requests',
    'salary_structures','payroll_runs','payslips',
    'job_requisitions','candidates','interview_schedules','interview_feedbacks',
    'performance_reviews','warning_letters','appreciation_notes',
    'expense_claims','probation_reviews','exit_processes',
    'employee_documents','assets','announcements','statutory_compliance',
    'app_settings','notifications'
  ];
  t TEXT;
BEGIN
  SELECT id INTO default_org_id
    FROM organisations WHERE slug = 'default-legacy' LIMIT 1;

  IF default_org_id IS NULL THEN
    -- Only create the legacy org if there's actually orphan data anywhere.
    IF EXISTS (SELECT 1 FROM employees WHERE org_id IS NULL LIMIT 1) THEN
      INSERT INTO organisations (slug, name, billing_email, status)
      VALUES ('default-legacy', 'Imperial Internal (Legacy)',
              'ops@imperialhealthcare.cloud', 'active')
      RETURNING id INTO default_org_id;
      RAISE NOTICE 'Created default-legacy org % for backfill', default_org_id;
    END IF;
  END IF;

  IF default_org_id IS NOT NULL THEN
    FOREACH t IN ARRAY tables LOOP
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
        EXECUTE format('UPDATE %I SET org_id = %L WHERE org_id IS NULL', t, default_org_id);
      END IF;
    END LOOP;
    UPDATE employees SET org_id = default_org_id WHERE org_id IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 102.3: Make org_id NOT NULL on every tenant-scoped table.
-- This is the irreversible-without-backup step.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'employees','departments','designations','shifts','holidays',
    'attendance_logs','attendance_daily','attendance_regularizations',
    'leave_policies','leave_balances','leave_requests',
    'salary_structures','payroll_runs','payslips',
    'job_requisitions','candidates','interview_schedules','interview_feedbacks',
    'performance_reviews','warning_letters','appreciation_notes',
    'expense_claims','probation_reviews','exit_processes',
    'employee_documents','assets','announcements','statutory_compliance',
    'app_settings','notifications'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'org_id' AND is_nullable = 'YES'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN org_id SET NOT NULL', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 102.4: Compound indexes for the common tenant-scoped query patterns
-- (org_id is always the leading column).
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_emp_org_status      ON employees(org_id, status);
CREATE INDEX IF NOT EXISTS idx_emp_org_dept        ON employees(org_id, department_id);
CREATE INDEX IF NOT EXISTS idx_pay_org_status      ON payroll_runs(org_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_org_status    ON leave_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_att_org_date        ON attendance_logs(org_id, date);
CREATE INDEX IF NOT EXISTS idx_warn_org_status     ON warning_letters(org_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_org_status   ON assets(org_id, status);
CREATE INDEX IF NOT EXISTS idx_ann_org_pinned      ON announcements(org_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_payslips_org_emp    ON payslips(org_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_docs_org_emp        ON employee_documents(org_id, employee_id);

-- ---------------------------------------------------------------------
-- Sanity (run AFTER migration):
--   -- every IHRMS table should now have NOT NULL org_id:
--   SELECT table_name, is_nullable
--     FROM information_schema.columns
--    WHERE column_name = 'org_id' AND table_schema = 'public'
--    ORDER BY table_name;
--
--   -- count rows in the legacy bucket so you can plan reassignment:
--   SELECT COUNT(*) FROM employees
--    WHERE org_id = (SELECT id FROM organisations WHERE slug = 'default-legacy');
-- ---------------------------------------------------------------------
