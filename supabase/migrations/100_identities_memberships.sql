-- =====================================================================
-- Migration 100 — Identity, Membership, and Org-invitation tables
-- Tenant Spec v1.0 §2.1
--
-- Run order: AFTER migrations 001 + 002.
-- Safety:    Additive only. No existing data touched.
-- Idempotent: yes (IF NOT EXISTS + DO blocks for enums).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- identities — the auth root (one row per real human, keyed by email)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identities (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email              TEXT UNIQUE NOT NULL,
  email_verified_at  TIMESTAMPTZ,
  full_name          TEXT,
  avatar_url         TEXT,
  phone              TEXT,
  is_platform_admin  BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret        TEXT,
  totp_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at      TIMESTAMPTZ,
  last_active_org_id UUID,                              -- denormalized hint, FK added in 101 after backfill
  is_locked          BOOLEAN NOT NULL DEFAULT FALSE,
  locked_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(email);
CREATE INDEX IF NOT EXISTS idx_identities_platform_admin
  ON identities(is_platform_admin) WHERE is_platform_admin = TRUE;

-- ---------------------------------------------------------------------
-- Membership role + status enums
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role') THEN
    CREATE TYPE membership_role AS ENUM (
      'owner',         -- super_admin equivalent; one per org; transferable
      'admin',         -- platform-wide admin within tenant
      'hr_admin',      -- HRMS-wide admin
      'crm_admin',     -- CRM-wide admin
      'manager',       -- subset (department / team)
      'member',        -- regular employee / user
      'finance',       -- billing / invoices visibility, no HR
      'viewer'         -- read-only
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status') THEN
    CREATE TYPE membership_status AS ENUM ('invited', 'active', 'suspended', 'removed');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- memberships — identity ↔ organisation link, carries role + app access
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memberships (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identity_id   UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  role          membership_role NOT NULL DEFAULT 'member',
  status        membership_status NOT NULL DEFAULT 'invited',
  hrms_access   BOOLEAN NOT NULL DEFAULT FALSE,
  crm_access    BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by    UUID REFERENCES identities(id),
  invited_at    TIMESTAMPTZ DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ,
  removed_at    TIMESTAMPTZ,
  removed_by    UUID REFERENCES identities(id),
  metadata      JSONB DEFAULT '{}'::jsonb,              -- { hrms_employee_id, crm_user_id, … }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (identity_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_identity ON memberships(identity_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_role
  ON memberships(org_id, role) WHERE status = 'active';

-- Note: exactly-one-owner-per-org is enforced at the application layer
-- (transfer-ownership briefly has two owners during the swap).

-- ---------------------------------------------------------------------
-- org_invitations — pending invites for emails that may not exist as
-- identities yet (the token lets them accept + create their identity)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_invitations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         membership_role NOT NULL DEFAULT 'member',
  hrms_access  BOOLEAN NOT NULL DEFAULT FALSE,
  crm_access   BOOLEAN NOT NULL DEFAULT FALSE,
  token        TEXT UNIQUE NOT NULL,                     -- random 64-char URL-safe token
  invited_by   UUID NOT NULL REFERENCES identities(id),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at  TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON org_invitations(token);
-- Partial unique index: only one OPEN invitation per (org, email).
-- (Inline UNIQUE-with-WHERE is not valid PG syntax; using CREATE UNIQUE INDEX.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_pending
  ON org_invitations (org_id, email)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- ---------------------------------------------------------------------
-- Sanity (run after migration):
--   SELECT COUNT(*) FROM identities;
--   SELECT COUNT(*) FROM memberships;
--   SELECT COUNT(*) FROM org_invitations;
-- ---------------------------------------------------------------------
