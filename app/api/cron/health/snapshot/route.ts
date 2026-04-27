// §6.6 — Customer health snapshot cron. Bearer-auth via CRON_SECRET. Runs daily 03:00 IST.
// Spec implementation, verbatim, with light expansion of factors.
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function runSnapshot(req: NextRequest) {
  // Vercel crons hit this with GET + an Authorization header set from CRON_SECRET.
  // Manual runs / IHRMS-style integrations use POST with the same Bearer token.
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0]
  const { data: orgs } = await supabaseAdmin.from('organisations').select('id')

  for (const org of orgs ?? []) {
    let score = 100
    const factors: Record<string, unknown> = {}

    // Active employees (proxy for engagement)
    const { count: activeEmps } = await supabaseAdmin
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .eq('is_active', true)
    factors.active_users = activeEmps ?? 0
    if ((activeEmps ?? 0) === 0) score -= 40

    // Credit balance
    const { data: w } = await supabaseAdmin
      .from('org_credits').select('balance').eq('org_id', org.id).maybeSingle()
    const balance = Number(w?.balance ?? 0)
    factors.credit_balance = balance
    if (balance === 0) score -= 20

    // Subscription health (any past_due / suspended drags hardest)
    const { data: subs } = await supabaseAdmin
      .from('org_subscriptions').select('status').eq('org_id', org.id)
    const statuses = (subs ?? []).map((s) => s.status)
    factors.subscription_status = statuses
    if (statuses.includes('past_due')) score -= 30
    if (statuses.includes('suspended')) score -= 50

    // Login recency (last 30d) — uses ecosystem_events as the activity signal
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { count: recentEvents } = await supabaseAdmin
      .from('ecosystem_events')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .gte('created_at', thirtyDaysAgo)
    factors.events_30d = recentEvents ?? 0
    if ((recentEvents ?? 0) === 0) score -= 20

    score = Math.max(0, Math.min(100, score))
    const risk = score >= 70 ? 'healthy' : score >= 40 ? 'at_risk' : 'critical'

    await supabaseAdmin.from('org_health_snapshots').upsert(
      { org_id: org.id, snapshot_date: today, health_score: score, factors, risk_level: risk },
      { onConflict: 'org_id,snapshot_date' },
    )
  }

  return Response.json({ processed: orgs?.length ?? 0 })
}

export async function GET(req: NextRequest) { return runSnapshot(req) }
export async function POST(req: NextRequest) { return runSnapshot(req) }
