-- =====================================================================
-- ⚠⚠⚠  DO NOT RUN YET — WILL BREAK IHRMS / ICRM UNTIL PHASE 2 LANDS ⚠⚠⚠
-- =====================================================================
-- Migration 107 — Row Level Security on PII-bearing tables
-- Tenant Spec v1.0 §2.8 (Decision Q-C: hybrid app-layer + RLS on PII)
--
-- WHY THIS IS RISKY:
--   * Enables RLS on tables that today are queried via the anon key
--     without an `active_org_id` JWT claim. The moment RLS is on, those
--     queries return zero rows.
--   * IHRMS in current state issues NextAuth JWTs that do NOT include
--     `active_org_id` or `is_platform_admin` claims. Until Phase 1
--     (shared auth lib) and Phase 2 (route retrofit) are deployed,
--     enabling these policies will appear to wipe customer data from
--     the UI even though the underlying rows are intact.
--
-- WHEN TO RUN:
--   * Phase 1 complete (lib/auth-shared/ deployed in all 3 apps).
--   * Phase 2 complete (IHRMS routes use requireAuth() everywhere).
--   * NextAuth JWT issuance updated to inject `active_org_id` and
--     `is_platform_admin` into the JWT claims that Supabase reads.
--   * Smoke test against staging environment, NOT prod.
--
-- ROLLBACK:
--   ALTER TABLE <name> DISABLE ROW LEVEL SECURITY;
--   DROP POLICY tenant_isolation ON <name>;
--   DROP POLICY imperial_bypass ON <name>;
--
-- NOTE: the service-role key (supabaseAdmin in our code) bypasses RLS
-- automatically. Server-side routes that already use supabaseAdmin are
-- unaffected — this only impacts paths that use the anon / user-scoped key.
-- =====================================================================

-- ---------------------------------------------------------------------
-- JWT claim helper functions — read active_org_id and is_platform_admin
-- from the Supabase JWT (set by the app when issuing user-scoped tokens).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'active_org_id', '')::UUID
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION is_imperial_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json->>'is_platform_admin')::BOOLEAN,
    FALSE
  )
$$ LANGUAGE SQL STABLE;

-- ---------------------------------------------------------------------
-- Apply RLS to PII-bearing tables only.
--
-- Conscious omission: tables without PII (departments, designations,
-- shifts, holidays, app_settings, etc.) are not RLS-protected — the
-- app-layer filter from requireAuth() handles those.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  pii_tables TEXT[] := ARRAY[
    -- HRMS PII
    'employees','payroll_runs','payslips','salary_structures',
    'warning_letters','employee_documents','attendance_daily',
    -- CRM PII (contains customer-of-customer data)
    'crm_contacts','crm_accounts','crm_leads','crm_deals',
    'crm_invoices','crm_estimates','crm_proposals','crm_contracts',
    -- Identity-adjacent
    'audit_logs','tenant_visible_audit'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY pii_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

      -- Drop policies if re-running so the CREATE statements don't fail.
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS imperial_bypass ON %I', t);

      -- Tenant scoping: rows visible to / writeable by the org that owns them.
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
           FOR ALL
           USING (org_id = current_org_id())
           WITH CHECK (org_id = current_org_id())',
        t
      );

      -- Imperial admin bypass: only triggers for impersonation JWTs that
      -- explicitly carry is_platform_admin = true (Admin Console issues these).
      EXECUTE format(
        'CREATE POLICY imperial_bypass ON %I
           FOR ALL
           USING (is_imperial_admin() OR org_id = current_org_id())
           WITH CHECK (is_imperial_admin() OR org_id = current_org_id())',
        t
      );

      RAISE NOTICE 'Enabled RLS on %', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Supabase Storage policies for the org-documents bucket.
-- These cannot be created in SQL — apply via Dashboard → Storage →
-- Policies → org-documents.
--
-- Path structure assumed: {org_id}/path/to/file.ext
--
-- SELECT policy:
--   bucket_id = 'org-documents'
--   AND (is_imperial_admin() OR (storage.foldername(name))[1]::UUID = current_org_id())
--
-- INSERT policy:
--   bucket_id = 'org-documents'
--   AND (storage.foldername(name))[1]::UUID = current_org_id()
--
-- DELETE policy:
--   bucket_id = 'org-documents'
--   AND (is_imperial_admin() OR (storage.foldername(name))[1]::UUID = current_org_id())
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Sanity (run AFTER you've verified Phase 1 + Phase 2 are deployed):
--   SELECT relname, relrowsecurity
--     FROM pg_class
--    WHERE relname IN (
--      'employees','payroll_runs','payslips','salary_structures',
--      'warning_letters','employee_documents','attendance_daily',
--      'crm_contacts','crm_accounts','crm_leads','crm_deals',
--      'crm_invoices','crm_estimates','crm_proposals','crm_contracts',
--      'audit_logs','tenant_visible_audit'
--    );
--   -- expect relrowsecurity = TRUE for every row
-- ---------------------------------------------------------------------
