// §6.5 — Cashfree refund. Spec implementation, verbatim with hardening.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { adminLimiter, checkLimit } from '@/lib/rate-limit'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().min(10),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminId = (session.user as { id: string }).id

  const limit = await checkLimit(adminLimiter, `refund:${adminId}`)
  if (!limit.ok) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { invoice_id, amount, reason } = parsed.data

  const { data: inv } = await supabaseAdmin.from('platform_invoices').select('*').eq('id', invoice_id).single()
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (!['paid', 'partially_refunded'].includes(inv.status)) {
    return NextResponse.json({ error: 'Can only refund paid invoices' }, { status: 400 })
  }
  if (!inv.cashfree_order_id) return NextResponse.json({ error: 'No Cashfree order on file' }, { status: 400 })
  if (amount > Number(inv.total)) return NextResponse.json({ error: 'Refund exceeds invoice total' }, { status: 400 })

  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
    return NextResponse.json({ error: 'CASHFREE credentials not set' }, { status: 500 })
  }

  const apiBase = process.env.CASHFREE_API_BASE ?? 'https://api.cashfree.com'
  const res = await fetch(`${apiBase}/pg/orders/${inv.cashfree_order_id}/refunds`, {
    method: 'POST',
    headers: {
      'x-client-id': process.env.CASHFREE_APP_ID!,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY!,
      'x-api-version': '2023-08-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refund_amount: amount,
      refund_id: `RFND-${Date.now()}`,
      refund_note: reason,
    }),
  })
  const refundData = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ error: 'Cashfree refund failed', detail: refundData }, { status: 502 })
  }

  const isFull = amount >= Number(inv.total)
  await supabaseAdmin.from('platform_invoices').update({
    status: isFull ? 'refunded' : 'partially_refunded',
  }).eq('id', invoice_id)

  // §5.8: auto-create credit_transactions row of type='refund' (paper trail).
  // Refund hits cash, not credits, so amount is 0 and balance is unchanged.
  if (inv.org_id) {
    const { data: w } = await supabaseAdmin.from('org_credits').select('balance').eq('org_id', inv.org_id).maybeSingle()
    const newBalance = Number(w?.balance ?? 0)
    const note = `Cashfree refund ${formatCur(amount, inv.currency)} — ${reason}`
    await supabaseAdmin.from('credit_transactions').insert({
      org_id: inv.org_id,
      type: 'refund',
      amount: 0,
      direction: 'credit', // bookkeeping side — not a balance-changing entry
      reference_type: 'platform_invoice',
      reference_id: invoice_id,
      balance_after: newBalance,
      description: note,
      notes: note,
      created_by: adminId,
      user_id: null,
    })
  }

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: adminId,
    action: 'refund.create',
    target_type: 'platform_invoice',
    target_id: invoice_id,
    payload: { amount, reason, cashfree_response: refundData },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true, refundData })
}

function formatCur(n: number, cur = 'INR') {
  return `${cur} ${n.toFixed(2)}`
}
