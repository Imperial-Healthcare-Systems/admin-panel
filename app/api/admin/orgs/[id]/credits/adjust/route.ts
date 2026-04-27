// §6.2 — Manual credit adjustment.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { adminLimiter, checkLimit } from '@/lib/rate-limit'
import { ipFromRequest } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orgId } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminId = (session.user as { id: string }).id

  const limit = await checkLimit(adminLimiter, `credits:${adminId}`)
  if (!limit.ok) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  const { amount, type, reason } = await req.json()

  if (!['promotional', 'adjustment', 'refund'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }
  if (!reason || reason.trim().length < 10) {
    return NextResponse.json({ error: 'Reason required (min 10 chars)' }, { status: 400 })
  }
  const numAmount = Number(amount)
  if (!isFinite(numAmount) || numAmount === 0) {
    return NextResponse.json({ error: 'Amount must be a non-zero number' }, { status: 400 })
  }

  const { data: wallet } = await supabaseAdmin
    .from('org_credits')
    .select('balance,lifetime_purchased')
    .eq('org_id', orgId)
    .single()
  if (!wallet) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  const newBalance = Number(wallet.balance) + numAmount
  if (newBalance < 0) return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })

  const update: Record<string, unknown> = {
    balance: newBalance,
    updated_at: new Date().toISOString(),
  }
  if (numAmount > 0) {
    update.lifetime_purchased = Number(wallet.lifetime_purchased ?? 0) + numAmount
  }
  await supabaseAdmin.from('org_credits').update(update).eq('org_id', orgId)

  await supabaseAdmin.from('credit_transactions').insert({
    org_id: orgId,
    type,
    amount: numAmount,
    reference_type: 'manual_adjustment',
    reference_id: adminId,
    balance_after: newBalance,
    notes: reason,
    created_by: adminId,
  })

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: adminId,
    action: 'credits.adjust',
    target_type: 'org',
    target_id: orgId,
    payload: { amount: numAmount, type, reason, balance_after: newBalance },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true, newBalance })
}
