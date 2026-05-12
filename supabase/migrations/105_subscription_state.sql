-- =====================================================================
-- Migration 105 — Subscription state, seat overage, refund safety
-- Tenant Spec v1.0 §2.6
--
-- Run order: AFTER 100 + 104.
-- Safety:    Additive. Extends org_subscriptions; creates 3 new tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extend org_subscriptions with billing-cycle, card-on-file, and the
-- staged-wind-down timestamps (trial → past_due → read_only →
-- export_only → deactivated, per Section 7.1 state machine).
--
-- Note: status, cancelled_at, trial_ends_at, next_billing_date already
-- exist from migration 001.
-- ---------------------------------------------------------------------
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS billing_cycle TEXT
  CHECK (billing_cycle IN ('monthly','annual')) DEFAULT 'monthly';
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS card_on_file_token       TEXT;
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS card_last4               TEXT;
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS card_brand               TEXT;
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS next_billing_amount_inr  NUMERIC(12,2);
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS soft_locked_at           TIMESTAMPTZ;
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS read_only_at             TIMESTAMPTZ;
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS export_only_at           TIMESTAMPTZ;
ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS deactivated_at           TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- seat_overage_events — every time a membership crosses the plan limit,
-- one row is written. Aggregated into the next platform_invoice by the
-- monthly billing cron.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seat_overage_events (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  subscription_id                 UUID NOT NULL REFERENCES org_subscriptions(id) ON DELETE CASCADE,
  product                         TEXT NOT NULL,
  occurred_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seats_at_event                  INTEGER NOT NULL,            -- total seats after this addition
  plan_seat_limit                 INTEGER NOT NULL,            -- tier's min_seats (or contracted seats)
  delta_seats                     INTEGER NOT NULL,            -- how many over the limit this event added
  per_seat_rate_inr               NUMERIC(10,2) NOT NULL,
  amount_inr                      NUMERIC(12,2) NOT NULL,      -- delta_seats * per_seat_rate_inr
  source                          TEXT NOT NULL CHECK (source IN ('manual_create','bulk_import','ecosystem_sync')),
  acknowledged_by_membership_id   UUID REFERENCES memberships(id),
  acknowledged_at                 TIMESTAMPTZ,
  invoiced_in                     UUID REFERENCES platform_invoices(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seat_overage_org_open
  ON seat_overage_events(org_id) WHERE invoiced_in IS NULL;

-- ---------------------------------------------------------------------
-- admin_refund_limits — per-admin daily cap + above-threshold approval
-- requirement. One row per admin identity; defaults applied if absent.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_refund_limits (
  admin_identity_id                  UUID PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
  daily_cap_inr                      NUMERIC(12,2) NOT NULL DEFAULT 50000,
  requires_second_approval_above_inr NUMERIC(12,2) NOT NULL DEFAULT 50000,
  created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- refund_approvals — pending approvals for refunds above the threshold.
-- A second admin (not the requester) must approve before the Cashfree
-- call fires. State transitions: pending → approved → executed,
-- or pending → rejected, or pending → expired.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refund_approvals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id          UUID NOT NULL REFERENCES platform_invoices(id) ON DELETE CASCADE,
  amount_inr          NUMERIC(12,2) NOT NULL,
  reason              TEXT NOT NULL,
  requested_by        UUID NOT NULL REFERENCES identities(id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by         UUID REFERENCES identities(id),
  approved_at         TIMESTAMPTZ,
  rejected_by         UUID REFERENCES identities(id),
  rejected_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','executed','expired')),
  executed_at         TIMESTAMPTZ,
  cashfree_refund_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_refund_approvals_pending
  ON refund_approvals(status) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- Sanity:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'org_subscriptions' AND column_name LIKE '%_at'
--    ORDER BY column_name;
-- ---------------------------------------------------------------------
