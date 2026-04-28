// Per-org credit balance + last 100 transactions.
// ICRM live schema: org_credits.total_purchased (not lifetime_purchased).
// We expose `lifetime_purchased`/`lifetime_consumed` to the UI as aliases
// so the page code stays bible-shaped. lifetime_consumed = total_purchased - balance
// when migration 002's column is null/0 (back-compat for existing rows).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { id: orgId } = await params

  const { data: wallet } = await supabaseAdmin
    .from('org_credits')
    .select('balance,total_purchased,lifetime_consumed,updated_at')
    .eq('org_id', orgId)
    .maybeSingle()

  const { data: txns } = await supabaseAdmin
    .from('credit_transactions')
    .select(
      'id,type,direction,amount,balance_after,description,notes,reference_type,ref_id,feature_key,created_at,created_by,user_id',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100)

  const w = wallet
    ? {
        balance: Number(wallet.balance ?? 0),
        lifetime_purchased: Number(wallet.total_purchased ?? 0),
        lifetime_consumed:
          Number(wallet.lifetime_consumed ?? 0) ||
          Math.max(0, Number(wallet.total_purchased ?? 0) - Number(wallet.balance ?? 0)),
        updated_at: wallet.updated_at,
      }
    : null

  // Normalize transactions for the UI (it expects `notes`).
  const transactions = (txns ?? []).map((t) => ({
    ...t,
    notes: t.notes ?? t.description ?? null,
    type: t.type ?? (t.direction === 'credit' ? 'consumption' : 'consumption'),
  }))

  return NextResponse.json({ wallet: w, transactions })
}
