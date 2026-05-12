-- =====================================================================
-- Migration 101 — Link existing profile tables to identities
-- Tenant Spec v1.0 §2.2
--
-- Run order: AFTER 100.
-- Safety:    Additive columns + backfill INSERTs. Existing rows updated
--            (identity_id, membership_id set). Re-runnable: ON CONFLICT
--            no-ops on identities, conditional UPDATEs on profile rows.
-- =====================================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS identity_id   UUID REFERENCES identities(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employees_identity   ON employees(identity_id);
CREATE INDEX IF NOT EXISTS idx_employees_membership ON employees(membership_id);

ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS identity_id   UUID REFERENCES identities(id) ON DELETE SET NULL;
ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_crm_users_identity   ON crm_users(identity_id);
CREATE INDEX IF NOT EXISTS idx_crm_users_membership ON crm_users(membership_id);

-- ---------------------------------------------------------------------
-- Backfill: each row in employees / crm_users gets an identity (creating
-- one if its email isn't already in identities), plus a membership.
--
-- Existing schema notes:
--   * employees.work_email exists in IHRMS; if your DB only has `email`
--     adjust the column name in the first FOR loop below.
--   * employees in this DB uses `full_name` (generated) + `status` (text).
--   * crm_users uses `full_name` + `is_active` (boolean).
-- ---------------------------------------------------------------------

DO $$
DECLARE
  rec               RECORD;
  v_identity_id     UUID;
  v_membership_id   UUID;
  v_email           TEXT;
  v_emp_email_col   TEXT;
BEGIN
  -- Auto-detect whether employees uses `work_email` (IHRMS) or `email`
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'work_email'
  ) THEN 'work_email' ELSE 'email' END
  INTO v_emp_email_col;

  -- ----- employees → identities + memberships (hrms_access) -----
  FOR rec IN EXECUTE format($f$
    SELECT e.id, e.org_id, e.%I AS email, e.full_name, e.role, e.avatar_url
    FROM employees e
    WHERE e.identity_id IS NULL
      AND e.%I IS NOT NULL
      AND e.org_id IS NOT NULL
  $f$, v_emp_email_col, v_emp_email_col)
  LOOP
    v_email := LOWER(rec.email);

    INSERT INTO identities (email, full_name, avatar_url)
    VALUES (v_email, rec.full_name, rec.avatar_url)
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id INTO v_identity_id;

    INSERT INTO memberships (identity_id, org_id, role, status, hrms_access)
    VALUES (
      v_identity_id,
      rec.org_id,
      CASE
        WHEN rec.role = 'super_admin'        THEN 'owner'::membership_role
        WHEN rec.role IN ('hr_admin','admin') THEN 'hr_admin'::membership_role
        WHEN rec.role = 'manager'            THEN 'manager'::membership_role
        ELSE 'member'::membership_role
      END,
      'active',
      TRUE
    )
    ON CONFLICT (identity_id, org_id) DO UPDATE
      SET hrms_access = TRUE,
          updated_at  = NOW()
    RETURNING id INTO v_membership_id;

    UPDATE employees
       SET identity_id = v_identity_id,
           membership_id = v_membership_id
     WHERE id = rec.id;
  END LOOP;

  -- ----- crm_users → identities + memberships (crm_access) -----
  FOR rec IN
    SELECT u.id, u.org_id, u.email, u.full_name, u.role, u.avatar_url
    FROM crm_users u
    WHERE u.identity_id IS NULL
      AND u.email IS NOT NULL
      AND u.org_id IS NOT NULL
  LOOP
    v_email := LOWER(rec.email);

    INSERT INTO identities (email, full_name, avatar_url)
    VALUES (v_email, rec.full_name, rec.avatar_url)
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id INTO v_identity_id;

    INSERT INTO memberships (identity_id, org_id, role, status, crm_access)
    VALUES (
      v_identity_id,
      rec.org_id,
      CASE
        WHEN rec.role = 'super_admin'                  THEN 'owner'::membership_role
        WHEN rec.role = 'admin'                        THEN 'crm_admin'::membership_role
        WHEN rec.role IN ('sales_director','sales_manager') THEN 'manager'::membership_role
        WHEN rec.role = 'finance'                      THEN 'finance'::membership_role
        WHEN rec.role = 'viewer'                       THEN 'viewer'::membership_role
        ELSE 'member'::membership_role
      END,
      'active',
      TRUE
    )
    ON CONFLICT (identity_id, org_id) DO UPDATE
      SET crm_access = TRUE,
          updated_at = NOW()
    RETURNING id INTO v_membership_id;

    UPDATE crm_users
       SET identity_id = v_identity_id,
           membership_id = v_membership_id
     WHERE id = rec.id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Bring the existing is_platform_admin flag forward to identities,
-- so the Admin Console can read auth from identities (Section 3.2).
-- ---------------------------------------------------------------------
UPDATE identities i
   SET is_platform_admin = TRUE
  FROM employees e
 WHERE e.identity_id = i.id
   AND e.is_platform_admin = TRUE
   AND i.is_platform_admin = FALSE;

-- Same for TOTP enrollment (migration 001 added these columns on employees)
UPDATE identities i
   SET totp_secret  = e.totp_secret,
       totp_enabled = e.totp_enabled
  FROM employees e
 WHERE e.identity_id = i.id
   AND e.totp_enabled = TRUE
   AND i.totp_enabled = FALSE;

-- ---------------------------------------------------------------------
-- Sanity:
--   SELECT COUNT(*) FROM employees WHERE identity_id IS NULL;   -- expect 0
--   SELECT COUNT(*) FROM crm_users WHERE identity_id IS NULL;   -- expect 0
--   SELECT COUNT(*) FROM identities WHERE is_platform_admin;    -- expect ≥1
--
-- DO NOT drop employees.work_email / crm_users.email yet — existing code
-- reads them. Tenant Spec §4 transitions reads to identities incrementally.
-- ---------------------------------------------------------------------
