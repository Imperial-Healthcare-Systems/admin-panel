// GET list of admins, POST to grant/revoke platform_admin (super-admin only).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

export async function GET() {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id,email,first_name,last_name,role,is_platform_admin,totp_enabled,is_active,last_login_at')
    .eq('is_platform_admin', true)
  return NextResponse.json({ admins: data ?? [] })
}

const schema = z.object({
  email: z.string().email(),
  is_platform_admin: z.boolean(),
})

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }

  // Only super_admin or operations_head can grant/revoke
  if (admin.role !== 'super_admin' && admin.role !== 'operations_head') {
    return NextResponse.json({ error: 'Forbidden — super_admin or operations_head required' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('employees')
    .update({ is_platform_admin: parsed.data.is_platform_admin })
    .eq('email', parsed.data.email.toLowerCase())
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: parsed.data.is_platform_admin ? 'admin.grant' : 'admin.revoke',
    target_type: 'employee',
    target_id: null,
    payload: parsed.data,
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true })
}
