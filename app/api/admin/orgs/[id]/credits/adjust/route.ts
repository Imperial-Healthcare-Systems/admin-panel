// §6.2 — Manual credit adjustment.
// ICRM live schema notes (handled here):
//  * org_credits has `total_purchased` (not lifetime_purchased).
//  * credit_transactions has `direction` ('debit'|'credit') we always populate.
//  * `description` is the existing notes column; we mirror to `notes` (added by 002).
//  * `user_id` is FK to crm_users — admin-initiated rows leave it NULL and use `created_by`.
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

  // Wallet may not exist yet — first manual grant should bootstrap it.
  // Verify the org itself exists before creating a wallet for it.
  const { data: org } = await supabaseAdmin
    .from('organisations')
    .select('id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  const { data: wallet } = await supabaseAdmin
    .from('org_credits')
    .select('balance,total_purchased,lifetime_consumed')
    .eq('org_id', orgId)
    .maybeSingle()

  const currentBalance = Number(wallet?.balance ?? 0)
  const currentPurchased = Number(wallet?.total_purchased ?? 0)
  const newBalance = currentBalance + numAmount
  if (newBalance < 0) return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })

  const newPurchased = numAmount > 0 ? currentPurchased + numAmount : currentPurchased

  if (wallet) {
    await supabaseAdmin
      .from('org_credits')
      .update({
        balance: newBalance,
        total_purchased: newPurchased,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', orgId)
  } else {
    await supabaseAdmin.from('org_credits').insert({
      org_id: orgId,
      balance: newBalance,
      total_purchased: newPurchased,
      lifetime_consumed: 0,
    })
  }

  await supabaseAdmin.from('credit_transactions').insert({
    org_id: orgId,
    type,
    amount: numAmount,
    direction: numAmount > 0 ? 'credit' : 'debit',
    reference_type: 'manual_adjustment',
    reference_id: null,
    balance_after: newBalance,
    description: reason,
    notes: reason,
    created_by: adminId,
    user_id: null,
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
