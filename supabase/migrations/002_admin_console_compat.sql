-- =====================================================================
-- Imperial Admin Console — Migration 002 (compatibility layer)
--
-- Audit found that ICRM's `feature_catalog`, `org_features`, `org_credits`,
-- and `credit_transactions` tables have a SHALLOWER schema than the bible
-- spec assumes. This migration adds the missing columns additively so the
-- spec routes (§6.1, §6.2, §5.3, §5.4, §6.5) work without rewriting the
-- existing ICRM tables.
--
-- Idempotent: every column is ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- Run AFTER 001_admin_console.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- feature_catalog — admin-side metadata for cost/margin tuning (§5.3)
-- ---------------------------------------------------------------------
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS vendor_name TEXT;
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS vendor_cost_per_unit NUMERIC(12,6);
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS markup_multiplier NUMERIC(8,4);
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS unit_description TEXT;
ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS default_enabled BOOLEAN DEFAULT FALSE;
-- ICRM already has `credit_cost` and `preferred_provider`; we read those as-is.

-- ---------------------------------------------------------------------
-- org_features — per-org toggle state with audit + override (§6.1)
-- ICRM's existing column is `enabled`; we keep using that name.
-- ---------------------------------------------------------------------
ALTER TABLE org_features ADD COLUMN IF NOT EXISTS custom_credits_per_unit NUMERIC(12,4);
ALTER TABLE org_features ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE org_features ADD COLUMN IF NOT EXISTS enabled_at TIMESTAMPTZ;
ALTER TABLE org_features ADD COLUMN IF NOT EXISTS enabled_by UUID REFERENCES employees(id);
ALTER TABLE org_features ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE org_features ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES employees(id);

-- Make sure org_features.feature_key + org_id has a uniqueness so upsert(onConflict) works.
-- Use DO block to add the constraint only if it doesn't already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_features_org_feature_unique'
  ) THEN
    BEGIN
      ALTER TABLE org_features ADD CONSTRAINT org_features_org_feature_unique
        UNIQUE (org_id, feature_key);
    EXCEPTION WHEN duplicate_table THEN
      -- already there under a different name; ignore
      NULL;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- org_credits — admin manual-adjust support (§6.2)
-- ICRM has `total_purchased` (we read that). Add lifetime_consumed for parity.
-- ---------------------------------------------------------------------
ALTER TABLE org_credits ADD COLUMN IF NOT EXISTS lifetime_consumed NUMERIC(14,2) DEFAULT 0;

-- ---------------------------------------------------------------------
-- credit_transactions — running balance + admin attribution (§6.2, §6.5)
-- ICRM has direction/ref_id/description/user_id; we add the spec fields.
-- ---------------------------------------------------------------------
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14,2);
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS reference_type TEXT;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id);
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS notes TEXT;

-- ICRM's user_id is FK to crm_users; admin-initiated rows leave it NULL and
-- populate created_by instead. Make user_id nullable if it isn't already.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE credit_transactions ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;

-- Make direction nullable too so admin-initiated rows can derive it implicitly
-- (we'll always populate it from sign of amount in code).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'direction' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE credit_transactions ALTER COLUMN direction DROP NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- ecosystem_events — pre-existing slim version may lack actor columns
-- (CREATE TABLE IF NOT EXISTS in 001 was a no-op against an older copy).
-- ---------------------------------------------------------------------
ALTER TABLE ecosystem_events ADD COLUMN IF NOT EXISTS actor_user_id UUID;
ALTER TABLE ecosystem_events ADD COLUMN IF NOT EXISTS actor_type TEXT;
ALTER TABLE ecosystem_events ADD COLUMN IF NOT EXISTS source_platform TEXT;
ALTER TABLE ecosystem_events ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Sanity: confirm the additive columns landed
-- ---------------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name IN ('feature_catalog','org_features','org_credits','credit_transactions')
-- ORDER BY table_name, ordinal_position;
