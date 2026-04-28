import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { id: orgId } = await params
  const url = new URL(req.url)
  const source = url.searchParams.get('source')
  const eventType = url.searchParams.get('event_type')

  // ICRM's existing schema uses `actor_id`; migration 002 added `actor_user_id`
  // for spec parity. Read both, prefer whichever has data.
  let q = supabaseAdmin
    .from('ecosystem_events')
    .select(
      'id,source_platform,event_type,actor_id,actor_user_id,actor_type,entity_id,payload,triggered_by_automation,processed,created_at',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (source) q = q.eq('source_platform', source)
  if (eventType) q = q.eq('event_type', eventType)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events = (data ?? []).map((e) => ({
    ...e,
    // Surface a unified actor_user_id for the UI: prefer the new column, fall
    // back to the existing one where the real history lives.
    actor_user_id: e.actor_user_id ?? e.actor_id ?? null,
  }))
  return NextResponse.json({ events })
}
