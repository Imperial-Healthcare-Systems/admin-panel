-- =====================================================================
-- Migration 103 — Per-org branding / white-label
-- Tenant Spec v1.0 §2.4
--
-- Run order: AFTER 100 (or any time — no dependency on identities).
-- Safety:    Additive only. Seeds a default level=none row for every
--            existing org so the join in lib/auth-shared/membership.ts
--            never returns NULL branding.
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whitelabel_level') THEN
    CREATE TYPE whitelabel_level AS ENUM ('none', 'logo', 'full', 'custom_domain');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS org_branding (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                 UUID UNIQUE NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  level                  whitelabel_level NOT NULL DEFAULT 'none',

  -- visual identity
  logo_url               TEXT,                             -- replaces Imperial logo at level ≥ 'logo'
  logo_dark_url          TEXT,
  favicon_url            TEXT,
  primary_color          TEXT DEFAULT '#1565C0',
  accent_color           TEXT DEFAULT '#10B981',

  -- app names (level = 'full' or higher)
  app_name_hrms          TEXT,                             -- "Acme HR"
  app_name_crm           TEXT,                             -- "Acme Sales"

  -- email
  email_from_name        TEXT,                             -- "Acme HR Notifications"
  email_from_addr        TEXT,                             -- "noreply@acme.com" — DNS-verified
  email_dns_verified     BOOLEAN DEFAULT FALSE,

  -- custom domain (level 3 — deferred v1, table accepts the columns now)
  custom_domain_hrms     TEXT,                             -- "hr.acme.com"
  custom_domain_crm      TEXT,                             -- "crm.acme.com"
  custom_domain_verified BOOLEAN DEFAULT FALSE,

  -- watermark suppression. ONLY honored when level >= 'full' (Section 9.1).
  hide_powered_by        BOOLEAN DEFAULT FALSE,

  -- invoice-specific
  invoice_logo_url       TEXT,
  invoice_footer_text    TEXT,
  pdf_template           TEXT,                             -- 'default' | 'minimal' | 'corporate'

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_branding_level
  ON org_branding(level) WHERE level <> 'none';

-- The spec references a `create_updated_at_trigger('org_branding')` helper.
-- If that function exists in your shared DB (defined by IHRMS migrations),
-- call it here. Otherwise the application layer must update updated_at on
-- writes (existing pattern in lib/audit.ts).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_updated_at_trigger') THEN
    PERFORM create_updated_at_trigger('org_branding');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Seed default branding (level = 'none') for every existing org so
-- LEFT JOIN org_branding always returns a row.
-- ---------------------------------------------------------------------
INSERT INTO org_branding (org_id)
SELECT id FROM organisations
WHERE id NOT IN (SELECT org_id FROM org_branding)
ON CONFLICT (org_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Sanity:
--   SELECT level, COUNT(*) FROM org_branding GROUP BY level;
--   -- expect: 'none' = total org count, others = 0 initially
-- ---------------------------------------------------------------------
