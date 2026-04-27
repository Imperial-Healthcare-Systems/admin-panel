// §5.6 — Pull this-month OpenAI usage and persist as a vendor_cost row.
// Note: OpenAI's organization usage endpoint requires an admin key. If unavailable,
// this returns a structured error so the admin can fall back to manual entry.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 400 })
  }

  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0)
  const startTs = Math.floor(start.getTime() / 1000)

  const res = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${startTs}&bucket_width=1d`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  })
  if (!res.ok) {
    return NextResponse.json({
      error: 'OpenAI usage API unavailable. Use manual entry.',
      detail: `status ${res.status}`,
    }, { status: 502 })
  }
  const json = await res.json()
  let usd = 0
  for (const bucket of json?.data ?? []) {
    for (const r of bucket?.results ?? []) {
      usd += Number(r?.amount?.value ?? 0)
    }
  }
  const inr = usd * 84 // rough — operator can correct via manual edit

  const period_month = start.toISOString().slice(0, 10)
  await supabaseAdmin.from('platform_vendor_costs').upsert(
    { vendor: 'openai', period_month, amount_usd: usd, amount_inr: inr, notes: 'auto-pulled from /v1/organization/costs' },
    { onConflict: 'vendor,period_month' },
  )

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: 'vendor_cost.openai_pull',
    target_type: 'platform_vendor_costs',
    target_id: null,
    payload: { period_month, amount_usd: usd, amount_inr: inr },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true, amount_usd: usd, amount_inr: inr })
}
