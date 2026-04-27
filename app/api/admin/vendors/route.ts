// §5.6 — Vendor cost dashboard data + manual upsert.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

export async function GET() {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
  sixMonthsAgo.setDate(1)

  const { data: rows } = await supabaseAdmin
    .from('platform_vendor_costs')
    .select('*')
    .gte('period_month', sixMonthsAgo.toISOString().slice(0, 10))
    .order('period_month', { ascending: false })

  // Active customer count for cost-per-customer
  const { count: activeCount } = await supabaseAdmin
    .from('org_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active')

  // MRR
  const { data: subs } = await supabaseAdmin
    .from('org_subscriptions').select('amount_per_month').eq('status', 'active')
  const mrr = (subs ?? []).reduce((acc, s) => acc + Number(s.amount_per_month ?? 0), 0)

  const monthKey = new Date().toISOString().slice(0, 7)
  const thisMonth = (rows ?? []).filter((r) => String(r.period_month).startsWith(monthKey))
  const monthSpend = thisMonth.reduce((acc, r) => acc + Number(r.amount_inr ?? 0), 0)

  return NextResponse.json({
    rows: rows ?? [],
    monthSpend,
    activeCount: activeCount ?? 0,
    mrr,
    costPerCustomer: (activeCount ?? 0) > 0 ? monthSpend / (activeCount as number) : 0,
    grossMargin: mrr > 0 ? (mrr - monthSpend) / mrr : 0,
  })
}

const upsertSchema = z.object({
  vendor: z.string().min(2),
  period_month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_usd: z.number().nullable().optional(),
  amount_inr: z.number().nullable().optional(),
  units_consumed: z.number().nullable().optional(),
  notes: z.string().optional(),
})

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  const parsed = upsertSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('platform_vendor_costs')
    .upsert(parsed.data, { onConflict: 'vendor,period_month' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: 'vendor_cost.upsert',
    target_type: 'platform_vendor_costs',
    target_id: null,
    payload: parsed.data,
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true })
}
