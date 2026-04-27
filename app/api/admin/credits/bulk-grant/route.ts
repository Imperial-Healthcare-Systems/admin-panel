// §5.4 — Bulk promotional credits with criteria filter.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(10),
  filter: z.object({
    tier: z.string().optional(),
    product: z.enum(['ihrms', 'icrm', 'bundle']).optional(),
    status: z.enum(['active', 'trial', 'past_due', 'suspended']).optional(),
  }),
})

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  let q = supabaseAdmin.from('org_subscriptions').select('org_id')
  if (parsed.data.filter.tier) q = q.eq('tier', parsed.data.filter.tier)
  if (parsed.data.filter.product) q = q.eq('product', parsed.data.filter.product)
  if (parsed.data.filter.status) q = q.eq('status', parsed.data.filter.status)
  const { data: subs } = await q
  const orgIds = Array.from(new Set((subs ?? []).map((s) => s.org_id)))
  if (orgIds.length === 0) return NextResponse.json({ success: true, applied: 0 })

  // Walk each org so balance_after stays accurate (no race protection here — single-admin tool).
  let applied = 0
  for (const orgId of orgIds) {
    const { data: w } = await supabaseAdmin.from('org_credits').select('balance,lifetime_purchased').eq('org_id', orgId).maybeSingle()
    const newBalance = Number(w?.balance ?? 0) + parsed.data.amount
    if (w) {
      await supabaseAdmin.from('org_credits').update({
        balance: newBalance,
        lifetime_purchased: Number(w.lifetime_purchased ?? 0) + parsed.data.amount,
        updated_at: new Date().toISOString(),
      }).eq('org_id', orgId)
    } else {
      await supabaseAdmin.from('org_credits').insert({
        org_id: orgId, balance: newBalance, lifetime_purchased: parsed.data.amount, lifetime_consumed: 0,
      })
    }
    await supabaseAdmin.from('credit_transactions').insert({
      org_id: orgId, type: 'promotional', amount: parsed.data.amount,
      reference_type: 'bulk_promotional', reference_id: admin.adminId,
      balance_after: newBalance, notes: parsed.data.reason, created_by: admin.adminId,
    })
    applied++
  }

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId, action: 'credits.bulk_grant',
    target_type: 'org', target_id: null,
    payload: { ...parsed.data, applied },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true, applied })
}
