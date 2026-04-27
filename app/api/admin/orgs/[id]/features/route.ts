// §6.1 — Toggle feature for org. Spec implementation, verbatim.
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
    .select('feature_key,display_name,description,category,vendor_name,credits_per_unit,unit_description,default_enabled,is_active')
    .eq('is_active', true)
    .order('category', { ascending: true })

  const { data: orgFeatures } = await supabaseAdmin
    .from('org_features')
    .select('feature_key,is_enabled,custom_credits_per_unit,notes,enabled_at,disabled_at')
    .eq('org_id', orgId)

  const enabledMap = new Map(orgFeatures?.map((f) => [f.feature_key, f]) ?? [])
  const merged = (catalog ?? []).map((c) => ({
    ...c,
    is_enabled: enabledMap.get(c.feature_key)?.is_enabled ?? c.default_enabled ?? false,
    custom_credits_per_unit: enabledMap.get(c.feature_key)?.custom_credits_per_unit ?? null,
    notes: enabledMap.get(c.feature_key)?.notes ?? null,
  }))

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
      is_enabled,
      enabled_at: is_enabled ? now : null,
      enabled_by: is_enabled ? adminId : null,
      disabled_at: !is_enabled ? now : null,
      disabled_by: !is_enabled ? adminId : null,
      custom_credits_per_unit: custom_credits_per_unit ?? null,
      notes,
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
