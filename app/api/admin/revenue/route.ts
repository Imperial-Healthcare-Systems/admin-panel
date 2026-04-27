// §6.4 — Revenue analytics. Spec implementation, extended with cohorts + GST.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: subs } = await supabaseAdmin
    .from('org_subscriptions')
    .select('org_id,product,tier,status,amount_per_month,seats,created_at,cancelled_at')
    .in('status', ['active', 'past_due'])

  const mrrByProduct: Record<string, number> = {}
  const mrrByTier: Record<string, number> = {}
  let totalMRR = 0
  let activeCount = 0
  for (const s of subs ?? []) {
    if (s.status === 'active') {
      const amt = Number(s.amount_per_month ?? 0)
      mrrByProduct[s.product] = (mrrByProduct[s.product] ?? 0) + amt
      mrrByTier[s.tier] = (mrrByTier[s.tier] ?? 0) + amt
      totalMRR += amt
      activeCount++
    }
  }

  const { count: trialCount } = await supabaseAdmin
    .from('org_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'trial')

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const { count: churned } = await supabaseAdmin
    .from('org_subscriptions').select('*', { count: 'exact', head: true })
    .eq('status', 'cancelled').gte('cancelled_at', thirtyDaysAgo.toISOString())

  // Cohort retention — orgs grouped by signup month, % still active
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11)
  twelveMonthsAgo.setDate(1)
  const { data: signups } = await supabaseAdmin
    .from('organisations')
    .select('id,signup_at')
    .gte('signup_at', twelveMonthsAgo.toISOString())

  const cohortIds = new Map<string, string[]>()
  for (const o of signups ?? []) {
    const k = new Date(o.signup_at).toISOString().slice(0, 7)
    if (!cohortIds.has(k)) cohortIds.set(k, [])
    cohortIds.get(k)!.push(o.id)
  }
  const allOrgIds = Array.from(cohortIds.values()).flat()
  const { data: activeSubs } = allOrgIds.length
    ? await supabaseAdmin.from('org_subscriptions').select('org_id').in('org_id', allOrgIds).eq('status', 'active')
    : { data: [] as Array<{ org_id: string }> }
  const activeOrgSet = new Set((activeSubs ?? []).map((s) => s.org_id))
  const cohorts = Array.from(cohortIds.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, ids]) => ({
      month,
      cohort: ids.length,
      retained: ids.filter((id) => activeOrgSet.has(id)).length,
    }))

  // GST summary — assume tax stored on platform_invoices.tax for paid invoices
  const monthStart = new Date(); monthStart.setDate(1)
  const quarterStart = new Date()
  quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3, 1)
  const yearStart = new Date(new Date().getFullYear(), 0, 1)

  const { data: invs } = await supabaseAdmin
    .from('platform_invoices')
    .select('total,tax,paid_at,status')
    .eq('status', 'paid')
    .gte('paid_at', yearStart.toISOString())

  const sumTax = (since: Date) =>
    (invs ?? [])
      .filter((i) => i.paid_at && new Date(i.paid_at) >= since)
      .reduce((acc, i) => acc + Number(i.tax ?? 0), 0)
  const sumTotal = (since: Date) =>
    (invs ?? [])
      .filter((i) => i.paid_at && new Date(i.paid_at) >= since)
      .reduce((acc, i) => acc + Number(i.total ?? 0), 0)

  const gst = {
    month: { tax: sumTax(monthStart), total: sumTotal(monthStart) },
    quarter: { tax: sumTax(quarterStart), total: sumTotal(quarterStart) },
    year: { tax: sumTax(yearStart), total: sumTotal(yearStart) },
  }

  const churnRate = activeCount > 0 ? (churned ?? 0) / activeCount : 0
  const avgMrr = activeCount > 0 ? totalMRR / activeCount : 0
  const ltv = churnRate > 0 ? avgMrr / churnRate : null

  return NextResponse.json({
    totalMRR,
    totalARR: totalMRR * 12,
    activeCount,
    trialCount: trialCount ?? 0,
    churned30d: churned ?? 0,
    mrrByProduct,
    mrrByTier,
    churnRate,
    avgMrr,
    ltv,
    cohorts,
    gst,
  })
}
