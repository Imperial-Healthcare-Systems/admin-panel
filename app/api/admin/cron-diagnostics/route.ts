// Read-only diagnostic endpoint for the scheduled "verify health cron" agent.
// Bearer-auth via CRON_SECRET — same token that protects /api/cron/health/snapshot.
// Returns ONLY pre-computed counts + top-N rows. No raw query, no row dump,
// no PII beyond org names. Safe to expose to a remote agent because the agent
// can do nothing here it couldn't do via the cron endpoint itself.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]

  // 1. Cron health: rows per day + per-day org coverage
  const { data: snaps } = await supabaseAdmin
    .from('org_health_snapshots')
    .select('org_id,snapshot_date,health_score,risk_level,factors')
    .gte('snapshot_date', sevenDaysAgo)
    .order('snapshot_date', { ascending: false })

  const byDay = new Map<string, number>()
  for (const s of snaps ?? []) {
    byDay.set(s.snapshot_date, (byDay.get(s.snapshot_date) ?? 0) + 1)
  }
  const days = Array.from(byDay.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => ({ date, rows }))

  // Expected days: each calendar day in the [today-6, today] window
  const expectedDays: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86_400_000)
    expectedDays.push(d.toISOString().split('T')[0])
  }
  const missingDays = expectedDays.filter((d) => !byDay.has(d))

  // 2. Latest distribution by risk_level (most recent snapshot per org)
  const latestByOrg = new Map<string, { health_score: number; risk_level: string; factors: any; snapshot_date: string }>()
  for (const s of snaps ?? []) {
    if (!latestByOrg.has(s.org_id)) {
      latestByOrg.set(s.org_id, {
        health_score: s.health_score,
        risk_level: s.risk_level,
        factors: s.factors,
        snapshot_date: s.snapshot_date,
      })
    }
  }
  const distribution = { healthy: 0, at_risk: 0, critical: 0 }
  for (const v of latestByOrg.values()) {
    if (v.risk_level === 'healthy') distribution.healthy++
    else if (v.risk_level === 'at_risk') distribution.at_risk++
    else if (v.risk_level === 'critical') distribution.critical++
  }

  // 3. Top 5 lowest score
  const sorted = Array.from(latestByOrg.entries())
    .sort((a, b) => a[1].health_score - b[1].health_score)
    .slice(0, 5)
  const topOrgIds = sorted.map(([id]) => id)
  const { data: orgs } = topOrgIds.length
    ? await supabaseAdmin.from('organisations').select('id,name').in('id', topOrgIds)
    : { data: [] as Array<{ id: string; name: string }> }
  const nameById = new Map((orgs ?? []).map((o) => [o.id, o.name]))
  const topCritical = sorted.map(([id, v]) => ({
    org_id: id,
    name: nameById.get(id) ?? 'unknown',
    health_score: v.health_score,
    risk_level: v.risk_level,
    factors: v.factors,
    snapshot_date: v.snapshot_date,
  }))

  // 4. Cron failure / 401 traces in admin log (best-effort — only present if a wrapper logs them)
  const sevenDaysAgoISO = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data: failures } = await supabaseAdmin
    .from('platform_admin_log')
    .select('action,target_type,payload,ip_address,created_at')
    .or('action.eq.cron.failure,action.eq.cron.unauthorized')
    .gte('created_at', sevenDaysAgoISO)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    window_days: 7,
    cron_health: {
      total_rows_7d: snaps?.length ?? 0,
      orgs_in_latest_snapshot: latestByOrg.size,
      rows_per_day: days,
      missing_days: missingDays,
    },
    latest_distribution: distribution,
    top_critical: topCritical,
    cron_failures_7d: failures ?? [],
  })
}
