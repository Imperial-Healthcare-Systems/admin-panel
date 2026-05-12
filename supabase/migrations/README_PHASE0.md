# Phase 0 — Database Migrations Runbook

Tenant Spec v1.0 §14 Phase 0. Migrations `100`–`108` land the tenant/identity model and pricing layer that the rest of the spec builds on. This runbook is the script to follow when applying them to the shared Supabase project.

> **Scope of Phase 0 only.** Phase 1+ (shared auth library, IHRMS retrofit, billing crons, etc.) are NOT in this runbook.

---

## Pre-flight (do these first, no exceptions)

1. **Back up the shared Supabase project.** Dashboard → Database → Backups → Create backup. Wait for "Completed". Note the timestamp.
2. **Confirm no IHRMS deploy in flight.** Migration 102 changes table constraints; concurrent IHRMS writes during the migration may fail.
3. **Pick a low-traffic window.** Early-morning IST is fine. The full Phase 0 takes ~5 minutes of SQL execution.
4. **Open Supabase SQL Editor** in a tab. Don't use any other migration tool — these files were authored to run as-is against the shared DB.

---

## Run order — TL;DR

| # | Step | Safe to run anytime? | Notes |
| - | --- | --- | --- |
| 1 | `100_identities_memberships.sql` | ✅ Yes | Additive, no existing rows touched. |
| 2 | `101_link_profiles.sql` | ✅ Yes | Backfills identities from existing employees + crm_users. |
| 3 | `103_org_branding.sql` | ✅ Yes | Seeds default branding (level=none) per org. |
| 4 | `104_subscription_plans.sql` | ✅ Yes | Seeds locked pricing per §15; extends `org_credits`. |
| 5 | `105_subscription_state.sql` | ✅ Yes | Extends `org_subscriptions`; creates overage + refund-approval tables. |
| 6 | `106_tenant_visible_audit.sql` | ✅ Yes | Single new table. |
| 7 | `108_helper_functions.sql` | ✅ Yes | Four `CREATE OR REPLACE FUNCTION` statements. |
| 8 | `102_ihrms_org_id_retrofit.sql` | ⚠ **After backup, off-hours** | Adds NOT NULL to 29 IHRMS tables. See §"Migration 102" below. |
| 9 | `107_rls_on_pii.sql` | ❌ **HOLD until Phase 2 complete** | Enables RLS — will make IHRMS appear to wipe customer data until Phase 1+2 are deployed. See §"Migration 107" below. |

Apply them strictly in this order. 100–108 in numeric order with one exception: **107 is held until later phases land**.

---

## Step-by-step

### Step 1 — Safe additive migrations (100, 101, 103, 104, 105, 106, 108)

Run each file in the SQL Editor. After each, check the noted sanity query at the bottom of the file. Expected counts:

- **100**: `SELECT COUNT(*) FROM identities` → 0; same for memberships / org_invitations.
- **101**: `SELECT COUNT(*) FROM employees WHERE identity_id IS NULL` → 0. `SELECT COUNT(*) FROM identities WHERE is_platform_admin` → ≥ 1 (your admin row carried forward).
- **103**: `SELECT level, COUNT(*) FROM org_branding GROUP BY level` → `none = <total org count>`.
- **104**: `SELECT product, tier, price_per_seat_inr FROM subscription_plans ORDER BY display_order` → 12 rows. `SELECT org_id, balance, purchased_balance FROM org_credits` → `purchased_balance` equals old `balance`.
- **105**: confirm `ALTER` succeeded — `SELECT column_name FROM information_schema.columns WHERE table_name = 'org_subscriptions' AND column_name LIKE '%_at'`.
- **106**: `SELECT COUNT(*) FROM tenant_visible_audit` → 0.
- **108**: `SELECT proname FROM pg_proc WHERE proname IN ('consume_credits','add_credits','reset_monthly_allowance','record_seat_overage')` → 4 rows.

If any sanity check fails, **stop and investigate before proceeding**. Don't apply later migrations to a broken state.

### Step 2 — Run `/qa` smoke test against Admin Console

Existing `/qa` page should still be 29/29 GREEN after migrations 100/101/103/104/105/106/108. The new tables shouldn't break any current admin route. If it goes red, the safe-additive migrations introduced an unexpected interaction — investigate before continuing.

### Step 3 — Migration 102 (destructive — separate session)

**Pre-flight again:**
1. Re-confirm fresh backup exists from < 60 minutes ago.
2. Confirm IHRMS deployment is paused.
3. Read the header of `102_ihrms_org_id_retrofit.sql` end-to-end one more time.

Run `102_ihrms_org_id_retrofit.sql`. It does three things in sequence:
- Adds `org_id` to 29 IHRMS tables (nullable initially).
- Backfills NULL rows to a `default-legacy` org (auto-created if needed).
- Sets `NOT NULL` on all `org_id` columns.

Watch the `NOTICE` lines in the SQL Editor output. You'll see `Added org_id to <table>` for each table that needed it, and `Created default-legacy org <uuid> for backfill` if backfill ran.

**Post-flight:**
```sql
-- Every IHRMS table should now have NOT NULL org_id
SELECT table_name
  FROM information_schema.columns
 WHERE column_name = 'org_id'
   AND table_schema = 'public'
   AND is_nullable = 'NO'
 ORDER BY table_name;

-- How much data landed in the legacy bucket (you'll want to reassign it later)
SELECT COUNT(*) FROM employees
 WHERE org_id = (SELECT id FROM organisations WHERE slug = 'default-legacy');
```

If the migration fails partway, the transaction rolls back automatically. Investigate the error message; common causes are: missing `organisations` row to backfill against, or an `employees` row whose `org_id` is also NULL preventing the legacy-org INSERT from triggering.

### Step 4 — Migration 107 (HOLD)

Do not run `107_rls_on_pii.sql` yet. Apply it only after:
1. Phase 1 of the tenant spec lands (shared `lib/auth-shared/` deployed in IHRMS, ICRM, Admin Console).
2. Phase 2 retrofit lands (all 64 IHRMS routes use `requireAuth()`).
3. NextAuth JWT issuance updated to inject `active_org_id` + `is_platform_admin` into the Supabase JWT claims.
4. Staging environment smoke test confirms data still renders after enabling RLS.

When ready, run 107 in staging first. Watch for any "0 rows" UI regressions. Promote to production only after staging is verified.

---

## Rollback procedures

### Rolling back 100, 101, 103, 104, 105, 106, 108

These are additive. Rollback = drop the new tables and the added columns:

```sql
-- 108
DROP FUNCTION IF EXISTS consume_credits;
DROP FUNCTION IF EXISTS add_credits;
DROP FUNCTION IF EXISTS reset_monthly_allowance;
DROP FUNCTION IF EXISTS record_seat_overage;

-- 106
DROP TABLE IF EXISTS tenant_visible_audit;

-- 105
DROP TABLE IF EXISTS refund_approvals;
DROP TABLE IF EXISTS admin_refund_limits;
DROP TABLE IF EXISTS seat_overage_events;
ALTER TABLE org_subscriptions
  DROP COLUMN IF EXISTS billing_cycle,
  DROP COLUMN IF EXISTS card_on_file_token,
  DROP COLUMN IF EXISTS card_last4,
  DROP COLUMN IF EXISTS card_brand,
  DROP COLUMN IF EXISTS next_billing_amount_inr,
  DROP COLUMN IF EXISTS soft_locked_at,
  DROP COLUMN IF EXISTS read_only_at,
  DROP COLUMN IF EXISTS export_only_at,
  DROP COLUMN IF EXISTS deactivated_at;

-- 104
DROP TABLE IF EXISTS subscription_plans;
ALTER TABLE org_credits
  DROP COLUMN IF EXISTS allowance_remaining,
  DROP COLUMN IF EXISTS allowance_carry_over,
  DROP COLUMN IF EXISTS allowance_reset_date,
  DROP COLUMN IF EXISTS purchased_balance,
  DROP COLUMN IF EXISTS last_consume_at,
  DROP COLUMN IF EXISTS last_topup_at;
-- (existing balance is unchanged; the data we copied to purchased_balance is lost)

-- 103
DROP TABLE IF EXISTS org_branding;
DROP TYPE IF EXISTS whitelabel_level;

-- 101
ALTER TABLE employees   DROP COLUMN IF EXISTS membership_id, DROP COLUMN IF EXISTS identity_id;
ALTER TABLE crm_users   DROP COLUMN IF EXISTS membership_id, DROP COLUMN IF EXISTS identity_id;

-- 100
DROP TABLE IF EXISTS org_invitations;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS identities;
DROP TYPE IF EXISTS membership_status;
DROP TYPE IF EXISTS membership_role;
```

### Rolling back 102

Restore from the backup you took in pre-flight. **Do not** try to drop `org_id` columns row-by-row — too many tables, too easy to miss one and leave inconsistent state.

### Rolling back 107

```sql
DO $$ DECLARE t TEXT; BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'employees','payroll_runs','payslips','salary_structures',
    'warning_letters','employee_documents','attendance_daily',
    'crm_contacts','crm_accounts','crm_leads','crm_deals',
    'crm_invoices','crm_estimates','crm_proposals','crm_contracts',
    'audit_logs','tenant_visible_audit'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS imperial_bypass ON %I', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS current_org_id();
DROP FUNCTION IF EXISTS is_imperial_admin();
```

---

## What ships from Phase 0

After all safe migrations apply cleanly:

- 4 new tables: `identities`, `memberships`, `org_invitations`, `org_branding`, `subscription_plans`, `seat_overage_events`, `admin_refund_limits`, `refund_approvals`, `tenant_visible_audit` (9 actually — 8 net new).
- 6 new columns on `org_subscriptions` (billing cycle, card on file, wind-down timestamps).
- 6 new columns on `org_credits` (allowance pools).
- 2 enum types: `membership_role`, `membership_status`.
- 1 enum type: `whitelabel_level`.
- 4 atomic functions: `consume_credits`, `add_credits`, `reset_monthly_allowance`, `record_seat_overage`.
- 12 seeded `subscription_plans` rows with locked pricing.
- All existing `employees` + `crm_users` linked to identities + memberships.

What's **not** done by Phase 0: anything in the app code. Phase 1 starts the code work (shared auth lib in all 3 apps).

---

## Reporting back

After you've run steps 1–3, paste back:
- The output of the post-flight sanity queries for any migrations whose count was non-zero.
- Any `NOTICE` lines from migration 102.
- The `/qa` smoke test result (expect 29/29 GREEN).

If anything failed, paste the error and I'll triage before Phase 1 starts.
