// §6.1 — Toggle feature for org. Adapted to ICRM live schema:
//  * org_features uses `enabled` (not is_enabled). Migration 002 adds the
//    audit columns (enabled_at/by, disabled_at/by, custom_credits_per_unit, notes).
//  * feature_catalog uses `credit_cost` for the credit cost. Migration 002 adds
//    the admin-side metadata (category, vendor_name, vendor_cost_per_unit, etc.).
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { adminLimiter, checkLimit } from '@/lib/rate-limit'
import { ipFromRequest } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: orgId } = await params

  const { data: catalog } = await supabaseAdmin
    .from('feature_catalog')
    .select(
      'feature_key,display_name,description,category,vendor_name,credit_cost,unit_description,default_enabled,is_active,preferred_provider',
    )
    .eq('is_active', true)
    .order('category', { ascending: true })

  const { data: orgFeatures } = await supabaseAdmin
    .from('org_features')
    .select('feature_key,enabled,custom_credits_per_unit,notes,enabled_at,disabled_at')
    .eq('org_id', orgId)

  const enabledMap = new Map(orgFeatures?.map((f) => [f.feature_key, f]) ?? [])
  const merged = (catalog ?? []).map((c) => {
    const ovr = enabledMap.get(c.feature_key)
    return {
      ...c,
      // Expose `is_enabled` to the UI (renamed for spec consistency); fall back
      // to default_enabled when no per-org override row exists.
      is_enabled: ovr?.enabled ?? c.default_enabled ?? false,
      // Spec-name alias for UI: credit_cost → credits_per_unit display.
      credits_per_unit: c.credit_cost,
      custom_credits_per_unit: ovr?.custom_credits_per_unit ?? null,
      notes: ovr?.notes ?? null,
    }
  })

  return NextResponse.json({ features: merged })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orgId } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminId = (session.user as { id: string }).id

  const limit = await checkLimit(adminLimiter, `feature:${adminId}`)
  if (!limit.ok) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  const { feature_key, is_enabled, custom_credits_per_unit, notes } = await req.json()
  if (!feature_key || typeof is_enabled !== 'boolean') {
    return NextResponse.json({ error: 'feature_key + is_enabled required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('org_features').upsert(
    {
      org_id: orgId,
      feature_key,
      enabled: is_enabled,
      enabled_at: is_enabled ? now : null,
      enabled_by: is_enabled ? adminId : null,
      disabled_at: !is_enabled ? now : null,
      disabled_by: !is_enabled ? adminId : null,
      custom_credits_per_unit: custom_credits_per_unit ?? null,
      notes: notes ?? null,
    },
    { onConflict: 'org_id,feature_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: adminId,
    action: is_enabled ? 'feature.enable' : 'feature.disable',
    target_type: 'org_feature',
    target_id: orgId,
    payload: { feature_key, is_enabled, custom_credits_per_unit, notes },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true })
}
