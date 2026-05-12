-- =====================================================================
-- Migration 104 — Single source of truth for plan pricing + allowance
-- Tenant Spec v1.0 §2.5
--
-- Run order: AFTER 100. No dependency on 102.
-- Safety:    Additive. Seed values are upsert-safe (ON CONFLICT updates).
-- =====================================================================
--
-- IMPORTANT: subscription_plans is the ONLY price source from here on.
-- Marketing site, signup flow, monthly billing cron, and admin UI all
-- read pricing from this table. Hardcoded prices anywhere else are bugs.
-- =====================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product                     TEXT NOT NULL CHECK (product IN ('icrm','ihrms','bundle')),
  tier                        TEXT NOT NULL CHECK (tier IN ('starter','growth','pro','enterprise')),
  price_per_seat_inr          NUMERIC(10,2) NOT NULL,
  min_seats                   INTEGER NOT NULL DEFAULT 1,
  max_seats                   INTEGER,                    -- NULL = unlimited
  annual_discount_pct         NUMERIC(4,2) NOT NULL DEFAULT 16.67,  -- 2 months free
  trial_days                  INTEGER NOT NULL DEFAULT 14,
  trial_requires_card         BOOLEAN NOT NULL DEFAULT FALSE,        -- TRUE for pro + enterprise
  ai_credits_included_monthly INTEGER NOT NULL DEFAULT 0,
  features                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  display_order               INTEGER NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product, tier)
);

-- ---------------------------------------------------------------------
-- Seed: locked tier pricing per Tenant Spec §15.
-- HRMS Starter raised to 149 with 3-seat min per audit recommendation.
-- ---------------------------------------------------------------------
INSERT INTO subscription_plans
  (product,  tier,         price_per_seat_inr, min_seats, trial_requires_card,
   ai_credits_included_monthly, display_order)
VALUES
  ('ihrms',  'starter',     149,  3,  FALSE,    0,    1),
  ('ihrms',  'growth',      299,  5,  FALSE,    0,    2),
  ('ihrms',  'pro',         499,  10, TRUE,     0,    3),
  ('ihrms',  'enterprise',  799,  25, TRUE,     0,    4),
  ('icrm',   'starter',     1299, 1,  FALSE,    50,   5),
  ('icrm',   'growth',      2499, 3,  FALSE,    200,  6),
  ('icrm',   'pro',         4999, 5,  TRUE,     1000, 7),
  ('icrm',   'enterprise',  7999, 10, TRUE,     5000, 8),
  ('bundle', 'starter',     1299, 3,  FALSE,    50,   9),
  ('bundle', 'growth',      2599, 5,  FALSE,    200,  10),
  ('bundle', 'pro',         5099, 10, TRUE,     1000, 11),
  ('bundle', 'enterprise',  8199, 15, TRUE,     5000, 12)
ON CONFLICT (product, tier) DO UPDATE SET
  price_per_seat_inr          = EXCLUDED.price_per_seat_inr,
  min_seats                   = EXCLUDED.min_seats,
  trial_requires_card         = EXCLUDED.trial_requires_card,
  ai_credits_included_monthly = EXCLUDED.ai_credits_included_monthly,
  display_order               = EXCLUDED.display_order,
  updated_at                  = NOW();

-- ---------------------------------------------------------------------
-- Extend org_credits with the tiered-allowance model (Q14 — 1-month carryover).
--
-- New balance composition:
--   balance = allowance_remaining + allowance_carry_over + purchased_balance
--
-- Migration 002 added lifetime_consumed; this migration adds the three
-- pool columns. Existing `balance` is migrated to `purchased_balance`
-- so no credits are lost.
-- ---------------------------------------------------------------------
ALTER TABLE org_credits ADD COLUMN IF NOT EXISTS allowance_remaining   NUMERIC(12,2) DEFAULT 0;
ALTER TABLE org_credits ADD COLUMN IF NOT EXISTS allowance_carry_over  NUMERIC(12,2) DEFAULT 0;
ALTER TABLE org_credits ADD COLUMN IF NOT EXISTS allowance_reset_date  DATE;
ALTER TABLE org_credits ADD COLUMN IF NOT EXISTS purchased_balance     NUMERIC(12,2) DEFAULT 0;
ALTER TABLE org_credits ADD COLUMN IF NOT EXISTS last_consume_at       TIMESTAMPTZ;
ALTER TABLE org_credits ADD COLUMN IF NOT EXISTS last_topup_at         TIMESTAMPTZ;

-- Migrate existing balance → purchased_balance (one-shot, only when
-- purchased_balance hasn't been populated yet).
UPDATE org_credits
   SET purchased_balance = balance
 WHERE COALESCE(purchased_balance, 0) = 0
   AND COALESCE(balance, 0) > 0;

-- ---------------------------------------------------------------------
-- Sanity:
--   SELECT product, tier, price_per_seat_inr, min_seats
--     FROM subscription_plans ORDER BY display_order;
--   SELECT org_id, balance, allowance_remaining, allowance_carry_over,
--          purchased_balance
--     FROM org_credits;
-- ---------------------------------------------------------------------
