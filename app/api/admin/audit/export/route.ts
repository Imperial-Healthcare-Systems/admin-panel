// §5.9 — CSV export of audit log (compliance).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const url = new URL(req.url)
  const since = url.searchParams.get('since') ?? new Date(Date.now() - 30 * 86_400_000).toISOString()
  const until = url.searchParams.get('until') ?? new Date().toISOString()

  const { data: actions } = await supabaseAdmin
    .from('platform_admin_log')
    .select('id,admin_id,action,target_type,target_id,payload,ip_address,created_at')
    .gte('created_at', since).lte('created_at', until)
    .order('created_at', { ascending: true })

  const { data: imps } = await supabaseAdmin
    .from('platform_impersonation_log')
    .select('id,admin_id,impersonated_org_id,impersonated_user_id,reason,started_at,ended_at,actions_taken')
    .gte('started_at', since).lte('started_at', until)
    .order('started_at', { ascending: true })

  const header = ['kind', 'ts', 'admin_id', 'action', 'target_type', 'target_id', 'ip', 'payload']
  const lines = [header.join(',')]
  for (const a of actions ?? []) {
    lines.push([
      'action', a.created_at, a.admin_id, a.action, a.target_type ?? '', a.target_id ?? '',
      a.ip_address ?? '', escapeCsv(JSON.stringify(a.payload ?? {})),
    ].join(','))
  }
  for (const i of imps ?? []) {
    lines.push([
      'impersonation', i.started_at, i.admin_id, 'impersonate.session', 'org', i.impersonated_org_id,
      '', escapeCsv(JSON.stringify({ reason: i.reason, ended_at: i.ended_at, user: i.impersonated_user_id, actions: i.actions_taken })),
    ].join(','))
  }
  const csv = lines.join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

function escapeCsv(s: string) {
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
