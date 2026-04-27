// §6.3 — Impersonation start. Verbatim per spec.
import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { ipFromRequest } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: orgId } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const adminId = (session.user as { id: string }).id

  const { user_id, product, reason } = await req.json()
  if (!reason || reason.trim().length < 20) {
    return NextResponse.json({ error: 'Reason required (min 20 chars)' }, { status: 400 })
  }
  if (!['ihrms', 'icrm'].includes(product)) {
    return NextResponse.json({ error: 'Invalid product' }, { status: 400 })
  }

  const table = product === 'ihrms' ? 'employees' : 'crm_users'
  const { data: user } = await supabaseAdmin
    .from(table)
    .select('id,email,org_id')
    .eq('id', user_id)
    .eq('org_id', orgId)
    .single()
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: log } = await supabaseAdmin
    .from('platform_impersonation_log')
    .insert({
      admin_id: adminId,
      impersonated_org_id: orgId,
      impersonated_user_id: user_id,
      reason,
    })
    .select()
    .single()

  if (!process.env.IMPERSONATION_SECRET) {
    return NextResponse.json({ error: 'IMPERSONATION_SECRET not set' }, { status: 500 })
  }
  const secret = new TextEncoder().encode(process.env.IMPERSONATION_SECRET)
  const token = await new SignJWT({
    sub: user_id,
    email: user.email,
    orgId,
    impersonator: adminId,
    logId: log!.id,
    isImpersonation: true,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret)

  const ihrmsBase = process.env.IHRMS_BASE_URL ?? 'https://imperialhrms.com'
  const icrmBase = process.env.ICRM_BASE_URL ?? 'https://imperialcrm.cloud'
  const targetUrl =
    product === 'ihrms'
      ? `${ihrmsBase}/api/auth/impersonation-login?token=${token}`
      : `${icrmBase}/api/auth/impersonation-login?token=${token}`

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: adminId,
    action: 'impersonate.start',
    target_type: product === 'ihrms' ? 'employee' : 'crm_user',
    target_id: user_id,
    payload: { orgId, product, reason, logId: log!.id },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ targetUrl, logId: log!.id })
}
