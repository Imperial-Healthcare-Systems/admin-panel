import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { id: orgId } = await params

  const { data: org, error } = await supabaseAdmin
    .from('organisations')
    .select(`
      id,name,slug,billing_email,gstin,address,status,signup_at,
      subscriptions:org_subscriptions(*),
      credits:org_credits(*),
      plan_override:org_plan_overrides(*)
    `)
    .eq('id', orgId)
    .single()

  if (error || !org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Active employees (used as "users" + active-30d count)
  const { count: totalUsers } = await supabaseAdmin
    .from('employees').select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
  const { count: activeUsers } = await supabaseAdmin
    .from('employees').select('*', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('status', 'active')

  // Latest health
  const { data: health } = await supabaseAdmin
    .from('org_health_snapshots')
    .select('health_score,risk_level,factors,snapshot_date')
    .eq('org_id', orgId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    org,
    stats: { totalUsers: totalUsers ?? 0, activeUsers: activeUsers ?? 0 },
    health: health ?? null,
  })
}
