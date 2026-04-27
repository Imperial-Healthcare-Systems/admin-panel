// §5.2 list view feed.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.toLowerCase().trim() ?? ''
  const status = url.searchParams.get('status') ?? ''
  const tier = url.searchParams.get('tier') ?? ''

  let query = supabaseAdmin
    .from('organisations')
    .select(`
      id,name,slug,billing_email,status,signup_at,
      subscriptions:org_subscriptions(product,tier,status,seats,amount_per_month,next_billing_date),
      credits:org_credits(balance)
    `)
    .order('signup_at', { ascending: false })
    .limit(500)

  if (q) query = query.ilike('name', `%${q}%`)
  if (status) query = query.eq('status', status)

  const { data: orgs, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Pull most-recent health snapshot per org so we can join in-memory.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]
  const { data: health } = await supabaseAdmin
    .from('org_health_snapshots')
    .select('org_id,health_score,risk_level,snapshot_date')
    .gte('snapshot_date', sevenDaysAgo)
    .order('snapshot_date', { ascending: false })

  const latestHealth = new Map<string, { health_score: number; risk_level: string }>()
  for (const row of health ?? []) {
    if (!latestHealth.has(row.org_id)) latestHealth.set(row.org_id, row)
  }

  const rows = (orgs ?? []).map((o) => {
    const subs = (o.subscriptions ?? []) as Array<{ product: string; tier: string; status: string; seats: number; amount_per_month: number; next_billing_date: string | null }>
    const activeSubs = subs.filter((s) => s.status === 'active' || s.status === 'past_due')
    const mrr = activeSubs.reduce((acc, s) => acc + Number(s.amount_per_month ?? 0), 0)
    const seats = activeSubs.reduce((acc, s) => acc + Number(s.seats ?? 0), 0)
    const tiers = activeSubs.map((s) => s.tier).join(', ') || subs.map((s) => s.tier).join(', ') || '—'
    const subStatus = activeSubs[0]?.status ?? subs[0]?.status ?? o.status
    const credits = (o.credits ?? []) as Array<{ balance: number }>
    const balance = credits.length ? Number(credits[0].balance ?? 0) : 0
    const h = latestHealth.get(o.id)
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      sub_status: subStatus,
      tier: tiers,
      seats,
      mrr,
      health_score: h?.health_score ?? null,
      risk_level: h?.risk_level ?? null,
      next_billing_date: activeSubs[0]?.next_billing_date ?? null,
      credit_balance: balance,
    }
  })

  // Filter by tier post-load (cheaper than join).
  const filtered = tier ? rows.filter((r) => r.tier.toLowerCase().includes(tier.toLowerCase())) : rows

  // Default sort by MRR desc.
  filtered.sort((a, b) => b.mrr - a.mrr)

  return NextResponse.json({ rows: filtered })
}
