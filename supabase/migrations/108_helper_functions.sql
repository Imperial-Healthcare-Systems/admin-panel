-- =====================================================================
-- Migration 108 — Atomic credit, seat, and allowance-reset functions
-- Tenant Spec v1.0 §2.9
--
-- Run order: AFTER 100, 104, 105.
-- Safety:    CREATE OR REPLACE FUNCTION — idempotent, no data changes.
--
-- These four functions become the ONLY way mutation routes interact
-- with credits (Section 10 of the tenant spec). Application code calls
-- them via supabase.rpc(...).
-- =====================================================================

-- ---------------------------------------------------------------------
-- consume_credits(org, feature, amount, user, ref_type, ref_id)
--
-- Drains in allowance-first order:
--   1. allowance_remaining  (current month)
--   2. allowance_carry_over (last month leftover, max 1-month rollover)
--   3. purchased_balance    (top-ups)
--
-- Locks the wallet row FOR UPDATE so concurrent debits stay consistent.
-- Raises 'insufficient_credits' if total available < requested.
-- Returns the new balance.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION consume_credits(
  p_org_id         UUID,
  p_feature_key    TEXT,
  p_amount         NUMERIC,
  p_user_id        UUID,
  p_reference_type TEXT,
  p_reference_id   TEXT
) RETURNS NUMERIC AS $$
DECLARE
  v_remaining       NUMERIC := p_amount;
  v_consumed_allow  NUMERIC := 0;
  v_consumed_carry  NUMERIC := 0;
  v_consumed_purch  NUMERIC := 0;
  v_balance_after   NUMERIC;
  v_credits         org_credits%ROWTYPE;
BEGIN
  SELECT * INTO v_credits FROM org_credits WHERE org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_credits row not found for org %', p_org_id;
  END IF;

  IF (COALESCE(v_credits.allowance_remaining, 0)
    + COALESCE(v_credits.allowance_carry_over, 0)
    + COALESCE(v_credits.purchased_balance, 0)) < p_amount THEN
    RAISE EXCEPTION 'insufficient_credits: need %, have %',
      p_amount,
      (COALESCE(v_credits.allowance_remaining, 0)
       + COALESCE(v_credits.allowance_carry_over, 0)
       + COALESCE(v_credits.purchased_balance, 0));
  END IF;

  -- 1. Allowance pool first
  IF COALESCE(v_credits.allowance_remaining, 0) >= v_remaining THEN
    v_consumed_allow := v_remaining;
    v_remaining := 0;
  ELSE
    v_consumed_allow := COALESCE(v_credits.allowance_remaining, 0);
    v_remaining := v_remaining - v_consumed_allow;
  END IF;

  -- 2. Carry-over pool
  IF v_remaining > 0 THEN
    IF COALESCE(v_credits.allowance_carry_over, 0) >= v_remaining THEN
      v_consumed_carry := v_remaining;
      v_remaining := 0;
    ELSE
      v_consumed_carry := COALESCE(v_credits.allowance_carry_over, 0);
      v_remaining := v_remaining - v_consumed_carry;
    END IF;
  END IF;

  -- 3. Purchased pool
  IF v_remaining > 0 THEN
    v_consumed_purch := v_remaining;
  END IF;

  v_balance_after :=
      (COALESCE(v_credits.allowance_remaining, 0)  - v_consumed_allow)
    + (COALESCE(v_credits.allowance_carry_over, 0) - v_consumed_carry)
    + (COALESCE(v_credits.purchased_balance, 0)    - v_consumed_purch);

  UPDATE org_credits SET
    allowance_remaining  = COALESCE(allowance_remaining, 0)  - v_consumed_allow,
    allowance_carry_over = COALESCE(allowance_carry_over, 0) - v_consumed_carry,
    purchased_balance    = COALESCE(purchased_balance, 0)    - v_consumed_purch,
    balance              = v_balance_after,
    lifetime_consumed    = COALESCE(lifetime_consumed, 0) + p_amount,
    last_consume_at      = NOW(),
    updated_at           = NOW()
  WHERE org_id = p_org_id;

  INSERT INTO credit_transactions (
    org_id, type, amount, direction, feature_key,
    reference_type, reference_id, balance_after, created_by, notes, description
  ) VALUES (
    p_org_id, 'debit', -p_amount, 'debit', p_feature_key,
    p_reference_type, p_reference_id, v_balance_after, p_user_id,
    format('Allowance: %s, Carry: %s, Purchased: %s',
           v_consumed_allow, v_consumed_carry, v_consumed_purch),
    format('Allowance: %s, Carry: %s, Purchased: %s',
           v_consumed_allow, v_consumed_carry, v_consumed_purch)
  );

  RETURN v_balance_after;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- add_credits(org, amount, type, user, ref_type, ref_id, notes)
--
-- Adds purchased / promotional / adjustment / refund-credit. Always
-- credits the purchased_balance pool. lifetime_purchased increments
-- only when type = 'topup'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_credits(
  p_org_id         UUID,
  p_amount         NUMERIC,
  p_type           TEXT,            -- 'topup' | 'promotional' | 'adjustment' | 'refund_credit'
  p_user_id        UUID,
  p_reference_type TEXT,
  p_reference_id   TEXT,
  p_notes          TEXT
) RETURNS NUMERIC AS $$
DECLARE
  v_balance_after NUMERIC;
BEGIN
  UPDATE org_credits SET
    purchased_balance  = COALESCE(purchased_balance, 0) + p_amount,
    balance            = COALESCE(balance, 0) + p_amount,
    total_purchased    = CASE WHEN p_type = 'topup'
                              THEN COALESCE(total_purchased, 0) + p_amount
                              ELSE total_purchased END,
    last_topup_at      = CASE WHEN p_type = 'topup' THEN NOW() ELSE last_topup_at END,
    updated_at         = NOW()
  WHERE org_id = p_org_id
  RETURNING balance INTO v_balance_after;

  IF v_balance_after IS NULL THEN
    INSERT INTO org_credits (org_id, balance, purchased_balance, total_purchased)
    VALUES (
      p_org_id, p_amount, p_amount,
      CASE WHEN p_type = 'topup' THEN p_amount ELSE 0 END
    )
    RETURNING balance INTO v_balance_after;
  END IF;

  INSERT INTO credit_transactions (
    org_id, type, amount, direction, reference_type, reference_id,
    balance_after, created_by, notes, description
  ) VALUES (
    p_org_id, p_type, p_amount, 'credit', p_reference_type, p_reference_id,
    v_balance_after, p_user_id, p_notes, p_notes
  );

  RETURN v_balance_after;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- reset_monthly_allowance(org)
--
-- Called by the daily billing cron at the start of each org's cycle.
-- Carries over UNUSED allowance (max 1 month, Q14) and resets the
-- allowance bucket to the plan's monthly inclusion.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reset_monthly_allowance(p_org_id UUID) RETURNS VOID AS $$
DECLARE
  v_sub   org_subscriptions%ROWTYPE;
  v_plan  subscription_plans%ROWTYPE;
  v_carry NUMERIC;
BEGIN
  SELECT * INTO v_sub FROM org_subscriptions WHERE org_id = p_org_id LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_plan FROM subscription_plans
    WHERE product = v_sub.product AND tier = v_sub.tier LIMIT 1;
  IF NOT FOUND OR v_plan.ai_credits_included_monthly = 0 THEN RETURN; END IF;

  SELECT allowance_remaining INTO v_carry FROM org_credits WHERE org_id = p_org_id;

  UPDATE org_credits SET
    allowance_carry_over = COALESCE(v_carry, 0),
    allowance_remaining  = v_plan.ai_credits_included_monthly,
    allowance_reset_date = CURRENT_DATE,
    balance              = COALESCE(v_carry, 0)
                         + v_plan.ai_credits_included_monthly
                         + COALESCE(purchased_balance, 0),
    updated_at           = NOW()
  WHERE org_id = p_org_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- record_seat_overage(org, delta, source, acknowledged_by_membership)
--
-- Called by the invite route when a new membership pushes the org
-- past its plan seat limit. Returns the event id so the route can
-- show it back to the admin who acknowledged the overage.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_seat_overage(
  p_org_id                          UUID,
  p_delta_seats                     INTEGER,
  p_source                          TEXT,
  p_acknowledged_by_membership_id   UUID
) RETURNS UUID AS $$
DECLARE
  v_sub             org_subscriptions%ROWTYPE;
  v_plan            subscription_plans%ROWTYPE;
  v_event_id        UUID;
  v_current_seats   INTEGER;
BEGIN
  SELECT * INTO v_sub FROM org_subscriptions WHERE org_id = p_org_id LIMIT 1;
  SELECT * INTO v_plan FROM subscription_plans
    WHERE product = v_sub.product AND tier = v_sub.tier LIMIT 1;

  SELECT COUNT(*) INTO v_current_seats
    FROM memberships WHERE org_id = p_org_id AND status = 'active';

  INSERT INTO seat_overage_events (
    org_id, subscription_id, product, seats_at_event, plan_seat_limit,
    delta_seats, per_seat_rate_inr, amount_inr, source,
    acknowledged_by_membership_id, acknowledged_at
  ) VALUES (
    p_org_id, v_sub.id, v_sub.product, v_current_seats, v_sub.seats,
    p_delta_seats, v_plan.price_per_seat_inr,
    p_delta_seats * v_plan.price_per_seat_inr,
    p_source, p_acknowledged_by_membership_id, NOW()
  ) RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Sanity:
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('consume_credits','add_credits',
--                      'reset_monthly_allowance','record_seat_overage');
--   -- expect 4 rows
-- ---------------------------------------------------------------------
