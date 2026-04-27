import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { id: orgId } = await params

  const [{ data: employees }, { data: crmUsers }] = await Promise.all([
    supabaseAdmin
      .from('employees')
      .select('id,email,first_name,last_name,role,is_active,last_login_at,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('crm_users')
      .select('id,email,first_name,last_name,role,is_active,last_login_at,created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
  ])

  return NextResponse.json({
    employees: employees ?? [],
    crmUsers: crmUsers ?? [],
  })
}
