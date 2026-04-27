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
    .select('balance,lifetime_purchased,lifetime_consumed,updated_at')
    .eq('org_id', orgId)
    .maybeSingle()

  const { data: txns } = await supabaseAdmin
    .from('credit_transactions')
    .select('id,type,amount,balance_after,notes,reference_type,created_at,created_by')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100)

  return NextResponse.json({ wallet: wallet ?? null, transactions: txns ?? [] })
}
