import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { id: orgId } = await params

  // Schema note: employees has `status` (text), crm_users has `is_active` (boolean).
  // We normalize crm_users to expose a `status` field so the UI can stay uniform.
  const [{ data: employees }, { data: crmUsers }] = await Promise.all([
    supabaseAdmin
      .from('employees')
      .select('id,email,full_name,role,status,last_login_at,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('crm_users')
      .select('id,email,full_name,role,is_active,last_login_at,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
  ])

  const crmUsersNormalized = (crmUsers ?? []).map((u) => ({
    ...u,
    status: u.is_active ? 'active' : 'inactive',
  }))

  return NextResponse.json({
    employees: employees ?? [],
    crmUsers: crmUsersNormalized,
  })
}
