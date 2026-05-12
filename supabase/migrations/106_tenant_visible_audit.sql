-- =====================================================================
-- Migration 106 — Customer-visible audit log for Imperial actions
-- Tenant Spec v1.0 §2.7
--
-- Decision Q3b: customers see Imperial admin actions in their OWN audit
-- log. This table is read by customer-facing apps; platform_admin_log
-- (Imperial-internal) is the source of truth for the same events but
-- richer payload.
--
-- Run order: AFTER 100 (depends on organisations only).
-- Safety:    Additive, single new table.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tenant_visible_audit (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_type            TEXT NOT NULL,
    -- canonical values:
    --   'imperial.access'
    --   'imperial.impersonation'
    --   'imperial.impersonation_ended'
    --   'imperial.feature_toggle'
    --   'imperial.subscription_change'
    --   'imperial.refund'
    --   'imperial.suspension'
  imperial_admin_email  TEXT,                          -- denormalized so it survives admin row deletion
  reason                TEXT,
  reference_type        TEXT,                          -- e.g. 'support_ticket', 'security_audit', 'impersonation_log'
  reference_id          TEXT,                          -- ticket #, audit ID, etc.
  metadata              JSONB DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_org_time
  ON tenant_visible_audit(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_event_type
  ON tenant_visible_audit(event_type, created_at DESC);

-- ---------------------------------------------------------------------
-- Sanity:
--   SELECT event_type, COUNT(*) FROM tenant_visible_audit GROUP BY event_type;
-- ---------------------------------------------------------------------
