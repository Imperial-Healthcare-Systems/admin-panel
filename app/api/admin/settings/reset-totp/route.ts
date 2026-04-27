// Reset TOTP for an admin (used when someone loses their authenticator).
// Self-reset always allowed; resetting others requires super_admin/operations_head.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({ employee_id: z.string().uuid() })

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  if (parsed.data.employee_id !== admin.adminId) {
    if (admin.role !== 'super_admin' && admin.role !== 'operations_head') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  await supabaseAdmin.from('employees').update({
    totp_secret: null,
    totp_enabled: false,
    totp_enrolled_at: null,
  }).eq('id', parsed.data.employee_id)

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: 'totp.reset',
    target_type: 'employee',
    target_id: parsed.data.employee_id,
    payload: { reset_by: admin.adminId },
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true })
}
