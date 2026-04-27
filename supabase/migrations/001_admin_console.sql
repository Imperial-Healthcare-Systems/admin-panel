-- =====================================================================
-- Imperial Admin Console — Migration 001
-- Run this in the SHARED Supabase project (same DB as IHRMS + ICRM).
-- Idempotent: safe to re-run; uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--
-- Sections:
--   A. Prerequisite tables that the bible §2 assumes exist
--      (organisations, org_subscriptions, platform_invoices, ecosystem_events)
--   B. §2.1 admin-console-specific additions
--   C. Decision Gate #2 — TOTP columns on employees
--   D. First-admin grant helper (commented; run by hand)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- A. Prerequisite tables
-- ---------------------------------------------------------------------

-- A.1 organisations — central tenant table (shared across IHRMS + ICRM)
CREATE TABLE IF NOT EXISTS organisations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  billing_email TEXT,
  contact_phone TEXT,
  gstin TEXT,
  address JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','cancelled','archived')),
  signup_source TEXT,
  signup_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_organisations_slug ON organisations(slug);
CREATE INDEX IF NOT EXISTS idx_organisations_status ON organisations(status);

-- A.2 org_subscriptions — billing state per org per product
CREATE TABLE IF NOT EXISTS org_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  product TEXT NOT NULL CHECK (product IN ('ihrms','icrm','bundle')),
  tier TEXT NOT NULL,                      -- e.g. 'starter','pro','enterprise'
  seats INTEGER NOT NULL DEFAULT 1,
  amount_per_month NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'trial'
         CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at TIMESTAMPTZ,
  current_period_start DATE,
  current_period_end DATE,
  next_billing_date DATE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, product)
);
CREATE INDEX IF NOT EXISTS idx_org_sub_status ON org_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_org_sub_product ON org_subscriptions(product);

-- A.3 platform_invoices — billed line items, linked to Cashfree orders
CREATE TABLE IF NOT EXISTS platform_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES org_subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT UNIQUE,
  product TEXT,
  period_start DATE,
  period_end DATE,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'draft'
         CHECK (status IN ('draft','open','paid','past_due','refunded','partially_refunded','void')),
  cashfree_order_id TEXT,
  paid_at TIMESTAMPTZ,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_org ON platform_invoices(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_status ON platform_invoices(status);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_cashfree ON platform_invoices(cashfree_order_id);

-- A.4 ecosystem_events — cross-product event stream (IHRMS + ICRM both write here)
CREATE TABLE IF NOT EXISTS ecosystem_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  source_platform TEXT NOT NULL CHECK (source_platform IN ('ihrms','icrm','admin','system')),
  event_type TEXT NOT NULL,
  actor_user_id UUID,
  actor_type TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eco_events_org_time ON ecosystem_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eco_events_source ON ecosystem_events(source_platform, event_type);

-- ---------------------------------------------------------------------
-- B. §2.1 — Admin Console specific tables
-- ---------------------------------------------------------------------

-- Mark employees who can access the Admin Console
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE;

-- Impersonation audit trail
CREATE TABLE IF NOT EXISTS platform_impersonation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES employees(id),
  impersonated_org_id UUID NOT NULL REFERENCES organisations(id),
  impersonated_user_id UUID,
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  actions_taken JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_imp_log_admin ON platform_impersonation_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_imp_log_org ON platform_impersonation_log(impersonated_org_id);

-- Platform admin action log (general audit)
CREATE TABLE IF NOT EXISTS platform_admin_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES employees(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  payload JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_log_admin_time ON platform_admin_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_log_action ON platform_admin_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_log_target ON platform_admin_log(target_type, target_id);

-- Plan overrides (grandfathered pricing per org)
CREATE TABLE IF NOT EXISTS org_plan_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID UNIQUE NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  custom_amount_per_month NUMERIC(12,2),
  reason TEXT NOT NULL,
  effective_from DATE NOT NULL,
  expires_on DATE,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendor cost snapshots (monthly spend)
CREATE TABLE IF NOT EXISTS platform_vendor_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor TEXT NOT NULL,
  period_month DATE NOT NULL,
  amount_usd NUMERIC(12,2),
  amount_inr NUMERIC(12,2),
  units_consumed NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vendor, period_month)
);

-- Customer health snapshots (filled by daily cron — §6.6)
CREATE TABLE IF NOT EXISTS org_health_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  health_score SMALLINT NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  factors JSONB DEFAULT '{}'::jsonb,
  risk_level TEXT CHECK (risk_level IN ('healthy','at_risk','critical')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_health_org_date ON org_health_snapshots(org_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_health_risk ON org_health_snapshots(risk_level, snapshot_date DESC);

-- ---------------------------------------------------------------------
-- C. Decision Gate #2 — TOTP (Google Authenticator) mandatory for admins
-- ---------------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- D. First-admin grant (uncomment + edit the email, run ONCE)
-- ---------------------------------------------------------------------
-- UPDATE employees
-- SET is_platform_admin = TRUE
-- WHERE email = 'youremail@imperialhealthcare.cloud';

-- Sanity check after running:
-- SELECT id, email, is_platform_admin, totp_enabled FROM employees WHERE is_platform_admin = TRUE;
