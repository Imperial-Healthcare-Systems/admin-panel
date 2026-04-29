import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { audit, ipFromRequest } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { id: orgId } = await params

  const { data: org, error } = await supabaseAdmin
    .from('organisations')
    .select(`
      id,name,slug,billing_email,gstin,address,status,signup_at,
      subscriptions:org_subscriptions(*),
      credits:org_credits(*),
      plan_override:org_plan_overrides(*)
    `)
    .eq('id', orgId)
    .single()

  if (error || !org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Active employees (used as "users" + active-30d count)
  const { count: totalUsers } = await supabaseAdmin
    .from('employees').select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
  const { count: activeUsers } = await supabaseAdmin
    .from('employees').select('*', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('status', 'active')

  // Latest health
  const { data: health } = await supabaseAdmin
    .from('org_health_snapshots')
    .select('health_score,risk_level,factors,snapshot_date')
    .eq('org_id', orgId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    org,
    stats: { totalUsers: totalUsers ?? 0, activeUsers: activeUsers ?? 0 },
    health: health ?? null,
  })
}

/**
 * DELETE /api/admin/orgs/[id]
 *
 * Body modes:
 *   { mode: 'archive', reason }                                    — soft, reversible (default)
 *   { mode: 'reactivate', reason }                                 — restore an archived org
 *   { mode: 'destroy', reason, confirm: 'DELETE_PERMANENTLY' }     — hard delete, cascades, super_admin only
 *
 * Guards:
 *   - reason ≥ 20 chars
 *   - destroy: super_admin role only + literal confirmation token
 *   - destroy/archive: refuses if the org contains active platform admins
 *     (would lock you out of the console if it's your own org)
 *   - destroy: surfaces FK errors (e.g. impersonation history) with a clear
 *     "archive instead" message rather than a raw Postgres error
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  const { id: orgId } = await params

  const body = (await req.json().catch(() => null)) ?? {}
  const mode: 'archive' | 'destroy' | 'reactivate' =
    body.mode === 'destroy' ? 'destroy' : body.mode === 'reactivate' ? 'reactivate' : 'archive'
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (reason.length < 20) {
    return NextResponse.json({ error: 'Reason required (min 20 chars).' }, { status: 400 })
  }

  if (mode === 'destroy') {
    if (admin.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — super_admin role required for permanent delete.' }, { status: 403 })
    }
    if (body.confirm !== 'DELETE_PERMANENTLY') {
      return NextResponse.json({ error: "Confirmation token required. Send confirm='DELETE_PERMANENTLY'." }, { status: 400 })
    }
  }

  const { data: org } = await supabaseAdmin
    .from('organisations')
    .select('id,name,status')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return NextResponse.json({ error: 'Organisation not found.' }, { status: 404 })

  // Self-lockout guard: refuse to archive/delete an org that still has
  // active platform admins (you'd kick yourself out).
  if (mode !== 'reactivate') {
    const { count: adminCount } = await supabaseAdmin
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_platform_admin', true)
      .eq('status', 'active')
    if ((adminCount ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Refused: this org has active platform admins. Revoke is_platform_admin from those employees first.' },
        { status: 409 },
      )
    }
  }

  // -------- ARCHIVE --------
  if (mode === 'archive') {
    if (org.status === 'archived') {
      return NextResponse.json({ error: 'Already archived.' }, { status: 409 })
    }
    const now = new Date().toISOString()
    const { error: archErr } = await supabaseAdmin
      .from('organisations')
      .update({ status: 'archived', updated_at: now })
      .eq('id', orgId)
    if (archErr) return NextResponse.json({ error: archErr.message }, { status: 500 })

    // Cancel any still-running subscriptions so MRR stops counting them.
    await supabaseAdmin
      .from('org_subscriptions')
      .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('org_id', orgId)
      .in('status', ['active', 'past_due', 'trial', 'suspended'])

    await audit({
      admin_id: admin.adminId,
      action: 'org.archived',
      target_type: 'organisation',
      target_id: orgId,
      payload: { name: org.name, reason },
      ip_address: ipFromRequest(req),
    })
    return NextResponse.json({ success: true, mode: 'archive' })
  }

  // -------- REACTIVATE --------
  if (mode === 'reactivate') {
    if (org.status !== 'archived') {
      return NextResponse.json({ error: 'Org is not archived.' }, { status: 409 })
    }
    const { error: reErr } = await supabaseAdmin
      .from('organisations')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', orgId)
    if (reErr) return NextResponse.json({ error: reErr.message }, { status: 500 })

    await audit({
      admin_id: admin.adminId,
      action: 'org.reactivated',
      target_type: 'organisation',
      target_id: orgId,
      payload: { name: org.name, reason },
      ip_address: ipFromRequest(req),
    })
    return NextResponse.json({ success: true, mode: 'reactivate' })
  }

  // -------- DESTROY (hard delete, cascades) --------
  // Audit FIRST so the record survives the deletion of the row it references.
  await audit({
    admin_id: admin.adminId,
    action: 'org.deleted',
    target_type: 'organisation',
    target_id: orgId,
    payload: { name: org.name, reason, prior_status: org.status },
    ip_address: ipFromRequest(req),
  })

  const { error: delErr } = await supabaseAdmin
    .from('organisations')
    .delete()
    .eq('id', orgId)

  if (delErr) {
    // Postgres FK violation — some related table without ON DELETE CASCADE
    // is holding a reference. Most likely platform_impersonation_log.
    if ((delErr as { code?: string }).code === '23503' || /foreign key/i.test(delErr.message)) {
      return NextResponse.json(
        {
          error:
            'Cannot permanently delete: related records exist (e.g. impersonation audit history) that block destruction. Archive the org instead — that preserves the audit trail.',
          detail: delErr.message,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, mode: 'destroy' })
}
