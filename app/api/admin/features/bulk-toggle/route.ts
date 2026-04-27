// §5.3 — Bulk enable/disable a feature for all orgs on a given plan tier.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({
  feature_key: z.string().min(2),
  is_enabled: z.boolean(),
  tier: z.string().min(1),                // e.g. 'pro'
  product: z.enum(['ihrms', 'icrm', 'bundle']).optional(),
  notes: z.string().optional(),
})

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  let q = supabaseAdmin.from('org_subscriptions').select('org_id').eq('tier', parsed.data.tier)
  if (parsed.data.product) q = q.eq('product', parsed.data.product)
  const { data: subs } = await q
  const orgIds = Array.from(new Set((subs ?? []).map((s) => s.org_id)))
  if (orgIds.length === 0) return NextResponse.json({ success: true, applied: 0 })

  const now = new Date().toISOString()
  const rows = orgIds.map((orgId) => ({
    org_id: orgId,
    feature_key: parsed.data.feature_key,
    is_enabled: parsed.data.is_enabled,
    enabled_at: parsed.data.is_enabled ? now : null,
    enabled_by: parsed.data.is_enabled ? admin.adminId : null,
    disabled_at: !parsed.data.is_enabled ? now : null,
    disabled_by: !parsed.data.is_enabled ? admin.adminId : null,
    notes: parsed.data.notes ?? null,
  }))

  const { error } = await supabaseAdmin.from('org_features').upsert(rows, { onConflict: 'org_id,feature_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: parsed.data.is_enabled ? 'feature.bulk_enable' : 'feature.bulk_disable',
    target_type: 'feature_catalog',
    target_id: null,
    payload: { ...parsed.data, applied: orgIds.length },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true, applied: orgIds.length })
}
