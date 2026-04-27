import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

// 90-day refund window (configurable per finance policy).
const REFUND_WINDOW_DAYS = 90

export async function GET(_req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const since = new Date(Date.now() - REFUND_WINDOW_DAYS * 86_400_000).toISOString()
  const { data: invs } = await supabaseAdmin
    .from('platform_invoices')
    .select('id,invoice_number,total,tax,currency,status,paid_at,product,cashfree_order_id,org_id,organisation:organisations(name,billing_email)')
    .in('status', ['paid', 'partially_refunded'])
    .gte('paid_at', since)
    .order('paid_at', { ascending: false })
    .limit(200)

  return NextResponse.json({ invoices: invs ?? [] })
}
