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

  let q = supabaseAdmin
    .from('ecosystem_events')
    .select('id,source_platform,event_type,actor_user_id,actor_type,payload,created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (source) q = q.eq('source_platform', source)
  if (eventType) q = q.eq('event_type', eventType)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}
