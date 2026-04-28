// §5.9 — Merged audit log: platform_admin_log + platform_impersonation_log.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const url = new URL(req.url)
  const adminFilter = url.searchParams.get('admin') ?? undefined
  const action = url.searchParams.get('action') ?? undefined
  const targetOrg = url.searchParams.get('org') ?? undefined
  const since = url.searchParams.get('since') ?? undefined
  const until = url.searchParams.get('until') ?? undefined
  const limit = Number(url.searchParams.get('limit') ?? 200)

  let q1 = supabaseAdmin
    .from('platform_admin_log')
    .select('id,admin_id,action,target_type,target_id,payload,ip_address,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (adminFilter) q1 = q1.eq('admin_id', adminFilter)
  if (action) q1 = q1.eq('action', action)
  if (targetOrg) q1 = q1.eq('target_id', targetOrg)
  if (since) q1 = q1.gte('created_at', since)
  if (until) q1 = q1.lte('created_at', until)

  const { data: actions } = await q1

  let q2 = supabaseAdmin
    .from('platform_impersonation_log')
    .select('id,admin_id,impersonated_org_id,impersonated_user_id,reason,started_at,ended_at,actions_taken')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (adminFilter) q2 = q2.eq('admin_id', adminFilter)
  if (targetOrg) q2 = q2.eq('impersonated_org_id', targetOrg)
  if (since) q2 = q2.gte('started_at', since)
  if (until) q2 = q2.lte('started_at', until)

  const { data: imps } = await q2

  // Resolve admin names
  const allAdminIds = new Set([
    ...(actions ?? []).map((a) => a.admin_id),
    ...(imps ?? []).map((i) => i.admin_id),
  ])
  const { data: admins } = allAdminIds.size
    ? await supabaseAdmin.from('employees').select('id,full_name,email').in('id', Array.from(allAdminIds))
    : { data: [] as Array<any> }
  const nameById = new Map((admins ?? []).map((a) => [a.id, a.full_name || a.email]))

  const merged = [
    ...(actions ?? []).map((a) => ({
      kind: 'action' as const,
      id: a.id,
      admin_id: a.admin_id,
      admin_name: nameById.get(a.admin_id) ?? a.admin_id,
      action: a.action,
      target_type: a.target_type,
      target_id: a.target_id,
      payload: a.payload,
      ip_address: a.ip_address,
      ts: a.created_at,
    })),
    ...(imps ?? []).map((i) => ({
      kind: 'impersonation' as const,
      id: i.id,
      admin_id: i.admin_id,
      admin_name: nameById.get(i.admin_id) ?? i.admin_id,
      action: 'impersonate.session',
      target_type: 'org',
      target_id: i.impersonated_org_id,
      payload: { reason: i.reason, ended_at: i.ended_at, actions_taken: i.actions_taken, impersonated_user_id: i.impersonated_user_id },
      ip_address: null as string | null,
      ts: i.started_at,
    })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

  return NextResponse.json({ entries: merged })
}
