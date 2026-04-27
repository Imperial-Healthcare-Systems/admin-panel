// §5.1 — Global Dashboard data feed.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { adminLimiter, checkLimit } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  let admin
  try {
    admin = await requireAdmin()
  } catch (res) {
    return res as NextResponse
  }

  const limit = await checkLimit(adminLimiter, `dashboard:${admin.adminId}`)
  if (!limit.ok) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  // ---- KPIs ----
  const { data: subs } = await supabaseAdmin
    .from('org_subscriptions')
    .select('status,amount_per_month')

  let totalMRR = 0
  let activeCount = 0
  let trialCount = 0
  for (const s of subs ?? []) {
    if (s.status === 'active') {
      totalMRR += Number(s.amount_per_month ?? 0)
      activeCount++
    } else if (s.status === 'trial') {
      trialCount++
    }
  }

  // At-risk: most recent snapshot per org with risk_level in (at_risk, critical).
  const today = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]
  const { data: recentHealth } = await supabaseAdmin
    .from('org_health_snapshots')
    .select('org_id,risk_level,snapshot_date')
    .gte('snapshot_date', sevenDaysAgo)
    .order('snapshot_date', { ascending: false })

  const latestRiskByOrg = new Map<string, string>()
  for (const row of recentHealth ?? []) {
    if (!latestRiskByOrg.has(row.org_id)) latestRiskByOrg.set(row.org_id, row.risk_level)
  }
  let atRiskCount = 0
  for (const r of latestRiskByOrg.values()) {
    if (r === 'at_risk' || r === 'critical') atRiskCount++
  }

  // Vendor spend this month
  const monthStart = new Date()
  monthStart.setDate(1)
  const monthStartISO = monthStart.toISOString().split('T')[0]
  const { data: vendorRows } = await supabaseAdmin
    .from('platform_vendor_costs')
    .select('amount_inr,period_month')
    .gte('period_month', monthStartISO)
  const vendorSpendMonth = (vendorRows ?? []).reduce((acc, r) => acc + Number(r.amount_inr ?? 0), 0)

  // ---- MRR trend (last 12 months) ----
  // Approximate: bucket active subscriptions by created_at month and accumulate.
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11)
  twelveMonthsAgo.setDate(1)
  const { data: trendSubs } = await supabaseAdmin
    .from('org_subscriptions')
    .select('amount_per_month,status,created_at,cancelled_at')
    .gte('created_at', twelveMonthsAgo.toISOString())

  const mrrTrend: { month: string; mrr: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    d.setDate(1)
    const key = d.toISOString().slice(0, 7)
    let mrr = 0
    for (const s of trendSubs ?? []) {
      const cAt = new Date(s.created_at).toISOString().slice(0, 7)
      const cancelled = s.cancelled_at ? new Date(s.cancelled_at).toISOString().slice(0, 7) : null
      if (cAt <= key && (!cancelled || cancelled > key) && s.status !== 'cancelled') {
        mrr += Number(s.amount_per_month ?? 0)
      }
    }
    mrrTrend.push({ month: key, mrr })
  }

  // ---- Daily signups this month ----
  const { data: signupRows } = await supabaseAdmin
    .from('organisations')
    .select('signup_at')
    .gte('signup_at', monthStart.toISOString())
  const signupsByDay = new Map<string, number>()
  for (const row of signupRows ?? []) {
    const day = new Date(row.signup_at).toISOString().slice(0, 10)
    signupsByDay.set(day, (signupsByDay.get(day) ?? 0) + 1)
  }
  const dailySignups: { day: string; count: number }[] = []
  const cur = new Date(monthStart)
  while (cur <= new Date()) {
    const k = cur.toISOString().slice(0, 10)
    dailySignups.push({ day: k, count: signupsByDay.get(k) ?? 0 })
    cur.setDate(cur.getDate() + 1)
  }

  // ---- Credit consumption this month ----
  const { data: txns } = await supabaseAdmin
    .from('credit_transactions')
    .select('amount,type,created_at')
    .gte('created_at', monthStart.toISOString())
    .lt('amount', 0) // consumption only
  const creditsConsumed = (txns ?? []).reduce((acc, t) => acc + Math.abs(Number(t.amount ?? 0)), 0)

  // ---- Recent events ----
  const { data: recent } = await supabaseAdmin
    .from('platform_admin_log')
    .select('id,admin_id,action,target_type,target_id,created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({
    kpis: {
      totalMRR,
      totalARR: totalMRR * 12,
      activeCount,
      trialCount,
      atRiskCount,
      vendorSpendMonth,
      today,
    },
    mrrTrend,
    dailySignups,
    creditsConsumed,
    recentEvents: recent ?? [],
  })
}
