// §5.4 — Global credits view: outstanding liability, top consumers, feature usage breakdown.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(_req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  // Outstanding liability = sum of balances across all orgs
  const { data: wallets } = await supabaseAdmin.from('org_credits').select('org_id,balance')
  const totalOutstanding = (wallets ?? []).reduce((acc, w) => acc + Number(w.balance ?? 0), 0)

  const monthStart = new Date()
  monthStart.setDate(1)

  // Consumption by org (this month)
  const { data: consumption } = await supabaseAdmin
    .from('credit_transactions')
    .select('org_id,amount,reference_type')
    .lt('amount', 0)
    .gte('created_at', monthStart.toISOString())

  const byOrg = new Map<string, number>()
  const byFeature = new Map<string, number>()
  for (const t of consumption ?? []) {
    const amt = Math.abs(Number(t.amount ?? 0))
    byOrg.set(t.org_id, (byOrg.get(t.org_id) ?? 0) + amt)
    const ref = t.reference_type ?? 'unknown'
    byFeature.set(ref, (byFeature.get(ref) ?? 0) + amt)
  }

  // Resolve top org names
  const topOrgIds = Array.from(byOrg.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id)
  const { data: orgs } = topOrgIds.length
    ? await supabaseAdmin.from('organisations').select('id,name').in('id', topOrgIds)
    : { data: [] as Array<{ id: string; name: string }> }
  const nameById = new Map((orgs ?? []).map((o) => [o.id, o.name]))

  const topConsumers = topOrgIds.map((id) => ({
    org_id: id,
    name: nameById.get(id) ?? id,
    consumed: byOrg.get(id) ?? 0,
  }))

  const byFeatureArr = Array.from(byFeature.entries())
    .map(([reference_type, amount]) => ({ reference_type, amount }))
    .sort((a, b) => b.amount - a.amount)

  return NextResponse.json({
    totalOutstanding,
    topConsumers,
    byFeature: byFeatureArr,
  })
}
