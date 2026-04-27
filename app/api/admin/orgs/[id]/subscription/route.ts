// Upgrade / downgrade / cancel / suspend / reactivate from §5.2 Subscription tab.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({
  subscription_id: z.string().uuid(),
  action: z.enum(['upgrade', 'downgrade', 'cancel', 'suspend', 'reactivate', 'override']),
  tier: z.string().optional(),
  seats: z.number().int().positive().optional(),
  amount_per_month: z.number().nonnegative().optional(),
  reason: z.string().min(10).optional(),
  effective_from: z.string().optional(),
  expires_on: z.string().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  const { id: orgId } = await params
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const action = parsed.data.action

  // Destructive actions need a reason (Section 8 guidance).
  if (['cancel', 'suspend', 'downgrade', 'override'].includes(action) && !parsed.data.reason) {
    return NextResponse.json({ error: 'Reason required (min 10 chars)' }, { status: 400 })
  }

  if (action === 'override') {
    if (parsed.data.amount_per_month == null || !parsed.data.effective_from) {
      return NextResponse.json({ error: 'amount_per_month + effective_from required' }, { status: 400 })
    }
    await supabaseAdmin.from('org_plan_overrides').upsert(
      {
        org_id: orgId,
        custom_amount_per_month: parsed.data.amount_per_month,
        reason: parsed.data.reason!,
        effective_from: parsed.data.effective_from,
        expires_on: parsed.data.expires_on ?? null,
        created_by: admin.adminId,
      },
      { onConflict: 'org_id' },
    )
  } else {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (action === 'cancel') {
      update.status = 'cancelled'
      update.cancelled_at = new Date().toISOString()
    } else if (action === 'suspend') {
      update.status = 'suspended'
    } else if (action === 'reactivate') {
      update.status = 'active'
    } else {
      // upgrade / downgrade
      if (parsed.data.tier) update.tier = parsed.data.tier
      if (parsed.data.seats) update.seats = parsed.data.seats
      if (parsed.data.amount_per_month != null) update.amount_per_month = parsed.data.amount_per_month
      update.status = 'active'
    }
    const { error } = await supabaseAdmin
      .from('org_subscriptions')
      .update(update)
      .eq('id', parsed.data.subscription_id)
      .eq('org_id', orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: `subscription.${action}`,
    target_type: 'org_subscription',
    target_id: parsed.data.subscription_id,
    payload: parsed.data,
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true })
}
