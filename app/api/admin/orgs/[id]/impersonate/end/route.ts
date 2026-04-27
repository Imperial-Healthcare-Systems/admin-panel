// §6.3 — Impersonation end. Called by client beforeunload.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { logId, actionsTaken } = await req.json()
  if (!logId) return NextResponse.json({ error: 'logId required' }, { status: 400 })

  await supabaseAdmin
    .from('platform_impersonation_log')
    .update({
      ended_at: new Date().toISOString(),
      actions_taken: actionsTaken ?? [],
    })
    .eq('id', logId)

  return NextResponse.json({ success: true })
}
