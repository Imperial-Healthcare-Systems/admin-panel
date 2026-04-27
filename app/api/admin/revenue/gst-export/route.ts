// §5.5 — GST CSV export for CA / filings.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const url = new URL(req.url)
  const range = url.searchParams.get('range') ?? 'month'
  const now = new Date()
  let since: Date
  if (range === 'year') since = new Date(now.getFullYear(), 0, 1)
  else if (range === 'quarter') since = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  else { since = new Date(now); since.setDate(1); since.setHours(0, 0, 0, 0) }

  const { data: invs } = await supabaseAdmin
    .from('platform_invoices')
    .select('invoice_number,paid_at,product,subtotal,tax,total,currency,org_id,organisation:organisations(name,gstin)')
    .eq('status', 'paid')
    .gte('paid_at', since.toISOString())
    .order('paid_at', { ascending: true })

  const header = ['Invoice', 'Paid at', 'Org', 'GSTIN', 'Product', 'Subtotal', 'Tax (GST)', 'Total', 'Currency']
  const lines = [header.join(',')]
  for (const i of invs ?? []) {
    const org = i.organisation as { name?: string; gstin?: string } | null
    const cells = [
      i.invoice_number ?? '',
      i.paid_at ?? '',
      escape(org?.name ?? ''),
      org?.gstin ?? '',
      i.product ?? '',
      Number(i.subtotal ?? 0).toFixed(2),
      Number(i.tax ?? 0).toFixed(2),
      Number(i.total ?? 0).toFixed(2),
      i.currency ?? 'INR',
    ]
    lines.push(cells.join(','))
  }
  const csv = lines.join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gst-${range}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

function escape(s: string) {
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
