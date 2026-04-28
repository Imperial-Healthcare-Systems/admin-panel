# Imperial Admin Console — UAT Checklist

User-acceptance test plan. Run **after** the automated smoke test (`/qa` page) is GREEN. The smoke test only covers read paths; everything below exercises the mutations and browser-only flows.

> Set `NEXTAUTH_URL=http://localhost:3000` for local UAT. Switch back to the production URL only when deploying.

---

## Pre-flight

- [ ] Migration `001_admin_console.sql` applied
- [ ] Migration `002_admin_console_compat.sql` applied
- [ ] Bootstrap admin row exists with `is_platform_admin = TRUE`, role = `super_admin`, linked to org slug `imperial-healthcare-systems` (or whatever `IMPERIAL_ORG_SLUG` is set to)
- [ ] `pnpm install` completed
- [ ] `pnpm dev` running on port 3000
- [ ] At least one row in `organisations`, one row in `org_subscriptions` (any product/tier), and one row in `feature_catalog` (any feature) so the dashboards have something to render

---

## 1. Auth & TOTP enrollment

- [ ] Visit `http://localhost:3000` → redirects to `/login`
- [ ] Enter your admin email → toast "Code sent"
- [ ] Server console shows `[admin-otp] OTP for ...: NNNNNN`
- [ ] Enter that 6-digit OTP → QR code appears on screen
- [ ] Server console shows `[totp/setup] new enrollment for ...: secret_prefix=XXXX…(32 chars)`
- [ ] Scan QR with authenticator app (delete any prior "Imperial Admin" entries first!)
- [ ] Enter the 6-digit code from the app → land on `/dashboard`
- [ ] Topbar shows your name + email; clicking it shows Sign out
- [ ] Refresh `/dashboard` — still logged in (8-hr session)
- [ ] Sign out → redirected to `/login`
- [ ] Sign back in: email + OTP + TOTP (no QR this time, since you're already enrolled)

---

## 2. QA smoke test

- [ ] Visit `/qa`
- [ ] Click **Run smoke test**
- [ ] Status pill shows GREEN
- [ ] All ~25 checks pass
- [ ] If any check fails: read the error, fix, re-run before proceeding

---

## 3. Dashboard (§5.1)

- [ ] Visit `/dashboard`
- [ ] All 6 KPI cards render numbers (no `NaN`, no errors)
- [ ] MRR trend area chart renders 12 months
- [ ] Daily signups bar chart renders for current month
- [ ] "Credits consumed" tile shows a number
- [ ] "Recent admin events" lists at least the most recent action (your login)
- [ ] Click "Refresh" → numbers update
- [ ] Auto-refresh works (wait 60s, watch network tab for `/api/admin/dashboard` re-fetch)

---

## 4. Organisations list + detail (§5.2)

### List view (`/orgs`)

- [ ] Table renders all orgs sorted by MRR desc
- [ ] Search by name filters results
- [ ] Status filter works
- [ ] Tier filter works
- [ ] Health filter works (only after first cron run; otherwise empty is OK)
- [ ] Each row's "Open" button navigates to detail

### Detail view (`/orgs/[id]`)

#### Header
- [ ] Org name, status pill, health pill (if available), MRR, signup date all show

#### Overview tab
- [ ] 4 metric cards: total users, active 30d, credit balance, next billing
- [ ] Alerts list (or "All systems normal")

#### Subscription tab
- [ ] Each subscription card shows tier, seats, amount, period
- [ ] Click "Upgrade / Edit" → prompts for tier, seats, amount → saves → toast "Updated"
- [ ] Click "Suspend" with reason ≥10 chars → toast "Updated"; status changes to suspended
- [ ] Click "Reactivate" → toast "Updated"; status returns to active
- [ ] Plan override card: click "Set override" → prompts → saves; card now shows the override

#### Credits tab
- [ ] Balance, lifetime purchased, lifetime consumed all show
- [ ] Manual adjust: +100 promotional, reason ≥10 chars → toast "New balance: …"
- [ ] Negative adjust (e.g. -50 adjustment, reason ≥10) → balance decreases
- [ ] Negative adjust greater than balance → 400 "Insufficient balance"
- [ ] Reason <10 chars → 400 "Reason required"
- [ ] Transaction history table shows all your adjustments at the top

#### Features tab
- [ ] Feature catalog rows appear, grouped by category
- [ ] Toggle a feature OFF → toast "Disabled"
- [ ] Toggle it ON → toast "Enabled"
- [ ] Verify in DB: `SELECT * FROM org_features WHERE org_id=… AND feature_key=…` shows correct `enabled`, `enabled_at`, `enabled_by`

#### Users tab
- [ ] Both IHRMS employees and ICRM crm_users for this org appear
- [ ] Status pill shows "Active" or "Inactive" correctly
- [ ] Last login time renders or shows "—"

#### Activity tab
- [ ] If `ecosystem_events` has rows for this org, they show; otherwise "No events" is OK
- [ ] Source filter narrows results

#### Impersonate tab
- [ ] Red warning banner is visible
- [ ] Pick a product (IHRMS or ICRM) → user dropdown populates
- [ ] Reason <20 chars → toast error
- [ ] Reason ≥20 chars + select user + click Impersonate → opens new tab with `targetUrl`
- [ ] Verify in DB: `platform_impersonation_log` has a new row with `started_at`, no `ended_at` yet
- [ ] Close the new tab → after a second, `platform_impersonation_log.ended_at` populates (sendBeacon fires)

> Receiver routes (`/api/auth/impersonation-login` on IHRMS / ICRM) must exist for the new tab to actually log you in. Until that's built, the click is still useful — it logs the impersonation row.

---

## 5. Feature catalog (§5.3)

- [ ] Visit `/features`
- [ ] Existing features render grouped by category
- [ ] Click "+ New feature" → modal opens
- [ ] Fill in feature_key, display_name, vendor cost = 0.00002, markup = 5000 → save
- [ ] credits_per_unit auto-computes (0.00002 × 5000 = 0.1 → rounded to 0)
- [ ] Toggle is_active off and on
- [ ] Bulk toggle: pick a feature, tier=pro, enable → toast "Enabled for N orgs"

---

## 6. Credits global (§5.4)

- [ ] Visit `/credits`
- [ ] Outstanding liability shows aggregate balance
- [ ] Top consumers table populates if any debits exist this month
- [ ] Feature usage breakdown populates
- [ ] Bulk grant: amount=10, tier=pro, reason ≥10 chars → toast "Granted to N orgs"
- [ ] Verify in DB: every targeted org has a new `credit_transactions` row with `type='promotional'`, `direction='credit'`

---

## 7. Revenue (§5.5 + §6.4)

- [ ] Visit `/revenue`
- [ ] 8 KPI cards render
- [ ] MRR by product chart renders
- [ ] MRR by tier chart renders
- [ ] Cohort retention table populates
- [ ] GST summary shows month/quarter/year totals
- [ ] Click "Month" CSV export → file downloads, opens in Excel without errors
- [ ] Quarter and Year exports also work

---

## 8. Vendor costs (§5.6)

- [ ] Visit `/vendors`
- [ ] 4 KPI cards render
- [ ] Manually add a row: vendor=openai, period=this month's first day, USD=12, INR=1000 → toast "Saved"
- [ ] Row appears in the "Last 6 months" table
- [ ] If `OPENAI_API_KEY` is set with org admin scope: click "Pull OpenAI usage" → toast with $ amount; otherwise toast shows "OpenAI usage API unavailable" — that's expected for non-admin keys

---

## 9. Customer health (§5.7 + §6.6)

- [ ] Trigger the cron manually first:
      `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/health/snapshot`
- [ ] Returns `{"processed": N}` where N is your org count
- [ ] Visit `/health`
- [ ] Each org appears with a score, risk pill, and triggers
- [ ] Pills render: Healthy / At risk / Critical counts at the top
- [ ] "Email CSM" button generates a `mailto:` link
- [ ] Run the cron again → same orgs, possibly updated scores (idempotent UPSERT)

---

## 10. Refunds (§5.8 + §6.5)

> Requires `CASHFREE_APP_ID` + `CASHFREE_SECRET_KEY` in `.env.local`. If not set, you can still verify the UI list but skip the actual refund click.

- [ ] Visit `/refunds`
- [ ] Eligible invoices (paid, ≤90 days, has cashfree_order_id) show
- [ ] Click Refund → modal opens, amount pre-fills with invoice total
- [ ] Reason <10 chars → toast error
- [ ] Reason ≥10 chars, amount > total → toast "Cannot exceed invoice total"
- [ ] (Cashfree configured) Submit → toast "Refund submitted to Cashfree"
- [ ] Invoice status changes to `refunded` or `partially_refunded`
- [ ] `credit_transactions` has a new row with `type='refund'`, `reference_id=invoice_id`

---

## 11. Audit log (§5.9)

- [ ] Visit `/audit`
- [ ] All your prior mutations appear in chronological order
- [ ] Filters work: admin id, action (e.g. `credits.adjust`), org id, date range
- [ ] Each row's "view" reveals payload JSON
- [ ] Click "Export CSV" → file downloads, opens cleanly

---

## 12. Settings

- [ ] Visit `/settings`
- [ ] Your session info shows
- [ ] Current admins list shows you and any others with `is_platform_admin=true`
- [ ] Click Reset TOTP on yourself → confirm → toast "TOTP reset"
- [ ] Sign out → re-login → QR appears again (you re-enroll)
- [ ] If you have super_admin role: grant another email → toast "Granted" (target email must already exist in `employees` and live in the Imperial org)
- [ ] Revoke same email → toast "Revoked"

---

## 13. Cron diagnostics endpoint (for the May 5 routine)

- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/admin/cron-diagnostics`
- [ ] Returns JSON with `cron_health`, `latest_distribution`, `top_critical`, `cron_failures_7d`
- [ ] Without bearer or with wrong bearer → 401 Unauthorized

---

## 14. Security regression checks

- [ ] Visit `/dashboard` in an incognito window → bounces to `/login`
- [ ] Try `/api/admin/orgs` without a session → 401
- [ ] Try `/api/admin/orgs/[id]/credits/adjust` POST without a session → 401
- [ ] Try `/api/cron/health/snapshot` without bearer → 401
- [ ] Sign in with an email that exists in `employees` but `is_platform_admin=FALSE` → after OTP, login fails (`Invalid credentials`)
- [ ] Sign in with an email NOT in `employees` → email step succeeds (privacy-preserving) but OTP step never reaches `signIn` because there's no employee record

---

## 15. Performance & UX sanity

- [ ] Dashboard load < 2s on a warm cache (with ~10 orgs, 100s of subs)
- [ ] No console errors in browser DevTools on any page
- [ ] No 500s in the dev-server terminal across the full UAT run
- [ ] Toast notifications appear top-right and dismiss after a few seconds
- [ ] Sidebar collapses/expands gracefully on viewport resize (768px breakpoint)
- [ ] Dark mode is the only theme — no light flash on first paint

---

## When you're done

If every box is ticked:
1. Comment out the diagnostic logs in `lib/totp.ts` (`[totp] verify failed …`) and `app/api/auth/totp/setup/route.ts` (`[totp/setup] …`).
2. Bump `VERIFY_WINDOW` in `lib/totp.ts` back from 4 to 1 (tightens replay window).
3. Push to deployment.
4. Tell me and I'll create the May 5 verification routine.

If something fails:
- Capture the failing check name + error from `/qa`
- Capture the relevant terminal log
- Paste both — I'll fix it.
