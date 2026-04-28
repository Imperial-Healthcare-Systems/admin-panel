// QA smoke test for the Imperial Admin Console.
// Hits every read-only data path the UI uses + every spec read route, and
// reports per-check status. Mutations are NOT exercised — those are covered
// by the manual UAT checklist (see SETUP.md / UAT.md).
//
// Auth: requires a logged-in platform admin. Run by visiting
//   GET /api/admin/qa/smoke-test
// while signed in. The dashboard "QA self-test" link points here.
//
// Each check returns: { name, ok, ms, error?, sample? }
// The endpoint never throws — a check that crashes is reported with ok=false.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

type Check = {
  name: string
  ok: boolean
  ms: number
  error?: string
  sample?: unknown
}

async function run(name: string, fn: () => Promise<unknown>): Promise<Check> {
  const t0 = Date.now()
  try {
    const sample = await fn()
    return { name, ok: true, ms: Date.now() - t0, sample }
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: (e as Error).message }
  }
}

function expectOk<T>(label: string, result: { error: { message: string } | null; data: T }): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

export async function GET(_req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }

  const checks: Check[] = []

  // ---- Schema sanity: every table we query exists with expected columns -----
  checks.push(
    await run('schema.organisations', async () => {
      const r = await supabaseAdmin
        .from('organisations')
        .select('id,name,slug,billing_email,gstin,address,status,signup_at')
        .limit(1)
      return expectOk('organisations', r)
    }),
  )
  checks.push(
    await run('schema.org_subscriptions', async () => {
      const r = await supabaseAdmin
        .from('org_subscriptions')
        .select('id,org_id,product,tier,seats,amount_per_month,status,next_billing_date,cancelled_at')
        .limit(1)
      return expectOk('org_subscriptions', r)
    }),
  )
  checks.push(
    await run('schema.platform_invoices', async () => {
      const r = await supabaseAdmin
        .from('platform_invoices')
        .select('id,org_id,invoice_number,total,tax,status,paid_at,cashfree_order_id')
        .limit(1)
      return expectOk('platform_invoices', r)
    }),
  )
  checks.push(
    await run('schema.ecosystem_events (actor_id + 002 additions)', async () => {
      // ICRM's existing column is `actor_id`. Migration 002 added `actor_user_id`
      // and `actor_type` for spec parity. We probe both so a regression on either
      // side fails loudly here instead of in a per-org route.
      const r = await supabaseAdmin
        .from('ecosystem_events')
        .select('id,org_id,source_platform,event_type,actor_id,actor_user_id,actor_type,entity_id,payload,created_at')
        .limit(1)
      return expectOk('ecosystem_events', r)
    }),
  )
  checks.push(
    await run('schema.feature_catalog (incl. migration-002 columns)', async () => {
      const r = await supabaseAdmin
        .from('feature_catalog')
        .select(
          'feature_key,display_name,credit_cost,is_active,preferred_provider,category,vendor_name,vendor_cost_per_unit,markup_multiplier,unit_description,default_enabled',
        )
        .limit(1)
      return expectOk('feature_catalog', r)
    }),
  )
  checks.push(
    await run('schema.org_features (incl. migration-002 columns)', async () => {
      const r = await supabaseAdmin
        .from('org_features')
        .select('org_id,feature_key,enabled,custom_credits_per_unit,notes,enabled_at,enabled_by,disabled_at,disabled_by')
        .limit(1)
      return expectOk('org_features', r)
    }),
  )
  checks.push(
    await run('schema.org_credits (incl. lifetime_consumed)', async () => {
      const r = await supabaseAdmin
        .from('org_credits')
        .select('org_id,balance,total_purchased,lifetime_consumed,updated_at')
        .limit(1)
      return expectOk('org_credits', r)
    }),
  )
  checks.push(
    await run('schema.credit_transactions (incl. migration-002 columns)', async () => {
      const r = await supabaseAdmin
        .from('credit_transactions')
        .select('id,org_id,user_id,feature_key,amount,direction,type,balance_after,reference_type,reference_id,description,notes,created_by,created_at')
        .limit(1)
      return expectOk('credit_transactions', r)
    }),
  )
  checks.push(
    await run('schema.employees (full_name + status + TOTP cols)', async () => {
      const r = await supabaseAdmin
        .from('employees')
        .select('id,email,full_name,role,status,is_platform_admin,totp_enabled,totp_secret,org_id')
        .eq('id', admin.adminId)
        .single()
      return expectOk('employees', r)
    }),
  )
  checks.push(
    await run('schema.crm_users (full_name + is_active)', async () => {
      const r = await supabaseAdmin
        .from('crm_users')
        .select('id,email,full_name,role,is_active,last_login_at,org_id')
        .limit(1)
      return expectOk('crm_users', r)
    }),
  )
  checks.push(
    await run('schema.platform_admin_log + impersonation_log', async () => {
      const a = await supabaseAdmin
        .from('platform_admin_log')
        .select('id,admin_id,action,target_type,target_id,payload,ip_address,created_at')
        .limit(1)
      expectOk('platform_admin_log', a)
      const b = await supabaseAdmin
        .from('platform_impersonation_log')
        .select('id,admin_id,impersonated_org_id,impersonated_user_id,reason,started_at,ended_at,actions_taken')
        .limit(1)
      return expectOk('platform_impersonation_log', b)
    }),
  )
  checks.push(
    await run('schema.platform_vendor_costs + org_health_snapshots + org_plan_overrides', async () => {
      const v = await supabaseAdmin.from('platform_vendor_costs').select('vendor,period_month,amount_inr').limit(1)
      expectOk('platform_vendor_costs', v)
      const h = await supabaseAdmin.from('org_health_snapshots').select('org_id,snapshot_date,health_score,risk_level,factors').limit(1)
      expectOk('org_health_snapshots', h)
      const p = await supabaseAdmin.from('org_plan_overrides').select('org_id,custom_amount_per_month,reason,effective_from').limit(1)
      return expectOk('org_plan_overrides', p)
    }),
  )

  // ---- Pick a sample org to exercise the per-org spec routes -----
  const { data: sampleOrg } = await supabaseAdmin
    .from('organisations')
    .select('id,slug,name')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const orgId = sampleOrg?.id ?? null
  checks.push({
    name: 'sample.organisation',
    ok: !!orgId,
    ms: 0,
    sample: sampleOrg,
    error: orgId ? undefined : 'No organisation row in DB — create one before running per-org checks',
  })

  // ---- Internal HTTP fetches against this server's own admin endpoints -----
  // We forward the request's session cookie so requireAdmin passes.
  const proto = process.env.NEXTAUTH_URL?.startsWith('https') ? 'https' : 'http'
  const host = _req.headers.get('host') ?? 'localhost:3000'
  const base = `${proto}://${host}`
  const cookie = _req.headers.get('cookie') ?? ''

  async function hit(path: string, init?: RequestInit) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { cookie, ...(init?.headers ?? {}) },
    })
    const ct = res.headers.get('content-type') ?? ''
    const body = ct.includes('application/json') ? await res.json() : await res.text()
    if (!res.ok) throw new Error(`${path} → ${res.status}: ${typeof body === 'string' ? body : body?.error ?? JSON.stringify(body).slice(0, 120)}`)
    return Array.isArray(body) ? { rows: body.length } : { keys: typeof body === 'object' ? Object.keys(body ?? {}).slice(0, 6) : 'text' }
  }

  checks.push(await run('GET /api/admin/dashboard', () => hit('/api/admin/dashboard')))
  checks.push(await run('GET /api/admin/orgs', () => hit('/api/admin/orgs')))
  checks.push(await run('GET /api/admin/features', () => hit('/api/admin/features')))
  checks.push(await run('GET /api/admin/credits', () => hit('/api/admin/credits')))
  checks.push(await run('GET /api/admin/revenue', () => hit('/api/admin/revenue')))
  checks.push(await run('GET /api/admin/vendors', () => hit('/api/admin/vendors')))
  checks.push(await run('GET /api/admin/health', () => hit('/api/admin/health')))
  checks.push(await run('GET /api/admin/refunds', () => hit('/api/admin/refunds')))
  checks.push(await run('GET /api/admin/audit', () => hit('/api/admin/audit')))
  checks.push(await run('GET /api/admin/settings/admins', () => hit('/api/admin/settings/admins')))

  if (orgId) {
    checks.push(await run(`GET /api/admin/orgs/${orgId}`, () => hit(`/api/admin/orgs/${orgId}`)))
    checks.push(await run(`GET /api/admin/orgs/[id]/features`, () => hit(`/api/admin/orgs/${orgId}/features`)))
    checks.push(await run(`GET /api/admin/orgs/[id]/credits`, () => hit(`/api/admin/orgs/${orgId}/credits`)))
    checks.push(await run(`GET /api/admin/orgs/[id]/users`, () => hit(`/api/admin/orgs/${orgId}/users`)))
    checks.push(await run(`GET /api/admin/orgs/[id]/activity`, () => hit(`/api/admin/orgs/${orgId}/activity`)))
  }

  // ---- Cron diagnostics (auth via CRON_SECRET, separate from session) -----
  checks.push(
    await run('GET /api/admin/cron-diagnostics (CRON_SECRET bearer)', async () => {
      if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET not set in env')
      const res = await fetch(`${base}/api/admin/cron-diagnostics`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = await res.json()
      return { distribution: json.latest_distribution, missing_days: json.cron_health?.missing_days?.length ?? 0 }
    }),
  )

  // ---- Aggregate -----
  const passed = checks.filter((c) => c.ok).length
  const failed = checks.length - passed

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: 'qa.smoke_test',
    target_type: 'self',
    target_id: admin.adminId,
    payload: { passed, failed, total: checks.length },
  })

  return NextResponse.json({
    summary: { total: checks.length, passed, failed, ok: failed === 0 },
    checks,
    generated_at: new Date().toISOString(),
    admin: admin.email,
  })
}
