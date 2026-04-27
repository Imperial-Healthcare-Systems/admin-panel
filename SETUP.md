# Imperial Admin Console — Setup & Deploy

Internal control plane for Imperial Healthcare Systems Pvt Ltd. Built per `Admin_Console_v1.0_FINAL.pdf`. Domain: **imperialhealthcare.cloud** (Decision Gate #1, apex).

> CONFIDENTIAL — IMPERIAL TEAM ONLY

---

## 1. Prerequisites (bible §2)

- IHRMS v2.2 deployed at `imperialhrms.com`.
- ICRM v1.2 deployed at `imperialcrm.cloud`.
- Shared Supabase project (same DB powers all three apps).
- DNS for `imperialhealthcare.cloud` is manageable.
- At least one Imperial employee row exists with `role='super_admin'`.

## 2. Database migration

The repo is wired to author the missing prerequisite tables (`organisations`, `org_subscriptions`, `platform_invoices`, `ecosystem_events`) PLUS the §2.1 admin-console tables PLUS the TOTP columns (Decision Gate #2) in a single idempotent migration:

```bash
# Apply against the shared Supabase project's SQL editor:
supabase/migrations/001_admin_console.sql
```

Then grant yourself access:

```sql
UPDATE employees
SET is_platform_admin = TRUE
WHERE email = 'your-email@imperialhealthcare.cloud';
```

You will enroll TOTP automatically on your first login via the QR step.

## 3. Environment

Copy `.env.local.example` → `.env.local` and fill in values. Generate the per-secret keys:

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET (different from IHRMS / ICRM)
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 64      # IMPERSONATION_SECRET (set the SAME value in IHRMS + ICRM)
```

Required:

| Var | Source |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Same as IHRMS/ICRM |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32`, **must be different** |
| `NEXTAUTH_URL` | `https://imperialhealthcare.cloud` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `IMPERSONATION_SECRET` | `openssl rand -hex 64` (paste same value into IHRMS + ICRM env) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Resend creds for the imperialhealthcare.cloud domain |
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` | Cashfree dashboard (read-only key with refund permission is sufficient) |
| `OPENAI_API_KEY` | Used only by `/api/admin/vendors/openai-pull` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis — used for rate limiting (§8) |

Optional cross-app links (default to public domains):
`IHRMS_BASE_URL`, `ICRM_BASE_URL`, `IMPERIAL_ORG_SLUG`.

## 4. Local dev

```bash
npm install
npm run dev
# open http://localhost:3000
```

First login flow:
1. Enter your Imperial email → OTP emailed (or printed in server console if SMTP not configured).
2. Enter OTP → QR shown for authenticator setup.
3. Scan with Google Authenticator / 1Password / Authy.
4. Enter the 6-digit TOTP → enrolled + signed in.

Subsequent logins skip step 3.

## 5. Cross-app integration (impersonation receivers)

§6.3 issues an HS256 JWT and redirects to:
- `${IHRMS_BASE_URL}/api/auth/impersonation-login?token=…`
- `${ICRM_BASE_URL}/api/auth/impersonation-login?token=…`

Both IHRMS and ICRM must implement `/api/auth/impersonation-login` to verify the token using `IMPERSONATION_SECRET` and short-circuit their NextAuth flow with `isImpersonation: true`. Token claims:

```json
{
  "sub": "<target user id>",
  "email": "<target user email>",
  "orgId": "<org id>",
  "impersonator": "<admin id>",
  "logId": "<row id in platform_impersonation_log>",
  "isImpersonation": true,
  "exp": "<+1h>"
}
```

Receiver apps should display a persistent banner while `isImpersonation` is true and call `/api/admin/orgs/[id]/impersonate/end` (on Admin Console) when the tab closes — the Admin Console UI does this automatically via `beforeunload` + `sendBeacon`.

## 6. Deploy (Phase 5)

1. **Vercel project**: connect this folder as a new project, separate from IHRMS/ICRM.
2. **Env vars**: paste every key from `.env.local` into Vercel project settings.
3. **DNS**: point `imperialhealthcare.cloud` (apex, Gate #1 chosen) to Vercel.
4. **Cron**: `vercel.json` already declares the daily health-snapshot cron at `21:30 UTC = 03:00 IST`.
5. **IP allowlist**: skipped — Gate #1 chose A (apex), not C (VPN-only). If you ever flip to C, add Vercel Edge Config restrictions.

## 7. Module map

| Path | Bible section |
| --- | --- |
| `/dashboard` | §5.1 |
| `/orgs` (+ 7-tab detail) | §5.2 |
| `/features` | §5.3 |
| `/credits` | §5.4 |
| `/revenue` (with GST CSV) | §5.5 |
| `/vendors` | §5.6 |
| `/health` | §5.7 |
| `/refunds` | §5.8 |
| `/audit` | §5.9 |
| `/settings` | platform admin management + TOTP reset |

API spec routes:

| Route | Bible |
| --- | --- |
| `POST /api/admin/orgs/[id]/features` | §6.1 |
| `POST /api/admin/orgs/[id]/credits/adjust` | §6.2 |
| `POST /api/admin/orgs/[id]/impersonate` + `/end` | §6.3 |
| `GET /api/admin/revenue` | §6.4 |
| `POST /api/admin/refunds/create` | §6.5 |
| `GET/POST /api/cron/health/snapshot` | §6.6 |

## 8. Security guarantees (§8)

- Every mutation route validates session via `getServerSession` and writes to `platform_admin_log` with `admin_id + action + payload + ip`.
- Impersonation has its own table (`platform_impersonation_log`) with reason (≥20 chars), 1-hour JWT, and explicit end-of-session row update.
- Rate limit: 60 req/min per admin on `/api/admin/**`; 10 req/min on `/api/auth/**` (Upstash). Falls open if Upstash is unset (dev only).
- 8-hour sessions, JWT strategy.
- TOTP enrollment is mandatory — `is_platform_admin && !totp_enabled` cannot complete login.
- `SUPABASE_SERVICE_ROLE_KEY` is referenced only inside `lib/supabase.ts` (`supabaseAdmin`) and never imported from a `'use client'` module.
- Security headers (`X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`) added in `next.config.ts`.

## 9. Decisions captured at build time

- **Gate #1 — Domain**: `imperialhealthcare.cloud` (apex). Drives `NEXTAUTH_URL`, no IP allowlist.
- **Gate #2 — 2FA**: TOTP mandatory. Implemented via `otplib` + QR enrollment; columns `totp_secret`, `totp_enabled`, `totp_enrolled_at` on `employees`.

## 10. Known follow-ups

- The four prerequisite tables (`organisations`, `org_subscriptions`, `platform_invoices`, `ecosystem_events`) are authored in `001_admin_console.sql` because they were not present in the local IHRMS/ICRM SQL files. If your live Supabase already has them under a different schema, drop the duplicates and adapt FKs before running.
- `/api/admin/vendors/openai-pull` uses OpenAI's organization costs endpoint — requires an admin-key. Fallback to manual entry if the call returns 502.
- Health cron currently uses `ecosystem_events` count as the engagement proxy. Tighten by ingesting per-product login events from IHRMS/ICRM.
