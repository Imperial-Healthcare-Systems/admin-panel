import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(_req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]
  const { data: snapshots } = await supabaseAdmin
    .from('org_health_snapshots')
    .select('org_id,health_score,risk_level,factors,snapshot_date')
    .gte('snapshot_date', sevenDaysAgo)
    .order('snapshot_date', { ascending: false })

  // Latest per org
  const latest = new Map<string, any>()
  for (const s of snapshots ?? []) if (!latest.has(s.org_id)) latest.set(s.org_id, s)

  const orgIds = Array.from(latest.keys())
  const { data: orgs } = orgIds.length
    ? await supabaseAdmin.from('organisations').select('id,name,billing_email,signup_at').in('id', orgIds)
    : { data: [] as Array<any> }

  const { data: subs } = orgIds.length
    ? await supabaseAdmin.from('org_subscriptions').select('org_id,status,next_billing_date').in('org_id', orgIds)
    : { data: [] as Array<any> }
  const subByOrg = new Map<string, any>()
  for (const s of subs ?? []) if (!subByOrg.has(s.org_id)) subByOrg.set(s.org_id, s)

  const rows = (orgs ?? []).map((o) => {
    const h = latest.get(o.id)
    const triggers: string[] = []
    if ((h?.factors?.active_users ?? 0) === 0) triggers.push('No active users')
    if ((h?.factors?.events_30d ?? 0) === 0) triggers.push('No activity in 30 days')
    if (Number(h?.factors?.credit_balance ?? 0) === 0) triggers.push('Credit balance = 0')
    const sub = subByOrg.get(o.id)
    if (sub?.status === 'past_due') triggers.push('Subscription past due')
    if (sub?.status === 'suspended') triggers.push('Subscription suspended')
    return {
      org_id: o.id,
      name: o.name,
      billing_email: o.billing_email,
      health_score: h?.health_score ?? null,
      risk_level: h?.risk_level ?? null,
      factors: h?.factors ?? {},
      next_billing_date: sub?.next_billing_date ?? null,
      triggers,
    }
  })

  rows.sort((a, b) => (a.health_score ?? 100) - (b.health_score ?? 100))
  return NextResponse.json({ rows })
}
